import { describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import {
  listLegalActions,
  type Action,
  type GameState,
  type PlayerId,
} from "@war2/engine";
import type { S2C } from "@war2/shared";
import { startServer } from "./index.ts";

/**
 * E2E gauntlet: two real WebSocket clients play a complete match against a
 * real `startServer` instance, choosing actions straight out of
 * `listLegalActions` on the per-player masked view broadcast by the server.
 *
 * The server rate-limits each socket to 40 msgs / 5s (see RATE_* in index.ts).
 * The gauntlet starts it with a raised limit so sends flow immediately — the
 * pacing code path stays exercised, just without wall-clock waits.
 */

const RATE_WINDOW_MS = 5_000;
const RATE_LIMIT = 100_000; // servidor do teste aceita burst; produção mantém 40/5s
const STALL_MS = 30_000;

type Welcome = Extract<S2C, { type: "welcome" }>;

/** Serialize sends through a rolling-window rate limiter. */
function makePacer(limit: number, windowMs: number) {
  const stamps: number[] = [];
  let chain: Promise<void> = Promise.resolve();
  return (fn: () => void): Promise<void> => {
    chain = chain.then(async () => {
      let now = Date.now();
      while (stamps.length && now - stamps[0]! > windowMs) stamps.shift();
      if (stamps.length >= limit) {
        await new Promise((r) =>
          setTimeout(r, windowMs - (now - stamps[0]!) + 10),
        );
        now = Date.now();
        while (stamps.length && now - stamps[0]! > windowMs) stamps.shift();
      }
      stamps.push(now);
      fn();
    });
    return chain;
  };
}

/**
 * Pick one legal action for `playerId` on the (masked) view.
 * Aggressive policy: occupy max, always trade, always attack with max dice —
 * keeps a 2-player gauntlet moving toward a decisive end.
 */
function chooseAction(state: GameState, playerId: PlayerId): Action | null {
  const legal = listLegalActions(state, playerId);
  if (legal.length === 0) return null;

  const occupies = legal.filter((a) => a.type === "occupy");
  if (occupies.length) return occupies[occupies.length - 1]!;

  const trade = legal.find((a) => a.type === "trade");
  if (trade) return trade;

  const place = legal.find((a) => a.type === "place");
  if (place) return place;

  const attack = legal.find((a) => a.type === "attack");
  if (attack && attack.type === "attack") {
    const fromArmies = state.territories[attack.from]!.armies;
    return {
      ...attack,
      armies: Math.min(3, fromArmies - 1) as 1 | 2 | 3,
    };
  }

  return (
    legal.find((a) => a.type === "endTurn") ??
    legal.find((a) => a.type === "endAttack") ??
    legal.find((a) => a.type === "endReinforce") ??
    legal.find((a) => a.type === "fortify") ??
    legal[0]!
  );
}

function describeState(s: GameState | null): string {
  if (!s) return "<no state>";
  const cur = s.players.find((p) => p.id === s.currentPlayerId);
  return JSON.stringify({
    phase: s.phase,
    currentPlayerId: s.currentPlayerId,
    turnIndex: s.turnIndex,
    pendingOccupy: s.pendingOccupy,
    mustTrade: s.mustTrade,
    armiesToPlace: s.armiesToPlace,
    winnerId: s.winnerId,
    currentAlive: cur?.alive,
    currentCards: cur?.cards.length,
    legalForCurrent: listLegalActions(s, s.currentPlayerId).length,
  });
}

type Bot = {
  name: string;
  ws: WebSocket;
  playerId: PlayerId;
  actionsSent: number;
  errors: string[];
  lastState: GameState | null;
  lastAction: Action | null;
  overState: GameState | null;
  send: (msg: unknown) => Promise<void>;
};

function connectBot(
  url: string,
  name: string,
  hooks: {
    onState: (bot: Bot) => void;
    onClosedEarly: (bot: Bot) => void;
  },
): Promise<Bot> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const pace = makePacer(RATE_LIMIT, RATE_WINDOW_MS);
    const bot: Bot = {
      name,
      ws,
      playerId: "",
      actionsSent: 0,
      errors: [],
      lastState: null,
      lastAction: null,
      overState: null,
      send: (msg) => pace(() => ws.send(JSON.stringify(msg))),
    };
    ws.once("open", () => resolve(bot));
    ws.once("error", reject);
    ws.on("message", (data) => {
      const msg = JSON.parse(String(data)) as S2C;
      if (msg.type === "welcome") {
        bot.playerId = msg.playerId;
      } else if (msg.type === "error") {
        bot.errors.push(msg.message);
      } else if (msg.type === "state") {
        bot.lastState = msg.state;
        hooks.onState(bot);
      }
      // "room" messages also carry a state snapshot; only "state" drives play
      // so each turn produces exactly one action per socket.
    });
    ws.on("close", () => {
      if (!bot.overState) hooks.onClosedEarly(bot);
    });
  });
}

describe("e2e gauntlet", () => {
  it(
    "plays a full match between two sockets until phase over",
    async () => {
      const wss = startServer(0, { rateMaxMsgs: 1_000_000 });
      const port = (wss.address() as { port: number }).port;
      const url = `ws://127.0.0.1:${port}/ws`;
      const startedAt = Date.now();
      let lastStateAt = Date.now();
      let closedEarly: string | null = null;

      const host = await connectBot(url, "host", {
        onState: (b) => onState(b),
        onClosedEarly: (b) => {
          closedEarly = b.name;
        },
      });
      await host.send({ type: "create", nickname: "Ana" });
      const hostWelcome = (await onceMessage(host.ws)) as Welcome;
      expect(hostWelcome.type).toBe("welcome");
      expect(hostWelcome.host).toBe(true);

      const guest = await connectBot(url, "guest", {
        onState: (b) => onState(b),
        onClosedEarly: (b) => {
          closedEarly = b.name;
        },
      });
      await guest.send({
        type: "join",
        roomCode: hostWelcome.roomCode,
        nickname: "Bia",
      });
      const guestWelcome = (await onceMessage(guest.ws)) as Welcome;
      expect(guestWelcome.type).toBe("welcome");

      const bots = [host, guest];

      function onState(bot: Bot) {
        lastStateAt = Date.now();
        const s = bot.lastState!;
        if (s.phase === "over") {
          bot.overState = s;
          return;
        }
        if (s.currentPlayerId !== bot.playerId) return;
        const action = chooseAction(s, bot.playerId);
        if (!action) {
          bot.errors.push(
            `no legal actions while current player at ${describeState(s)}`,
          );
          return;
        }
        bot.lastAction = action;
        bot.actionsSent += 1;
        void bot.send({ type: "action", action });
      }

      await host.send({ type: "start" });

      const diagnostics = () =>
        [
          `actions sent: host=${host.actionsSent} guest=${guest.actionsSent}`,
          `host last: ${describeState(host.lastState)} action=${JSON.stringify(host.lastAction)}`,
          `guest last: ${describeState(guest.lastState)} action=${JSON.stringify(guest.lastAction)}`,
          `errors: host=${JSON.stringify(host.errors)} guest=${JSON.stringify(guest.errors)}`,
          closedEarly ? `socket closed early: ${closedEarly}` : "",
        ].join("\n  ");

      await new Promise<void>((resolve, reject) => {
        const iv = setInterval(() => {
          if (host.overState && guest.overState) {
            clearInterval(iv);
            resolve();
          } else if (closedEarly) {
            clearInterval(iv);
            reject(
              new Error(`socket terminated mid-match\n  ${diagnostics()}`),
            );
          } else if (Date.now() - lastStateAt > STALL_MS) {
            clearInterval(iv);
            reject(
              new Error(
                `match stalled: no state broadcast for >${STALL_MS}ms\n  ${diagnostics()}`,
              ),
            );
          }
        }, 500);
      });

      const elapsed = Date.now() - startedAt;
      const final = host.overState!;
      console.log(
        `[e2e] match over: ${host.actionsSent + guest.actionsSent} actions ` +
          `(host=${host.actionsSent} guest=${guest.actionsSent}) in ${elapsed}ms; ` +
          `winner=${final.winnerId} turns=${final.turnIndex}; ` +
          `protocol errors: host=${host.errors.length} ${JSON.stringify(host.errors)} ` +
          `guest=${guest.errors.length} ${JSON.stringify(guest.errors)}`,
      );

      expect(final.phase).toBe("over");
      expect(final.winnerId).not.toBeNull();
      expect(bots.map((b) => b.overState?.phase)).toEqual(["over", "over"]);

      // Rematch: `start` com a partida em `over` cria jogo novo na mesma
      // sala, com os mesmos assentos — ninguém recria código nem reconecta.
      // Qualquer estado não-`over` pós-start é o jogo novo (over é terminal);
      // com pacing livre a partida 2 pode correr inteira num poll — por isso
      // não amarramos a checagem ao setup_place/turnIndex 0.
      const seenFresh = { host: false, guest: false };
      host.ws.on("message", (data) => {
        const m = JSON.parse(String(data)) as S2C;
        if (m.type === "state" && m.state.phase !== "over") seenFresh.host = true;
      });
      guest.ws.on("message", (data) => {
        const m = JSON.parse(String(data)) as S2C;
        if (m.type === "state" && m.state.phase !== "over") seenFresh.guest = true;
      });
      await host.send({ type: "start" });
      await new Promise<void>((resolve, reject) => {
        const deadline = Date.now() + STALL_MS;
        const iv = setInterval(() => {
          if (seenFresh.host && seenFresh.guest) {
            clearInterval(iv);
            resolve();
          } else if (Date.now() > deadline) {
            clearInterval(iv);
            reject(
              new Error(
                `rematch did not start a fresh game\n  ${diagnostics()}`,
              ),
            );
          }
        }, 100);
      });
      expect(host.errors).toEqual([]);
      expect(guest.errors).toEqual([]);

      host.ws.close();
      guest.ws.close();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    },
    300_000,
  );
});

function onceMessage(ws: WebSocket): Promise<S2C> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), 4000);
    ws.once("message", (data) => {
      clearTimeout(t);
      resolve(JSON.parse(String(data)) as S2C);
    });
  });
}
