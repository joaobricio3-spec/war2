import {
  CONTINENT_BY_ID,
  aiChooseAction,
  beginTurn,
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
import type { C2S, S2C } from "@war2/shared";
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
  cards: document.querySelector("#cards") as HTMLElement,
  log: document.querySelector("#log") as HTMLElement,
  error: document.querySelector("#error") as HTMLElement,
  overlay: document.querySelector("#overlay") as HTMLElement,
  gameover: document.querySelector("#gameover") as HTMLElement,
  gameoverTitle: document.querySelector("#gameover-title") as HTMLElement,
  gameoverSub: document.querySelector("#gameover-sub") as HTMLElement,
  loading: document.querySelector("#loading") as HTMLElement,
  trade: document.querySelector("#trade") as HTMLButtonElement,
  end: document.querySelector("#end") as HTMLButtonElement,
  continue: document.querySelector("#continue") as HTMLButtonElement,
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

  // campaign state
  let humanId: PlayerId = "p1";
  let aiPlayers = new Map<PlayerId, Difficulty>();
  let aiTimer: number | null = null;
  let aiThinking = false;
  let lastBattleKey = "";
  let cancelDice: () => void = () => {};

  ui.continue.disabled = loadCampaign() === null;

  const board = await createBoard(canvasHost, {
    onTerritory(id) {
      if (!state) return;
      if (mode === "campaign" && (aiThinking || state.currentPlayerId !== humanId)) return;
      const me = mode === "net" ? netId : mode === "campaign" ? humanId : state.currentPlayerId;
      viewer = me;
      if (state.phase === "setup_place" || state.phase === "reinforce") {
        dispatch({ type: "place", playerId: me, territoryId: id, count: 1 });
        selected = id;
        return;
      }
      if (state.phase === "attack" && state.pendingOccupy) {
        maybeAutoOccupy();
        return;
      }
      if (!selected) {
        selected = id;
        paint();
        return;
      }
      if (state.phase === "attack") {
        const from = selected;
        const n = Math.min(3, state.territories[from].armies - 1);
        if (n === 1 || n === 2 || n === 3) {
          dispatch({ type: "attack", playerId: me, from, to: id, armies: n });
        }
      } else if (state.phase === "fortify") {
        const from = selected;
        const armies = Math.max(
          1,
          state.territories[from].armies - 1 - (state.arrivedThisTurn[from] ?? 0),
        );
        if (armies >= 1) {
          dispatch({ type: "fortify", playerId: me, from, to: id, armies: Math.min(armies, 3) });
        }
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
    cancelDice = showBattle(ui.dice, state.lastBattle);
  }

  function paint() {
    if (!state) return;
    const me =
      mode === "net"
        ? netId || state.currentPlayerId
        : mode === "campaign"
          ? humanId
          : state.currentPlayerId;
    viewer = me;
    board.render(state, selected, me);
    const p = state.players.find((pl) => pl.id === me);
    ui.phase.textContent = state.phase;
    ui.turn.textContent = `${p?.nickname ?? me} (${p?.color ?? ""})`;
    ui.objective.textContent = describeObjective(state, me);
    ui.pending.textContent = `pendentes: ${pendingPlaceTotal(state.armiesToPlace)} | troca obrigatória: ${state.mustTrade ? "sim" : "não"}`;

    if (mode === "campaign") {
      ui.status.hidden = false;
      if (state.phase === "over") {
        ui.status.textContent = state.winnerId === humanId ? "Vitória" : "Derrota";
        ui.status.dataset.tone = state.winnerId === humanId ? "win" : "lose";
      } else if (state.currentPlayerId === humanId) {
        ui.status.textContent = "Sua vez";
        ui.status.dataset.tone = "you";
      } else {
        const curId = state.currentPlayerId;
        const cur = state.players.find((pl) => pl.id === curId);
        ui.status.textContent = `IA pensando — ${cur?.nickname ?? curId}`;
        ui.status.dataset.tone = "ai";
      }
    } else {
      ui.status.hidden = true;
    }

    ui.cards.innerHTML = "";
    for (const c of p?.cards ?? []) {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.card = c.id;
      b.textContent = c.kind === "joker" ? "coringa" : `${c.territoryId} (${c.shape})`;
      b.addEventListener("click", () => b.classList.toggle("on"));
      ui.cards.append(b);
    }

    const humanTurn =
      mode !== "campaign" || (state.currentPlayerId === humanId && !aiThinking && state.phase !== "over");
    ui.end.disabled = !humanTurn;
    ui.trade.disabled = !humanTurn;

    if (state.pendingOccupy) {
      ui.pending.textContent += ` | ocupe ${state.pendingOccupy.to} com 1–${state.pendingOccupy.maxArmies}`;
    }
    updateDice();
    maybeAutoOccupy();
  }

  let occupying = false;

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
    log(`${action.type}`);
    paint();
    if (mode === "campaign") maybeRunAI();
  }

  function maybeAutoOccupy() {
    if (occupying || !state?.pendingOccupy || state.phase === "over") return;
    const me = mode === "net" ? netId : mode === "campaign" ? humanId : state.currentPlayerId;
    if ((mode === "net" || mode === "campaign") && me !== state.currentPlayerId) return;
    const acts = listLegalActions(state, me).filter((a) => a.type === "occupy");
    const max = acts.at(-1);
    if (max && max.type === "occupy") {
      occupying = true;
      try {
        dispatch(max);
      } finally {
        occupying = false;
      }
    }
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
    aiTimer = window.setTimeout(stepAI, reducedMotion ? 8 : 160);
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
            : 120;
      aiTimer = window.setTimeout(stepAI, delay);
    } else {
      aiThinking = false;
      paint();
    }
  }

  function onGameOver() {
    stopAI();
    if (!state) return;
    localStorage.removeItem(SAVE_KEY);
    ui.continue.disabled = true;
    const won = state.winnerId === humanId;
    const winnerId = state.winnerId;
    const winner = state.players.find((p) => p.id === winnerId);
    ui.gameoverTitle.textContent = won ? "Vitória" : "Derrota";
    ui.gameoverSub.textContent = won
      ? "Você cumpriu o objetivo."
      : `Campanha encerrada. Venceu ${winner?.nickname ?? "?"}.`;
    ui.gameover.hidden = false;
    paint();
  }

  function hideOverlays() {
    ui.overlay.hidden = true;
    ui.gameover.hidden = true;
    ui.loading.hidden = true;
  }

  function autoSetup(s: GameState): GameState {
    let cur = s;
    let guard = 0;
    while (cur.phase === "setup_place" && guard < 5000) {
      const pid = cur.currentPlayerId;
      const diff = aiPlayers.get(pid) ?? "oficial";
      const action = aiChooseAction(cur, pid, diff);
      if (!action) break;
      const r = reduce(cur, action, rng);
      if (!r.ok) break;
      cur = r.state;
      guard += 1;
    }
    return cur;
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

    let s = createGame({ players, rng });
    s = autoSetup(s);
    // Grow rule: o humano começa o turno 1.
    if (s.playerOrder[0] !== humanId && s.phase !== "over") {
      const order = s.playerOrder;
      const idx = order.indexOf(humanId);
      if (idx > 0) {
        s = { ...s, playerOrder: [...order.slice(idx), ...order.slice(0, idx)] };
        s = beginTurn(s, humanId);
      }
    }
    state = s;
    selected = null;
    lastBattleKey = "x"; // force dice refresh
    ui.log.innerHTML = "";
    hideOverlays();
    saveCampaign();
    ui.continue.disabled = false;
    log(`nova campanha — ${aiCount} IA(s) ${diff}`);
    paint();
    maybeRunAI();
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
    ui.gameover.hidden = true;
    ui.loading.hidden = true;
    ui.continue.disabled = loadCampaign() === null;
    ui.overlay.hidden = false;
  }

  board.app.ticker.add(() => {
    ui.fps.textContent = `${board.fps().toFixed(0)} fps (sem cap)`;
  });

  ui.end.addEventListener("click", () => {
    if (!state) return;
    if (mode === "campaign" && (aiThinking || state.currentPlayerId !== humanId)) return;
    const me = mode === "net" ? netId : mode === "campaign" ? humanId : state.currentPlayerId;
    if (state.phase === "reinforce") dispatch({ type: "endReinforce", playerId: me });
    else dispatch({ type: "endTurn", playerId: me });
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
  document.querySelector("#title")?.addEventListener("click", () => goToTitle());
  document.querySelector("#gameover-title-btn")?.addEventListener("click", () => goToTitle());
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !ui.gameover.hidden) goToTitle();
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
        mode = "net";
        state = msg.state;
        sessionStorage.setItem("war2", JSON.stringify({ token, roomCode, url }));
        log(`sala ${roomCode}`);
        if (msg.state) {
          hideOverlays();
          paint();
        }
        return;
      }
      if (msg.type === "room") {
        if (msg.state) {
          state = msg.state;
          hideOverlays();
          paint();
        }
        log(msg.players.map((p) => p.nickname).join(", "));
        return;
      }
      if (msg.type === "state") {
        state = msg.state;
        hideOverlays();
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
  document.querySelector("#startnet")?.addEventListener("click", () => {
    ws?.send(JSON.stringify({ type: "start" } satisfies C2S));
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
