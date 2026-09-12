import {
  CONTINENT_BY_ID,
  TERRITORY_BY_ID,
  aiChooseAction,
  createGame,
  createSeededRng,
  effectiveObjective,
  listLegalActions,
  pendingPlaceTotal,
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
  return `Destruir exércitos ${o.color}`;
}

function loadCampaign(): SavedCampaign | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as SavedCampaign;
    if (!d?.state?.players?.length || !d.humanId) return null;
    return d;
  } catch {
    return null;
  }
}

function log(line: string) {
  const p = document.createElement("p");
  p.textContent = line;
  ui.log.prepend(p);
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
  let viewer: PlayerId = "p1";
  let mode: Mode = "hotseat";
  let rng = createSeededRng(Date.now() % 1_000_000);
  let ws: WebSocket | null = null;
  let token = "";
  let roomCode = "";
  let netId: PlayerId = "";
  let netHost = false;

  // campaign state
  let humanId: PlayerId = "p1";
  let aiPlayers = new Map<PlayerId, Difficulty>();
  let aiTimer: number | null = null;
  let aiThinking = false;
  let lastBattleKey = "";
  let cancelDice: () => void = () => {};

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
      viewer = me;
      if (state.pendingOccupy) return;
      if (state.phase === "setup_place" || state.phase === "reinforce") {
        const dests = legalTargets(state, me);
        if (!dests.has(id)) {
          selected = id;
          paint();
          return;
        }
        dispatch({ type: "place", playerId: me, territoryId: id, count: 1 });
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
        const n = Math.min(3, state.territories[from].armies - 1);
        if (n === 1 || n === 2 || n === 3) {
          dispatch({ type: "attack", playerId: me, from, to: id, armies: n });
        }
      } else if (state.phase === "fortify") {
        if (!dests.has(id)) {
          selected = id;
          paint();
          return;
        }
        const from = selected;
        const armies = state.territories[from].armies - 1;
        if (armies >= 1) dispatch({ type: "fortify", playerId: me, from, to: id, armies });
      }
      selected = id;
    },
  });

  function updateDice() {
    if (!state) return;
    const key = state.lastBattle ? JSON.stringify(state.lastBattle) : "";
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
    const kind = s.phase === "attack" ? "attack" : "fortify";
    const legal = listLegalActions(s, me).filter((a) => a.type === kind);
    if (selected) {
      // destinations reachable from the selected origin
      for (const a of legal) {
        if ((a.type === "attack" || a.type === "fortify") && a.from === selected) out.add(a.to);
      }
    } else {
      // nothing selected yet: light up the valid origins so the move is findable
      for (const a of legal) {
        if (a.type === "attack" || a.type === "fortify") out.add(a.from);
      }
    }
    return out;
  }

  function paint() {
    const s = state;
    if (!s) return;
    const me =
      mode === "net"
        ? netId || s.currentPlayerId
        : mode === "campaign"
          ? humanId
          : s.currentPlayerId;
    viewer = me;
    board.render(s, selected, me, legalTargets(s, me));
    const p = s.players.find((pl) => pl.id === me);
    const cur = s.players.find((pl) => pl.id === s.currentPlayerId);
    ui.phase.textContent = s.phase;
    ui.turn.textContent = `${cur?.nickname ?? s.currentPlayerId} (${cur?.color ?? ""})`;
    ui.objective.textContent = describeObjective(s, me);
    ui.pending.textContent =
      s.phase === "setup_place"
        ? `setup: restam ${p?.setupRemaining ?? 0} tropas`
        : `pendentes: ${pendingPlaceTotal(s.armiesToPlace)} | troca obrigatória: ${s.mustTrade ? "sim" : "não"}`;

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
    ui.cards.innerHTML = "";
    ui.cardsEmpty.hidden = mineCards.length > 0;
    for (const c of mineCards) {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.card = c.id;
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
      mode !== "campaign" ||
      (s.currentPlayerId === humanId && !aiThinking && s.phase !== "over");
    ui.end.disabled = !humanTurn || !!s.pendingOccupy || s.phase === "setup_place";
    ui.trade.disabled = !humanTurn || s.phase === "setup_place";
    if (s.phase === "setup_place") ui.end.textContent = "Posicione tropas";
    else if (s.phase === "reinforce") ui.end.textContent = "Encerrar reforço";
    else if (s.phase === "attack") ui.end.textContent = "Ir ao deslocamento";
    else if (s.phase === "fortify") ui.end.textContent = "Passar o turno";
    else ui.end.textContent = "Encerrar fase";

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
      const who = p.id === me && mode !== "hotseat" ? `${p.nickname} (você)` : p.nickname;
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

  function paintOccupy(s: GameState, me: PlayerId) {
    const pend = s.pendingOccupy;
    const mine = s.currentPlayerId === me && !aiThinking;
    if (!pend || !mine) {
      ui.occupy.hidden = true;
      ui.occupyBtns.innerHTML = "";
      return;
    }
    ui.occupy.hidden = false;
    ui.status.hidden = false;
    ui.status.textContent = "Conquista — ocupe o território";
    ui.status.dataset.tone = "you";
    ui.occupyHint.textContent = `${pend.to}: ${pend.minArmies} a ${pend.maxArmies} exércitos (1 fica na origem)`;
    ui.occupyBtns.innerHTML = "";
    for (let n = pend.minArmies; n <= pend.maxArmies; n++) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = String(n);
      b.addEventListener("click", () => dispatch({ type: "occupy", playerId: me, armies: n }));
      ui.occupyBtns.append(b);
    }
  }

  function applyLocal(action: Action) {
    if (!state) return;
    const r = reduce(state, action, rng);
    if (!r.ok) {
      ui.error.textContent = r.error;
      return;
    }
    ui.error.textContent = "";
    state = r.state;
    if (mode === "campaign") saveCampaign();
  }

  function dispatch(action: Action) {
    if (!state) return;
    if (mode === "net") {
      if (ws?.readyState !== WebSocket.OPEN) {
        ui.error.textContent = "sem conexão — reconectando";
        tryReconnect();
        return;
      }
      const msg: C2S = { type: "action", action };
      ws.send(JSON.stringify(msg));
      return;
    }
    applyLocal(action);
    if (ui.error.textContent === "") log(describeAction(action));
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

  function stepAI() {
    aiTimer = null;
    if (mode !== "campaign" || !state) return;
    const pid = state.currentPlayerId;
    const diff = aiPlayers.get(pid);
    if (!diff) {
      aiThinking = false;
      paint();
      return;
    }
    const action = aiChooseAction(state, pid, diff);
    if (!action) {
      aiThinking = false;
      paint();
      return;
    }
    const r = reduce(state, action, rng);
    if (r.ok) {
      state = r.state;
      saveCampaign();
    } else {
      const safe = reduce(state, { type: "endTurn", playerId: pid }, rng);
      if (safe.ok) state = safe.state;
    }
    paint();
    if (state.phase === "over") {
      onGameOver();
      return;
    }
    if (aiPlayers.has(state.currentPlayerId)) {
      const delay = reducedMotion
        ? 8
        : action.type === "attack"
          ? 340
          : action.type === "occupy"
            ? 240
            : state.phase === "setup_place" || action.type === "place"
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
    ui.gameover.hidden = false;
    paint();
  }

  function hideOverlays() {
    ui.overlay.hidden = true;
    ui.gameover.hidden = true;
    ui.loading.hidden = true;
    ui.help.hidden = true;
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
    ws?.close();
    ws = null;
    roomCode = "";
    netHost = false;

    ui.overlay.hidden = true;
    ui.loading.hidden = false;
    window.setTimeout(() => {
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
    ws?.close();
    ws = null;
    hideOverlays();
    log("campanha retomada");
    paint();
    maybeRunAI();
  }

  function goToTitle() {
    stopAI();
    cancelDice();
    ui.dice.hidden = true;
    ui.occupy.hidden = true;
    ui.gameover.hidden = true;
    ui.loading.hidden = true;
    ui.help.hidden = true;
    ui.continue.disabled = loadCampaign() === null;
    ui.resume.hidden = !state || state.phase === "over";
    ui.overlay.hidden = false;
    updateLobby();
  }

  function abandonCampaign() {
    stopAI();
    localStorage.removeItem(SAVE_KEY);
    state = null;
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
      ui.error.textContent = "selecione 3 cartas";
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
  document.querySelector("#title")?.addEventListener("click", () => goToTitle());
  document.querySelector("#abandon")?.addEventListener("click", () => abandonCampaign());
  document.querySelector("#gameover-title-btn")?.addEventListener("click", () => goToTitle());
  document.querySelector("#help-btn")?.addEventListener("click", () => {
    ui.help.hidden = false;
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
      if (!ui.overlay.hidden) return;
      if (selected) {
        selected = null;
        paint();
        return;
      }
      board.resetView();
      return;
    }
    if (e.key !== " " && e.code !== "Space") return;
    if (!state || ui.overlay.hidden === false) return;
    if (mode === "campaign" && (aiThinking || state.currentPlayerId !== humanId)) return;
    if (state.phase !== "setup_place" && state.phase !== "reinforce") return;
    e.preventDefault();
    const me = mode === "net" ? netId : mode === "campaign" ? humanId : state.currentPlayerId;
    const dests = legalTargets(state, me);
    const id = selected && dests.has(selected) ? selected : null;
    if (id) dispatch({ type: "place", playerId: me, territoryId: id, count: 1 });
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
    const old = ws;
    ws = null;
    roomCode = "";
    netHost = false;
    old?.close();
    state = createGame({ players, rng });
    selected = null;
    lastBattleKey = "";
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
    ws = new WebSocket(url);
    const sock = ws;
    sock.addEventListener("open", () => {
      if (ws !== sock) return;
      sock.send(JSON.stringify(send));
    });
    sock.addEventListener("close", () => {
      if (ws !== sock) return;
      if (mode === "net") {
        ui.error.textContent = "conexão perdida — reconectando";
        window.setTimeout(() => {
          if (mode !== "net" || ws !== sock) return;
          tryReconnect();
        }, 600);
      }
    });
    sock.addEventListener("message", (ev) => {
      const msg = JSON.parse(String(ev.data)) as S2C;
      if (msg.type === "error") {
        ui.error.textContent = msg.message;
        if (/reconnect/i.test(msg.message)) {
          sessionStorage.removeItem("war2");
          token = "";
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
        mode = "net";
        state = msg.state;
        ui.error.textContent = "";
        sessionStorage.setItem("war2", JSON.stringify({ token, roomCode, url }));
        log(`sala ${roomCode}`);
        if (msg.state) {
          hideOverlays();
          paint();
        } else {
          updateLobby(msg.players);
        }
        return;
      }
      if (msg.type === "room") {
        netHost = msg.host;
        if (msg.state) {
          state = msg.state;
          ui.error.textContent = "";
          hideOverlays();
          paint();
        } else {
          updateLobby(msg.players);
        }
        return;
      }
      if (msg.type === "state") {
        state = msg.state;
        ui.error.textContent = "";
        hideOverlays();
        paint();
        if (state.phase === "over") onGameOver();
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
  document.querySelector("#startnet")?.addEventListener("click", () => {
    if (ws?.readyState !== WebSocket.OPEN) {
      ui.error.textContent = "sem conexão";
      return;
    }
    ws.send(JSON.stringify({ type: "start" } satisfies C2S));
  });

  const saved = sessionStorage.getItem("war2");
  if (saved) {
    try {
      const s = JSON.parse(saved) as { token: string; roomCode: string; url: string };
      mode = "net";
      connect(s.url, { type: "reconnect", roomCode: s.roomCode, token: s.token });
    } catch {
      /* ignore */
    }
  }
}

void main();
