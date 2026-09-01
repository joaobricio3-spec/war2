import {
  CONTINENT_BY_ID,
  createGame,
  createSeededRng,
  effectiveObjective,
  listLegalActions,
  pendingPlaceTotal,
  reduce,
  type Action,
  type GameState,
  type PlayerId,
  type TerritoryId,
} from "@war2/engine";
import type { C2S, S2C } from "@war2/shared";
import { createBoard } from "./board.ts";

const COLORS = ["red", "blue", "green", "yellow", "black", "white"] as const;

type Mode = "hotseat" | "net";

const ui = {
  fps: document.querySelector("#fps") as HTMLElement,
  phase: document.querySelector("#phase") as HTMLElement,
  turn: document.querySelector("#turn") as HTMLElement,
  objective: document.querySelector("#objective") as HTMLElement,
  pending: document.querySelector("#pending") as HTMLElement,
  cards: document.querySelector("#cards") as HTMLElement,
  log: document.querySelector("#log") as HTMLElement,
  error: document.querySelector("#error") as HTMLElement,
  overlay: document.querySelector("#overlay") as HTMLElement,
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
    return `Conquistar: ${o.continents.map((id) => CONTINENT_BY_ID[id].name).join(" e ")}`;
  if (o.kind === "continents_plus_one")
    return `Conquistar ${o.continents.map((id) => CONTINENT_BY_ID[id].name).join(" + ")} e mais um continente`;
  return `Destruir exércitos ${o.color}`;
}

function log(line: string) {
  const p = document.createElement("p");
  p.textContent = line;
  ui.log.prepend(p);
}

function applyHotseat(state: GameState, action: Action, rng: ReturnType<typeof createSeededRng>): GameState {
  const r = reduce(state, action, rng);
  if (!r.ok) {
    ui.error.textContent = r.error;
    return state;
  }
  ui.error.textContent = "";
  log(`${action.type}`);
  return r.state;
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

  const board = await createBoard(canvasHost, {
    onTerritory(id) {
      if (!state) return;
      const me = mode === "hotseat" ? state.currentPlayerId : netId;
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

  function paint() {
    if (!state) return;
    const me = mode === "hotseat" ? state.currentPlayerId : netId || state.currentPlayerId;
    viewer = me;
    board.render(state, selected, me);
    const p = state.players.find((pl) => pl.id === me);
    ui.phase.textContent = state.phase;
    ui.turn.textContent = `${p?.nickname ?? me} (${p?.color ?? ""})`;
    ui.objective.textContent = describeObjective(state, me);
    ui.pending.textContent = `pendentes: ${pendingPlaceTotal(state.armiesToPlace)} | troca obrigatória: ${state.mustTrade ? "sim" : "não"}`;
    ui.cards.innerHTML = "";
    for (const c of p?.cards ?? []) {
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.card = c.id;
      b.textContent = c.kind === "joker" ? "coringa" : `${c.territoryId} (${c.shape})`;
      b.addEventListener("click", () => b.classList.toggle("on"));
      ui.cards.append(b);
    }
    if (state.pendingOccupy) {
      ui.pending.textContent += ` | ocupe ${state.pendingOccupy.to} com 1–${state.pendingOccupy.maxArmies}`;
    }
    if (state.winnerId) {
      ui.phase.textContent = `fim — venceu ${state.winnerId}`;
    }
    maybeAutoOccupy();
  }

  let occupying = false;

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
    state = applyHotseat(state, action, rng);
    paint();
  }

  function maybeAutoOccupy() {
    if (occupying || !state?.pendingOccupy || state.phase === "over") return;
    const me = mode === "hotseat" ? state.currentPlayerId : netId;
    if (mode === "net" && me !== state.currentPlayerId) return;
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

  board.app.ticker.add(() => {
    ui.fps.textContent = `${board.fps().toFixed(0)} fps (sem cap)`;
  });

  document.querySelector("#end")?.addEventListener("click", () => {
    if (!state) return;
    const me = mode === "hotseat" ? state.currentPlayerId : netId;
    if (state.phase === "reinforce") dispatch({ type: "endReinforce", playerId: me });
    else dispatch({ type: "endTurn", playerId: me });
  });

  document.querySelector("#trade")?.addEventListener("click", () => {
    if (!state) return;
    const me = mode === "hotseat" ? state.currentPlayerId : netId;
    const ids = [...ui.cards.querySelectorAll("button.on")].map(
      (el) => (el as HTMLElement).dataset.card!,
    );
    if (ids.length !== 3) {
      ui.error.textContent = "selecione 3 cartas";
      return;
    }
    dispatch({ type: "trade", playerId: me, cardIds: ids });
  });

  document.querySelector("#hotseat")?.addEventListener("click", () => {
    const n = Number((document.querySelector("#nplayers") as HTMLSelectElement).value);
    const players = Array.from({ length: n }, (_, i) => ({
      id: `p${i + 1}`,
      nickname: `Jogador ${i + 1}`,
      color: COLORS[i]!,
    }));
    rng = createSeededRng(Date.now() % 1_000_000);
    mode = "hotseat";
    sessionStorage.removeItem("war2");
    const old = ws;
    ws = null;
    old?.close();
    state = createGame({ players, rng });
    selected = null;
    ui.overlay.hidden = true;
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
        if (mode === "hotseat" && state && ui.overlay.hidden) {
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
          ui.overlay.hidden = true;
          paint();
        }
        return;
      }
      if (msg.type === "room") {
        if (msg.state) {
          state = msg.state;
          ui.overlay.hidden = true;
          paint();
        }
        log(msg.players.map((p) => p.nickname).join(", "));
        return;
      }
      if (msg.type === "state") {
        state = msg.state;
        ui.overlay.hidden = true;
        paint();
      }
    });
    previous?.close();
  }

  document.querySelector("#create")?.addEventListener("click", () => {
    const nick = (document.querySelector("#nick") as HTMLInputElement).value || "Host";
    const url = (document.querySelector("#ws") as HTMLInputElement).value;
    connect(url, { type: "create", nickname: nick });
  });
  document.querySelector("#join")?.addEventListener("click", () => {
    const nick = (document.querySelector("#nick") as HTMLInputElement).value || "Guest";
    const code = (document.querySelector("#code") as HTMLInputElement).value.trim().toUpperCase();
    const url = (document.querySelector("#ws") as HTMLInputElement).value;
    connect(url, { type: "join", roomCode: code, nickname: nick });
  });
  document.querySelector("#startnet")?.addEventListener("click", () => {
    ws?.send(JSON.stringify({ type: "start" } satisfies C2S));
  });

  const saved = sessionStorage.getItem("war2");
  if (saved) {
    try {
      const s = JSON.parse(saved) as { token: string; roomCode: string; url: string };
      connect(s.url, { type: "reconnect", roomCode: s.roomCode, token: s.token });
    } catch {
      /* ignore */
    }
  }
}

void main();
