import {
  CONTINENT_BY_ID,
  TERRITORY_BY_ID,
  aiChooseAction,
  createGame,
  createSeededRng,
  effectiveObjective,
  listLegalActions,
  pendingPlaceTotal,
  territoryContinent,
  reduce,
  type Action,
  type Difficulty,
  type GameState,
  type PlayerId,
  type TerritoryId,
} from "@war2/engine";
import { DEFAULT_WS_PATH, DEFAULT_WS_PORT, type C2S, type S2C } from "@war2/shared";
import { createBoard } from "./board.ts";
import { showBattle } from "./dice.ts";

const COLORS = ["red", "blue", "green", "yellow", "black", "white"] as const;
const AI_NAMES = ["Bóris", "Célia", "Dante", "Erwin", "Fátima"];
const SAVE_KEY = "war2-campaign-v1";

const PHASE_PT: Record<string, string> = {
  setup_place: "posicionamento",
  reinforce: "reforço",
  attack: "ataque",
  fortify: "deslocamento",
  over: "fim de jogo",
};

const COLOR_PT: Record<string, string> = {
  red: "vermelho",
  blue: "azul",
  green: "verde",
  yellow: "amarelo",
  black: "preto",
  white: "branco",
};

type Mode = "hotseat" | "net" | "campaign";

interface SavedCampaign {
  state: GameState;
  ai: [PlayerId, Difficulty][];
  humanId: PlayerId;
}

const reducedMotion =
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

const ui = {
  fps: document.querySelector("#fps") as HTMLElement,
  status: document.querySelector("#status") as HTMLElement,
  phase: document.querySelector("#phase") as HTMLElement,
  turn: document.querySelector("#turn") as HTMLElement,
  objective: document.querySelector("#objective") as HTMLElement,
  pending: document.querySelector("#pending") as HTMLElement,
  dice: document.querySelector("#dice") as HTMLElement,
  occupy: document.querySelector("#occupy") as HTMLElement,
  occupyHint: document.querySelector("#occupy-hint") as HTMLElement,
  occupyBtns: document.querySelector("#occupy-btns") as HTMLElement,
  cards: document.querySelector("#cards") as HTMLElement,
  cardsEmpty: document.querySelector("#cards-empty") as HTMLElement,
  log: document.querySelector("#log") as HTMLElement,
  logEmpty: document.querySelector("#log-empty") as HTMLElement,
  error: document.querySelector("#error") as HTMLElement,
  roster: document.querySelector("#roster") as HTMLElement,
  placen: document.querySelector("#placen") as HTMLElement,
  chooser: document.querySelector("#chooser") as HTMLElement,
  chooserHint: document.querySelector("#chooser-hint") as HTMLElement,
  chooserBtns: document.querySelector("#chooser-btns") as HTMLElement,
  chooserN: document.querySelector("#chooser-n") as HTMLInputElement,
  chooserOk: document.querySelector("#chooser-ok") as HTMLButtonElement,
  chooserCancel: document.querySelector("#chooser-cancel") as HTMLButtonElement,
  lobby: document.querySelector("#lobby") as HTMLElement,
  lobbyCode: document.querySelector("#lobby-code") as HTMLElement,
  lobbyPlayers: document.querySelector("#lobby-players") as HTMLElement,
  lobbyHint: document.querySelector("#lobby-hint") as HTMLElement,
  startnet: document.querySelector("#startnet") as HTMLButtonElement,
  overlay: document.querySelector("#overlay") as HTMLElement,
  gameover: document.querySelector("#gameover") as HTMLElement,
  gameoverTitle: document.querySelector("#gameover-title") as HTMLElement,
  gameoverSub: document.querySelector("#gameover-sub") as HTMLElement,
  loading: document.querySelector("#loading") as HTMLElement,
  help: document.querySelector("#help") as HTMLElement,
  trade: document.querySelector("#trade") as HTMLButtonElement,
  end: document.querySelector("#end") as HTMLButtonElement,
  continue: document.querySelector("#continue") as HTMLButtonElement,
  resume: document.querySelector("#resume") as HTMLButtonElement,
};

function describeObjective(state: GameState, id: PlayerId): string {
  const player = state.players.find((p) => p.id === id);
  if (!player) return "";
  const o = effectiveObjective(player);
  if (o.kind === "hidden") return "Objetivo secreto";
  if (o.kind === "territories") return `Conquistar ${o.count} territórios`;
  if (o.kind === "territories_min_armies")
    return `Conquistar ${o.count} territórios com ≥${o.minArmies} exércitos`;
  if (o.kind === "continents")
    return `Conquistar: ${o.continents.map((cid) => CONTINENT_BY_ID[cid].name).join(" e ")}`;
  if (o.kind === "continents_plus_one")
    return `Conquistar ${o.continents.map((cid) => CONTINENT_BY_ID[cid].name).join(" + ")} e mais um continente`;
  return `Destruir exércitos ${COLOR_PT[o.color] ?? o.color}`;
}

const PHASES = new Set(["setup_place", "reinforce", "attack", "fortify", "over"]);
const DIFFS = new Set(["recruta", "oficial", "marechal"]);

function loadCampaign(): SavedCampaign | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as SavedCampaign;
    // Structural validation — a corrupt save used to soft-lock the AI loop.
    const s = d?.state;
    if (!s || typeof s !== "object") return null;
    if (!Array.isArray(s.players) || s.players.length < 2) return null;
    if (!s.players.some((p) => p.id === d.humanId)) return null;
    // Turn must belong to a live player, or the AI loop waits forever.
    if (!s.players.some((p) => p.id === s.currentPlayerId && p.alive)) return null;
    // Territory map must be exactly the 42 canonical ids, with sane values —
    // a null entry passes the key check then crashes board.render.
    const tids = Object.keys(s.territories ?? {});
    if (tids.length !== 42 || !tids.every((id) => Object.hasOwn(TERRITORY_BY_ID, id)))
      return null;
    for (const id of tids) {
      const t = (s.territories as Record<string, { ownerId?: unknown; armies?: unknown }>)[id];
      if (
        !t ||
        typeof t.ownerId !== "string" ||
        !Number.isInteger(t.armies) ||
        (t.armies as number) < 1 ||
        !s.players.some((p) => p.id === t.ownerId)
      )
        return null;
    }
    if (!PHASES.has(s.phase)) return null;
    // Ordem de turnos e pools de reforço — sem eles reduce/paint quebram.
    if (
      !Array.isArray(s.playerOrder) ||
      s.playerOrder.length !== s.players.length ||
      !s.players.every((p) => s.playerOrder.includes(p.id))
    )
      return null;
    const atp = s.armiesToPlace;
    if (
      !atp ||
      typeof atp !== "object" ||
      !Number.isInteger(atp.general) ||
      atp.general < 0 ||
      typeof atp.byTerritory !== "object" ||
      atp.byTerritory === null ||
      typeof atp.byContinent !== "object" ||
      atp.byContinent === null
    )
      return null;
    if (!Array.isArray(s.deck) || !Array.isArray(s.discard)) return null;
    for (const p of s.players) {
      if (typeof p.alive !== "boolean" || !Array.isArray(p.cards) || p.objective == null)
        return null;
      if (p.setupRemaining !== undefined && !Number.isInteger(p.setupRemaining)) return null;
    }
    // pendingOccupy: valid ids and a non-empty [min,max] window, else the
    // occupy panel renders zero buttons and everything else is blocked.
    const po = s.pendingOccupy;
    if (po != null) {
      if (typeof po !== "object") return null;
      if (!Object.hasOwn(TERRITORY_BY_ID, po.from) || !Object.hasOwn(TERRITORY_BY_ID, po.to))
        return null;
      if (
        !Number.isInteger(po.minArmies) ||
        !Number.isInteger(po.maxArmies) ||
        po.minArmies < 1 ||
        po.minArmies > po.maxArmies
      )
        return null;
      // A origem precisa poder ceder minArmies — senão nenhum occupy é legal
      // e o jogo trava num pendingOccupy insolúvel.
      const origin = (s.territories as Record<string, { armies: number }>)[po.from];
      if (!origin || origin.armies - 1 < po.minArmies) return null;
    }
    // Every non-human player needs an AI entry, or maybeRunAI parks on them.
    const aiIds = new Set(Array.isArray(d.ai) ? d.ai.map(([id]) => id) : []);
    if (!s.players.every((p) => p.id === d.humanId || aiIds.has(p.id))) return null;
    if (!Array.isArray(d.ai) || !d.ai.every(([id, dd]) => typeof id === "string" && DIFFS.has(dd)))
      return null;
    return d;
  } catch {
    return null;
  }
}

function log(line: string) {
  if (!line) return;
  const p = document.createElement("p");
  p.textContent = line;
  ui.log.prepend(p);
  // Cap o DOM — uma campanha longa geraria milhares de nós no diário.
  while (ui.log.childElementCount > 200) ui.log.lastElementChild?.remove();
}

/** Loga transições vivo→morto com o autor do golpe, se houver. */
function diffLog(prev: GameState, next: GameState) {
  for (const p of next.players) {
    const was = prev.players.find((q) => q.id === p.id);
    if (was?.alive && !p.alive) {
      const killer = next.players.find((q) => q.id === p.killedBy);
      log(
        killer
          ? `${killer.nickname} eliminou ${p.nickname}`
          : `${p.nickname} foi eliminado`,
      );
    }
  }
}

function tName(id: TerritoryId): string {
  return TERRITORY_BY_ID[id]?.name ?? id;
}

function describeAction(a: Action): string {
  switch (a.type) {
    case "place":
      return `posicionou +${a.count} em ${tName(a.territoryId)}`;
    case "trade":
      return "troca de cartas";
    case "endReinforce":
      return "encerrou o reforço";
    case "endAttack":
      return "encerrou os ataques";
    case "attack":
      return `ataque ${tName(a.from)} → ${tName(a.to)}`;
    case "occupy":
      return `ocupou com ${a.armies}`;
    case "fortify":
      return `deslocou ${a.armies}: ${tName(a.from)} → ${tName(a.to)}`;
    case "endTurn":
      return "passou o turno";
    default:
      return "";
  }
}

async function main() {
  const canvasHost = document.querySelector("#board") as HTMLElement;
  let state: GameState | null = null;
  let selected: TerritoryId | null = null;
  let mode: Mode = "hotseat";
  let rng = createSeededRng(Date.now() % 1_000_000);
  let ws: WebSocket | null = null;
  let token = "";
  let roomCode = "";
  let netId: PlayerId = "";
  let netHost = false;
  let netPlayers: { playerId: string; connected: boolean }[] = [];

  // campaign state
  let humanId: PlayerId = "p1";
  let aiPlayers = new Map<PlayerId, Difficulty>();
  let aiTimer: number | null = null;
  let aiThinking = false;
  let lastBattleKey = "";
  let cancelDice: () => void = () => {};
  let errorTimer: number | null = null;
  let placeN = 1;

  function showError(msg: string) {
    ui.error.textContent = msg;
    if (errorTimer !== null) window.clearTimeout(errorTimer);
    errorTimer = window.setTimeout(() => {
      ui.error.textContent = "";
      errorTimer = null;
    }, 7000);
  }

  ui.continue.disabled = loadCampaign() === null;

  // Default WS URL follows the page host: LAN friends join the same machine,
  // and a deployed build no longer points at the visitor's own localhost.
  const wsInput = document.querySelector("#ws") as HTMLInputElement;
  if (!wsInput.value) {
    const scheme = location.protocol === "https:" ? "wss" : "ws";
    wsInput.value = `${scheme}://${location.hostname}:${DEFAULT_WS_PORT}${DEFAULT_WS_PATH}`;
  }

  const board = await createBoard(canvasHost, {
    onTerritory(id) {
      if (!state) return;
      if (mode === "campaign" && (aiThinking || state.currentPlayerId !== humanId)) return;
      const me = mode === "net" ? netId : mode === "campaign" ? humanId : state.currentPlayerId;
      if (state.pendingOccupy) return;
      if (state.phase === "setup_place" || state.phase === "reinforce") {
        const dests = legalTargets(state, me);
        if (!dests.has(id)) {
          selected = id;
          paint();
          return;
        }
        // Setup coloca 1 por vez (regra); no reforço vale o seletor +N.
        const count =
          state.phase === "reinforce" ? Math.min(placeN, placeableNow(state, id)) : 1;
        if (count >= 1) {
          dispatch({ type: "place", playerId: me, territoryId: id, count });
        }
        selected = id;
        return;
      }
      if (!selected) {
        selected = id;
        paint();
        return;
      }
      const dests = legalTargets(state, me);
      if (state.phase === "attack") {
        if (!dests.has(id)) {
          selected = id;
          paint();
          return;
        }
        const from = selected;
        // Território próprio conectado = fortify dentro da fase de ataque.
        if (state.territories[id].ownerId === me) {
          const movable = state.territories[from].armies - 1;
          if (movable < 1) return;
          if (movable === 1) {
            dispatch({ type: "fortify", playerId: me, from, to: id, armies: 1 });
            selected = null;
            paint();
            return;
          }
          showChooser({
            hint: `Deslocar de ${tName(from)} → ${tName(id)}: quantos? (1 a ${movable})`,
            min: 1,
            max: movable,
            onPick: (n) =>
              dispatch({ type: "fortify", playerId: me, from, to: id, armies: n }),
          });
          selected = null;
          paint();
          return;
        }
        const maxDice = Math.min(3, state.territories[from].armies - 1);
        if (maxDice < 1) return;
        if (maxDice === 1) {
          dispatch({ type: "attack", playerId: me, from, to: id, armies: 1 });
          selected = from;
          paint();
          return;
        }
        showChooser({
          hint: `Atacar ${tName(id)} com quantos dados? (1 a ${maxDice})`,
          min: 1,
          max: maxDice,
          onPick: (n) =>
            dispatch({ type: "attack", playerId: me, from, to: id, armies: n as 1 | 2 | 3 }),
        });
        selected = from;
        paint();
        return;
      } else if (state.phase === "fortify") {
        if (!dests.has(id)) {
          selected = id;
          paint();
          return;
        }
        const from = selected;
        const movable = state.territories[from].armies - 1;
        if (movable < 1) return;
        if (movable === 1) {
          dispatch({ type: "fortify", playerId: me, from, to: id, armies: 1 });
          selected = null;
          paint();
          return;
        }
        showChooser({
          hint: `Deslocar de ${tName(from)} → ${tName(id)}: quantos? (1 a ${movable})`,
          min: 1,
          max: movable,
          onPick: (n) =>
            dispatch({ type: "fortify", playerId: me, from, to: id, armies: n }),
        });
        selected = null;
        paint();
        return;
      }
      selected = id;
      paint();
    },
    onEmpty() {
      if (selected) {
        selected = null;
        paint();
      }
    },
  });

  interface ChooserOpts {
  hint: string;
  min: number;
  max: number;
  onPick: (n: number) => void;
}

let chooserPick: ((n: number) => void) | null = null;

function showChooser(opts: ChooserOpts) {
  ui.chooserHint.textContent = opts.hint;
  ui.chooser.hidden = false;
  chooserPick = opts.onPick;
  ui.chooserN.min = String(opts.min);
  ui.chooserN.max = String(opts.max);
  ui.chooserN.value = String(Math.min(opts.max, Math.max(opts.min, 1)));
  ui.chooserBtns.innerHTML = "";
  // Preset buttons for small ranges (dice), typed input for big fortify moves.
  if (opts.max <= 4) {
    for (let n = opts.min; n <= opts.max; n++) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = String(n);
      b.addEventListener("click", () => {
        hideChooser();
        opts.onPick(n);
      });
      ui.chooserBtns.append(b);
    }
    // Só o input/OK somem — Cancelar fica visível para quem usa mouse.
    ui.chooserN.hidden = true;
    ui.chooserOk.hidden = true;
  } else {
    ui.chooserN.hidden = false;
    ui.chooserOk.hidden = false;
  }
  (opts.max <= 4 ? ui.chooserBtns.querySelector("button")! : ui.chooserN).focus();
}

function hideChooser() {
  ui.chooser.hidden = true;
  chooserPick = null;
}

function updateDice() {
    if (!state) return;
    // Same dice can repeat between battles — mix in turn + total armies so the
    // panel replays every distinct battle.
    const armies = Object.values(state.territories).reduce((sum, t) => sum + t.armies, 0);
    const key = state.lastBattle
      ? `${state.turnIndex}|${armies}|${state.lastBattle.attackDice}|${state.lastBattle.defendDice}`
      : `${state.turnIndex}|none`;
    if (key === lastBattleKey) return;
    lastBattleKey = key;
    cancelDice();
    if (!state.lastBattle) {
      ui.dice.hidden = true;
      ui.dice.innerHTML = "";
      return;
    }
    const hits = state.lastBattle.attackLosses + state.lastBattle.defendLosses;
    board.shake(0.28 + 0.14 * hits);
    const b = state.lastBattle;
    log(
      `dados ${b.attackDice.join("·")} vs ${b.defendDice.join("·")} — ` +
        `atacante perde ${b.attackLosses}, defensor perde ${b.defendLosses}`,
    );
    cancelDice = showBattle(ui.dice, state.lastBattle);
  }

  // Armies this territory may still receive from the pending pools
  // (territory-locked + continent-locked + general). Mirrors legal.ts.
  function placeableNow(s: GameState, id: TerritoryId): number {
    const t = s.armiesToPlace;
    return (
      (t.byTerritory[id] ?? 0) + (t.byContinent[territoryContinent(id)] ?? 0) + t.general
    );
  }

  function legalTargets(s: GameState, me: PlayerId): Set<TerritoryId> {
    const out = new Set<TerritoryId>();
    if (s.currentPlayerId !== me || s.pendingOccupy) return out;
    if (s.phase === "setup_place" || s.phase === "reinforce") {
      for (const a of listLegalActions(s, me)) {
        if (a.type === "place") out.add(a.territoryId);
      }
      return out;
    }
    if (s.phase !== "attack" && s.phase !== "fortify") return out;
    const legal = listLegalActions(s, me);
    const kinds =
      s.phase === "attack"
        ? // Na fase de ataque o engine também permite fortify — clique em
          // território próprio conectado desloca e encerra o ataque.
          (a: Action) => a.type === "attack" || a.type === "fortify"
        : (a: Action) => a.type === "fortify";
    const moves = legal.filter(kinds);
    if (selected) {
      // destinations reachable from the selected origin
      for (const a of moves) {
        if ((a.type === "attack" || a.type === "fortify") && a.from === selected) out.add(a.to);
      }
    } else {
      // nothing selected yet: light up the valid origins so the move is findable
      for (const a of moves) {
        if (a.type === "attack" || a.type === "fortify") out.add(a.from);
      }
    }
    return out;
  }

  const myTurn0 = (s: GameState, me: PlayerId) => s.currentPlayerId === me;

  let lastPhase: GameState["phase"] | null = null;
  let lastCurrent: PlayerId | null = null;
  let objectiveRevealedFor: PlayerId | null = null;

  function paint() {
    const s = state;
    if (!s) return;
    // Seleção não atravessa turno/fase — um clique a mais na vez seguinte não
    // deve despejar o pool num território escolhido sem querer antes. A
    // revelação do objetivo no hotseat também expira com a vez.
    if (s.phase !== lastPhase || s.currentPlayerId !== lastCurrent) {
      selected = null;
      objectiveRevealedFor = null;
    }
    lastPhase = s.phase;
    lastCurrent = s.currentPlayerId;
    const me =
      mode === "net"
        ? netId || s.currentPlayerId
        : mode === "campaign"
          ? humanId
          : s.currentPlayerId;
    board.render(s, selected, me, legalTargets(s, me));
    const p = s.players.find((pl) => pl.id === me);
    const cur = s.players.find((pl) => pl.id === s.currentPlayerId);
    ui.phase.textContent = PHASE_PT[s.phase] ?? s.phase;
    ui.turn.textContent = `${cur?.nickname ?? s.currentPlayerId} (${COLOR_PT[cur?.color ?? ""] ?? cur?.color ?? ""})`;
    // Hotseat divide a tela: o objetivo fica mascarado até o jogador da vez
    // tocar — os adversários no mesmo PC não leem de graça.
    const objMasked = mode === "hotseat" && objectiveRevealedFor !== me;
    ui.objective.textContent = objMasked ? "toque para revelar" : describeObjective(s, me);
    ui.objective.dataset.masked = objMasked ? "1" : "";
    const pool = pendingPlaceTotal(s.armiesToPlace);
    const poolOwner = myTurn0(s, me) ? "" : ` (de ${cur?.nickname ?? s.currentPlayerId})`;
    ui.pending.textContent =
      s.phase === "setup_place"
        ? // Na vez dos outros o número exibido é o deles, não o do viewer.
          `setup: restam ${(myTurn0(s, me) ? p : cur)?.setupRemaining ?? 0} tropas${poolOwner}`
        : `pendentes${poolOwner}: ${pool} | troca obrigatória: ${s.mustTrade ? "sim" : "não"}`;

    ui.status.hidden = false;
    const myTurn = s.currentPlayerId === me;
    if (s.phase === "over") {
      const winner = s.players.find((pl) => pl.id === s.winnerId);
      const iWon = mode === "hotseat" ? false : s.winnerId === me;
      ui.status.textContent = iWon
        ? "Vitória"
        : `Fim de jogo — venceu ${winner?.nickname ?? "?"}`;
      ui.status.dataset.tone = iWon ? "win" : "lose";
    } else if (s.phase === "setup_place" && myTurn) {
      ui.status.textContent = `Setup — posicione 1 tropa (restam ${p?.setupRemaining ?? 0})`;
      ui.status.dataset.tone = "you";
    } else if (myTurn && s.mustTrade) {
      ui.status.textContent = "Troca obrigatória — selecione 3 cartas";
      ui.status.dataset.tone = "you";
    } else if (myTurn) {
      ui.status.textContent =
        mode === "net" || mode === "campaign" ? "Sua vez" : `Vez de ${cur?.nickname ?? me}`;
      ui.status.dataset.tone = "you";
    } else if (mode === "campaign") {
      ui.status.textContent = `IA pensando — ${cur?.nickname ?? s.currentPlayerId}`;
      ui.status.dataset.tone = "ai";
    } else {
      ui.status.textContent = `Vez de ${cur?.nickname ?? s.currentPlayerId}`;
      ui.status.dataset.tone = "ai";
    }

    paintRoster(s, me);

    const mineCards = p?.cards ?? [];
    // Repaints (broadcasts de roster/state) não devem zerar o trio escolhido.
    const picked = new Set(
      [...ui.cards.querySelectorAll("button.on")].map(
        (el) => (el as HTMLElement).dataset.card,
      ),
    );
    // Na troca obrigatória, o engine já enumera os trios legais — acende quais
    // cartas participam de algum para não virar tentativa e erro.
    const tradeable = new Set<string>();
    if (s.mustTrade && s.currentPlayerId === me) {
      for (const a of listLegalActions(s, me)) {
        if (a.type === "trade") for (const id of a.cardIds) tradeable.add(id);
      }
    }
    ui.cards.innerHTML = "";
    ui.cardsEmpty.hidden = mineCards.length > 0;
    for (const c of mineCards) {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.card = c.id;
      if (picked.has(c.id)) b.classList.add("on");
      if (tradeable.size > 0) b.classList.toggle("tradeable", tradeable.has(c.id));
      const image = document.createElement("img");
      image.src = `/assets/card-${c.shape}.png`;
      image.alt = "";
      const label = document.createElement("span");
      label.textContent = c.kind === "joker" ? "coringa" : TERRITORY_BY_ID[c.territoryId].name;
      b.append(image, label);
      b.addEventListener("click", () => b.classList.toggle("on"));
      ui.cards.append(b);
    }

    const humanTurn =
      s.currentPlayerId === me &&
      s.phase !== "over" &&
      !(mode === "campaign" && aiThinking);
    ui.end.disabled =
      !humanTurn ||
      !!s.pendingOccupy ||
      s.phase === "setup_place" ||
      s.mustTrade ||
      (s.phase === "reinforce" && pool > 0);
    ui.trade.disabled =
      !humanTurn || !!s.pendingOccupy || !(s.phase === "reinforce" || s.mustTrade);
    ui.placen.hidden =
      !humanTurn || s.phase !== "reinforce" || !!s.pendingOccupy;
    if (s.phase === "setup_place") ui.end.textContent = "Posicione tropas";
    else if (s.phase === "reinforce") ui.end.textContent = "Encerrar reforço";
    else if (s.phase === "attack") ui.end.textContent = "Ir ao deslocamento";
    else if (s.phase === "fortify")
      ui.end.textContent = s.fortifiedThisTurn ? "Passar o turno" : "Deslocar ou passar";
    else ui.end.textContent = "Encerrar fase";
    if (s.phase === "fortify" && myTurn && !s.mustTrade && !s.fortifiedThisTurn) {
      ui.status.textContent = "Deslocamento — 1 transferência (opcional)";
      ui.status.dataset.tone = "you";
    } else if (s.phase === "fortify" && myTurn && !s.mustTrade && s.fortifiedThisTurn) {
      ui.status.textContent = "Deslocamento usado — passe o turno";
      ui.status.dataset.tone = "you";
    }

    paintOccupy(s, me);
    ui.logEmpty.hidden = ui.log.childElementCount > 0;
    updateDice();
  }

  function paintRoster(s: GameState, me: PlayerId) {
    ui.roster.innerHTML = "";
    for (const p of s.players) {
      const li = document.createElement("li");
      const territories = Object.values(s.territories).filter(
        (t) => t.ownerId === p.id,
      ).length;
      li.dataset.color = p.color;
      if (p.id === s.currentPlayerId) li.dataset.turn = "1";
      if (!p.alive) li.dataset.dead = "1";
      const offline =
        mode === "net" &&
        netPlayers.some((np) => np.playerId === p.id && !np.connected);
      const who =
        (p.id === me && mode !== "hotseat" ? `${p.nickname} (você)` : p.nickname) +
        (offline ? " (offline)" : "");
      li.innerHTML = `<i></i><span></span><em>${territories}t · ${p.cards.length}c</em>`;
      li.querySelector("span")!.textContent = who;
      ui.roster.append(li);
    }
  }

  function updateLobby(players?: { nickname: string; connected: boolean }[]) {
    if (mode !== "net" || !roomCode || (state && state.phase !== "over")) {
      ui.lobby.hidden = true;
      return;
    }
    ui.lobby.hidden = false;
    // O lobby mora dentro de <details> — se estiver recolhido parece que o
    // join falhou.
    (document.querySelector("#netmodes") as HTMLDetailsElement | null)?.setAttribute("open", "");
    ui.lobbyCode.textContent = roomCode;
    if (players) {
      ui.lobbyPlayers.innerHTML = "";
      for (const p of players) {
        const li = document.createElement("li");
        li.textContent = p.nickname + (p.connected ? "" : " (offline)");
        ui.lobbyPlayers.append(li);
      }
    }
    ui.startnet.disabled = !netHost;
    ui.lobbyHint.textContent = netHost
      ? "Você é o host — inicie quando todos entrarem."
      : "Aguardando o host iniciar…";
  }

  let lastOccupyKey = "";

  function paintOccupy(s: GameState, me: PlayerId) {
    const pend = s.pendingOccupy;
    const mine = s.currentPlayerId === me && !aiThinking;
    if (!pend || !mine) {
      ui.occupy.hidden = true;
      ui.occupyBtns.innerHTML = "";
      lastOccupyKey = "";
      return;
    }
    ui.occupy.hidden = false;
    ui.status.hidden = false;
    ui.status.textContent = "Conquista — ocupe o território";
    ui.status.dataset.tone = "you";
    ui.occupyHint.textContent = `${tName(pend.to)}: ${pend.minArmies} a ${pend.maxArmies} exércitos (1 fica na origem)`;
    // Rebuild só quando a janela muda — conquista de 60 exércitos geraria
    // 59 botões por repaint.
    const key = `${pend.to}:${pend.minArmies}:${pend.maxArmies}`;
    if (key === lastOccupyKey) return;
    lastOccupyKey = key;
    ui.occupyBtns.innerHTML = "";
    for (let n = pend.minArmies; n <= pend.maxArmies; n++) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = String(n);
      b.addEventListener("click", () => dispatch({ type: "occupy", playerId: me, armies: n }));
      ui.occupyBtns.append(b);
    }
  }

  /** Ponto único de aplicação de estado — loga eliminações (vivo→morto). */
  function commitState(next: GameState | null) {
    const prev = state;
    state = next;
    if (prev && next) diffLog(prev, next);
    if (mode === "campaign") saveCampaign();
  }

  function applyLocal(action: Action): boolean {
    if (!state) return false;
    try {
      const r = reduce(state, action, rng);
      if (!r.ok) {
        showError(r.error);
        return false;
      }
      ui.error.textContent = "";
      commitState(r.state);
      return true;
    } catch {
      // Estado corrompido que passou pela validação do save — vira toast em
      // vez de exceção que mata todos os handlers de clique.
      showError("estado inválido — ação rejeitada");
      return false;
    }
  }

  function dispatch(action: Action) {
    if (!state) return;
    if (mode === "net") {
      if (ws?.readyState !== WebSocket.OPEN) {
        showError("sem conexão — reconectando");
        tryReconnect();
        return;
      }
      const msg: C2S = { type: "action", action };
      ws.send(JSON.stringify(msg));
      return;
    }
    hideChooser();
    if (!applyLocal(action)) {
      paint();
      return;
    }
    log(describeAction(action));
    paint();
    if (state?.phase === "over") onGameOver();
    else if (mode === "campaign") maybeRunAI();
  }

  function saveCampaign() {
    if (mode !== "campaign" || !state) return;
    try {
      const data: SavedCampaign = { state, ai: [...aiPlayers.entries()], humanId };
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch {
      /* storage full / blocked — ignore, game keeps playing */
    }
  }

  function stopAI() {
    if (aiTimer !== null) {
      window.clearTimeout(aiTimer);
      aiTimer = null;
    }
    aiThinking = false;
  }

  function maybeRunAI() {
    if (mode !== "campaign" || !state) return;
    if (state.phase === "over") {
      onGameOver();
      return;
    }
    if (!aiPlayers.has(state.currentPlayerId)) {
      aiThinking = false;
      return;
    }
    aiThinking = true;
    paint();
    const setup = state.phase === "setup_place";
    aiTimer = window.setTimeout(stepAI, reducedMotion ? 8 : setup ? 36 : 160);
  }

  // Last-resort move: the engine guarantees ≥1 legal action for the player on
  // turn, so walk listLegalActions until one applies (covers occupy/trade too).
  function aiFallback(pid: PlayerId): boolean {
    if (!state) return false;
    try {
      for (const a of listLegalActions(state, pid)) {
        const r = reduce(state, a, rng);
        if (r.ok) {
          commitState(r.state);
          return true;
        }
      }
    } catch {
      /* corrupt state — caller halts the loop */
    }
    return false;
  }

  function stepAI() {
    aiTimer = null;
    if (mode !== "campaign" || !state) return;
    const pid = state.currentPlayerId;
    try {
      stepAIInner(pid);
    } catch {
      // Engine threw on a corrupt/unexpected state — recover via fallback or halt.
      if (!aiFallback(pid)) {
        aiThinking = false;
        paint();
        return;
      }
      if (state.phase === "over") {
        onGameOver();
        return;
      }
      if (aiPlayers.has(state.currentPlayerId)) {
        aiTimer = window.setTimeout(stepAI, reducedMotion ? 8 : 200);
      } else {
        aiThinking = false;
        paint();
      }
    }
  }

  function stepAIInner(pid: PlayerId) {
    const diff = aiPlayers.get(pid);
    if (!diff || !state) {
      aiThinking = false;
      paint();
      return;
    }
    const nick = state.players.find((p) => p.id === pid)?.nickname ?? pid;
    const action = aiChooseAction(state, pid, diff);
    let halted = false;
    if (!action) {
      halted = !aiFallback(pid);
      if (halted) log(`IA ${nick} sem jogada legal — turno travado (use Abandonar)`);
    } else {
      const r = reduce(state, action, rng);
      if (r.ok) {
        commitState(r.state);
        log(`${nick}: ${describeAction(action)}`);
      } else {
        halted = !aiFallback(pid);
        if (halted) log(`IA ${nick} travou (${r.error}) — use Abandonar`);
      }
    }
    paint();
    if (state.phase === "over") {
      onGameOver();
      return;
    }
    if (halted) {
      aiThinking = false;
      return;
    }
    if (aiPlayers.has(state.currentPlayerId)) {
      const delay = reducedMotion
        ? 8
        : action?.type === "attack"
          ? 340
          : action?.type === "occupy"
            ? 240
            : state.phase === "setup_place" || action?.type === "place"
              ? 36
              : 120;
      aiTimer = window.setTimeout(stepAI, delay);
    } else {
      aiThinking = false;
      paint();
    }
  }

  function onGameOver() {
    stopAI();
    const s = state;
    if (!s) return;
    if (mode === "campaign") {
      localStorage.removeItem(SAVE_KEY);
      ui.continue.disabled = true;
    }
    const me = mode === "net" ? netId : mode === "campaign" ? humanId : "";
    const won = me !== "" && s.winnerId === me;
    const winner = s.players.find((p) => p.id === s.winnerId);
    ui.gameoverTitle.textContent = won
      ? "Vitória"
      : mode === "hotseat"
        ? "Fim de jogo"
        : "Derrota";
    ui.gameoverSub.textContent = won
      ? "Você cumpriu o objetivo."
      : `Venceu ${winner?.nickname ?? "?"}.`;
    ui.overlay.hidden = true;
    ui.gameover.hidden = false;
    document.querySelector<HTMLButtonElement>("#gameover-title-btn")?.focus();
    paint();
  }

  function hideOverlays() {
    ui.overlay.hidden = true;
    ui.gameover.hidden = true;
    ui.loading.hidden = true;
    ui.help.hidden = true;
    cancelDice();
    ui.dice.hidden = true;
    ui.dice.innerHTML = "";
  }

  function startCampaign(aiCount: number, diff: Difficulty) {
    stopAI();
    const total = Math.min(6, Math.max(2, aiCount + 1));
    const players: { id: PlayerId; nickname: string; color: (typeof COLORS)[number] }[] = [
      { id: "p1", nickname: "Você", color: COLORS[0]! },
    ];
    for (let i = 1; i < total; i++) {
      players.push({ id: `p${i + 1}`, nickname: AI_NAMES[i - 1] ?? `IA ${i}`, color: COLORS[i]! });
    }
    rng = createSeededRng(Date.now() % 1_000_000);
    mode = "campaign";
    humanId = "p1";
    aiPlayers = new Map(players.slice(1).map((p) => [p.id, diff] as [PlayerId, Difficulty]));
    leaveRoom();
    sessionStorage.removeItem("war2");

    ui.overlay.hidden = true;
    ui.loading.hidden = false;
    window.setTimeout(() => {
      // Se o usuário abriu outro modo nos ~40ms de espera, não aterrissa a
      // campanha por cima.
      if (mode !== "campaign") return;
      // Campaign: human places first in setup and takes turn 1 after it.
      state = createGame({ players, rng, firstPlayerId: humanId });
      selected = null;
      lastBattleKey = "x";
      ui.log.innerHTML = "";
      hideOverlays();
      saveCampaign();
      ui.continue.disabled = false;
      log(`nova campanha — ${aiCount} IA(s) ${diff}`);
      paint();
      maybeRunAI();
    }, 40);
  }

  function continueCampaign() {
    const saved = loadCampaign();
    if (!saved) {
      ui.continue.disabled = true;
      return;
    }
    stopAI();
    mode = "campaign";
    humanId = saved.humanId;
    aiPlayers = new Map(saved.ai);
    rng = createSeededRng(Date.now() % 1_000_000);
    state = saved.state;
    selected = null;
    lastBattleKey = "x";
    leaveRoom();
    sessionStorage.removeItem("war2");
    hideOverlays();
    log("campanha retomada");
    paint();
    maybeRunAI();
  }

  function leaveRoom() {
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: "leave" } satisfies C2S));
      } catch {
        /* socket dying anyway */
      }
    }
    const old = ws;
    ws = null;
    roomCode = "";
    netHost = false;
    old?.close();
  }

  function goToTitle() {
    stopAI();
    cancelDice();
    hideChooser();
    ui.dice.hidden = true;
    ui.occupy.hidden = true;
    ui.placen.hidden = true;
    ui.gameover.hidden = true;
    ui.loading.hidden = true;
    ui.help.hidden = true;
    ui.continue.disabled = loadCampaign() === null;
    ui.resume.hidden = !state || state.phase === "over";
    ui.overlay.hidden = false;
    updateLobby();
    // Traz o foco pro diálogo — teclado não fica preso no tabuleiro ao fundo.
    (ui.resume.hidden
      ? document.querySelector<HTMLButtonElement>("#campaign")
      : ui.resume
    )?.focus();
  }

  function abandonCampaign() {
    stopAI();
    // "Abandonar" só apaga o save quando o jogo abandonado É a campanha —
    // sair de um hotseat/sala não pode destruir a campanha pausada.
    if (mode === "campaign") localStorage.removeItem(SAVE_KEY);
    if (mode === "net") {
      leaveRoom();
      sessionStorage.removeItem("war2");
      token = "";
    }
    state = null;
    selected = null;
    ui.log.innerHTML = "";
    goToTitle();
  }

  board.app.ticker.add(() => {
    ui.fps.textContent = `${board.fps().toFixed(0)} fps (sem cap)`;
  });

  ui.end.addEventListener("click", () => {
    if (!state) return;
    if (mode === "campaign" && (aiThinking || state.currentPlayerId !== humanId)) return;
    const me = mode === "net" ? netId : mode === "campaign" ? humanId : state.currentPlayerId;
    if (state.phase === "reinforce") dispatch({ type: "endReinforce", playerId: me });
    else if (state.phase === "attack") dispatch({ type: "endAttack", playerId: me });
    else if (state.phase === "fortify") dispatch({ type: "endTurn", playerId: me });
  });

  ui.trade.addEventListener("click", () => {
    if (!state) return;
    if (mode === "campaign" && (aiThinking || state.currentPlayerId !== humanId)) return;
    const me = mode === "net" ? netId : mode === "campaign" ? humanId : state.currentPlayerId;
    const ids = [...ui.cards.querySelectorAll("button.on")].map(
      (el) => (el as HTMLElement).dataset.card!,
    );
    if (ids.length !== 3) {
      showError("selecione 3 cartas");
      return;
    }
    dispatch({ type: "trade", playerId: me, cardIds: ids });
  });

  document.querySelector("#campaign")?.addEventListener("click", () => {
    const n = Number((document.querySelector("#aicount") as HTMLSelectElement).value);
    const diff = (document.querySelector("#aidiff") as HTMLSelectElement).value as Difficulty;
    startCampaign(n, diff);
  });
  ui.continue.addEventListener("click", () => continueCampaign());
  ui.resume.addEventListener("click", () => {
    ui.overlay.hidden = true;
    paint();
    if (mode === "campaign") maybeRunAI();
  });
  ui.objective.addEventListener("click", () => {
    if (mode !== "hotseat" || !state) return;
    objectiveRevealedFor = state.currentPlayerId;
    paint();
  });
  document.querySelector("#title")?.addEventListener("click", () => goToTitle());
  document.querySelector("#abandon")?.addEventListener("click", () => abandonCampaign());
  document.querySelector("#gameover-title-btn")?.addEventListener("click", () => goToTitle());
  document.querySelector("#help-btn")?.addEventListener("click", () => {
    ui.help.hidden = false;
    document.querySelector<HTMLButtonElement>("#help-close")?.focus();
  });
  document.querySelector("#help-close")?.addEventListener("click", () => {
    ui.help.hidden = true;
  });
  ui.help.addEventListener("click", (e) => {
    if (e.target === ui.help) ui.help.hidden = true;
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (!ui.help.hidden) {
        ui.help.hidden = true;
        return;
      }
      if (!ui.gameover.hidden) {
        goToTitle();
        return;
      }
      if (!ui.chooser.hidden) {
        hideChooser();
        return;
      }
      if (!ui.overlay.hidden) return;
      if (selected) {
        selected = null;
        paint();
        return;
      }
      board.resetView();
      return;
    }
    // Câmera por teclado — não dentro de inputs nem atrás de diálogos.
    const typing =
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLSelectElement ||
      e.target instanceof HTMLTextAreaElement;
    if (!typing && ui.overlay.hidden && ui.help.hidden && ui.gameover.hidden) {
      const PAN = 90;
      if (e.key.startsWith("Arrow")) e.preventDefault();
      if (e.key === "ArrowLeft") return board.panBy(PAN, 0);
      if (e.key === "ArrowRight") return board.panBy(-PAN, 0);
      if (e.key === "ArrowUp") return board.panBy(0, PAN);
      if (e.key === "ArrowDown") return board.panBy(0, -PAN);
      if (e.key === "+" || e.key === "=") return board.zoomBy(1.15);
      if (e.key === "-" || e.key === "_") return board.zoomBy(1 / 1.15);
    }
    if (e.key !== " " && e.code !== "Space") return;
    if (!state || ui.overlay.hidden === false) return;
    if (mode === "campaign" && (aiThinking || state.currentPlayerId !== humanId)) return;
    if (state.phase !== "setup_place" && state.phase !== "reinforce") return;
    e.preventDefault();
    const me = mode === "net" ? netId : mode === "campaign" ? humanId : state.currentPlayerId;
    const dests = legalTargets(state, me);
    const id = selected && dests.has(selected) ? selected : null;
    if (id) {
      const count =
        state.phase === "reinforce" ? Math.min(placeN, placeableNow(state, id)) : 1;
      if (count >= 1) dispatch({ type: "place", playerId: me, territoryId: id, count });
    }
  });

  document.querySelector("#hotseat")?.addEventListener("click", () => {
    const n = Number((document.querySelector("#nplayers") as HTMLSelectElement).value);
    const players = Array.from({ length: n }, (_, i) => ({
      id: `p${i + 1}`,
      nickname: `Jogador ${i + 1}`,
      color: COLORS[i]!,
    }));
    stopAI();
    rng = createSeededRng(Date.now() % 1_000_000);
    mode = "hotseat";
    sessionStorage.removeItem("war2");
    leaveRoom();
    state = createGame({ players, rng });
    selected = null;
    lastBattleKey = "x";
    hideOverlays();
    log(`hotseat ${n} jogadores`);
    paint();
  });

  function tryReconnect() {
    if (mode !== "net" || !token || !roomCode) return;
    const url = (document.querySelector("#ws") as HTMLInputElement).value;
    connect(url, { type: "reconnect", roomCode, token });
  }

  function connect(url: string, send: C2S) {
    const previous = ws;
    let sock: WebSocket;
    try {
      sock = new WebSocket(url);
    } catch {
      // URL malformada: sem toast isso era um clique morto silencioso.
      showError("URL de WebSocket inválida");
      return;
    }
    ws = sock;
    sock.addEventListener("open", () => {
      if (ws !== sock) return;
      sock.send(JSON.stringify(send));
    });
    sock.addEventListener("close", () => {
      if (ws !== sock) return;
      if (mode === "net") {
        showError("conexão perdida — reconectando");
        window.setTimeout(() => {
          if (mode !== "net" || ws !== sock) return;
          tryReconnect();
        }, 600);
      }
    });
    sock.addEventListener("message", (ev) => {
      if (ws !== sock) return; // stale socket — never overwrite current state
      let msg: S2C;
      try {
        msg = JSON.parse(String(ev.data)) as S2C;
      } catch {
        return;
      }
      if (msg.type === "error") {
        showError(msg.message);
        if (/reconnect/i.test(msg.message)) {
          sessionStorage.removeItem("war2");
          token = "";
          roomCode = "";
          netPlayers = [];
          // Não deixa "Voltar ao jogo" reabrir um tabuleiro de sala morta.
          state = null;
          selected = null;
          if (ui.overlay.hidden) goToTitle();
        }
        return;
      }
      if (msg.type === "welcome") {
        if (mode !== "net" && state && ui.overlay.hidden) {
          sock.close();
          return;
        }
        token = msg.token;
        roomCode = msg.roomCode;
        netId = msg.playerId;
        netHost = msg.host;
        netPlayers = msg.players;
        mode = "net";
        commitState(msg.state);
        hideChooser();
        selected = null; // re-sync — autopilot pode ter jogado na nossa ausência
        ui.error.textContent = "";
        sessionStorage.setItem("war2", JSON.stringify({ token, roomCode, url }));
        log(`sala ${roomCode}`);
        if (msg.state) {
          if (msg.state.phase === "over") onGameOver();
          else {
            hideOverlays();
            paint();
          }
        } else {
          updateLobby(msg.players);
        }
        return;
      }
      if (msg.type === "room") {
        netHost = msg.host;
        netPlayers = msg.players;
        if (msg.state) {
          // Só fecha overlays quando uma partida NOVA chega (lobby→jogo ou
          // rematch após over) — broadcast mid-game não pode derrubar o menu.
          const fresh = !state || state.phase === "over";
          commitState(msg.state);
          ui.error.textContent = "";
          // Sem hideChooser: broadcasts de roster (reconnect de terceiros)
          // não devem cancelar uma decisão de ataque em curso.
          if (msg.state.phase === "over") onGameOver();
          else {
            if (fresh) hideOverlays();
            paint();
          }
        } else {
          updateLobby(msg.players);
        }
        return;
      }
      if (msg.type === "state") {
        // Idem: partida nova puxa o jogador para o tabuleiro; progresso
        // mid-game respeita o Título aberto.
        const fresh = !state || state.phase === "over";
        commitState(msg.state);
        ui.error.textContent = "";
        hideChooser();
        selected = null; // seleção pode apontar p/ território que mudou de dono
        if (msg.state.phase === "over") {
          onGameOver();
          return;
        }
        if (fresh) hideOverlays();
        paint();
      }
    });
    previous?.close();
  }

  document.querySelector("#create")?.addEventListener("click", () => {
    const nick = (document.querySelector("#nick") as HTMLInputElement).value || "Host";
    const url = (document.querySelector("#ws") as HTMLInputElement).value;
    stopAI();
    mode = "net";
    connect(url, { type: "create", nickname: nick });
  });
  document.querySelector("#join")?.addEventListener("click", () => {
    const nick = (document.querySelector("#nick") as HTMLInputElement).value || "Guest";
    const code = (document.querySelector("#code") as HTMLInputElement).value.trim().toUpperCase();
    const url = (document.querySelector("#ws") as HTMLInputElement).value;
    stopAI();
    mode = "net";
    connect(url, { type: "join", roomCode: code, nickname: nick });
  });
  ui.chooserOk.addEventListener("click", () => {
    const pick = chooserPick;
    const lo = Number(ui.chooserN.min) || 1;
    const hi = Number(ui.chooserN.max) || 1;
    const n = Math.min(hi, Math.max(lo, Math.round(Number(ui.chooserN.value) || lo)));
    hideChooser();
    pick?.(n);
  });
  ui.chooserCancel.addEventListener("click", hideChooser);
  ui.placen.querySelectorAll("button").forEach((b) => {
    b.addEventListener("click", () => {
      placeN = Number((b as HTMLElement).dataset.n) || 1;
      ui.placen
        .querySelectorAll("button")
        .forEach((x) => x.classList.toggle("on", x === b));
    });
  });

  document.querySelector("#startnet")?.addEventListener("click", () => {
    if (ws?.readyState !== WebSocket.OPEN) {
      showError("sem conexão");
      return;
    }
    ws.send(JSON.stringify({ type: "start" } satisfies C2S));
  });

  const saved = sessionStorage.getItem("war2");
  if (saved) {
    try {
      const s = JSON.parse(saved) as { token: string; roomCode: string; url: string };
      // Popular token/roomCode ANTES do connect — se o primeiro socket cair
      // sem welcome, o tryReconnect depende deles para tentar de novo.
      token = s.token;
      roomCode = s.roomCode;
      mode = "net";
      connect(s.url, { type: "reconnect", roomCode: s.roomCode, token: s.token });
    } catch {
      /* ignore */
    }
  }
}

void main();
