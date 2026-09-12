import { describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { startServer } from "./index.ts";
import type { S2C } from "@war2/shared";

function onceMessage(ws: WebSocket): Promise<S2C> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), 4000);
    ws.once("message", (data) => {
      clearTimeout(t);
      resolve(JSON.parse(String(data)) as S2C);
    });
  });
}

/** Resolves with the first message matching `pred` (4s timeout). */
function waitFor(ws: WebSocket, pred: (m: S2C) => boolean): Promise<S2C> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("waitFor timeout")), 4000);
    const onMsg = (data: WebSocket.RawData) => {
      const msg = JSON.parse(String(data)) as S2C;
      if (pred(msg)) {
        clearTimeout(t);
        ws.off("message", onMsg);
        resolve(msg);
      }
    };
    ws.on("message", onMsg);
  });
}

async function joinRoom(url: string, roomCode: string, nickname: string) {
  const ws = new WebSocket(url);
  await new Promise((r) => ws.once("open", r));
  ws.send(JSON.stringify({ type: "join", roomCode, nickname }));
  const welcome = await onceMessage(ws);
  return { ws, welcome };
}

describe("friend rooms", () => {
  it("creates a room, joins a second player, starts, and reconnects", async () => {
    const wss = startServer(0);
    const port = (wss.address() as { port: number }).port;
    const url = `ws://127.0.0.1:${port}/ws`;

    const host = new WebSocket(url);
    await new Promise((r) => host.once("open", r));
    host.send(JSON.stringify({ type: "create", nickname: "Ana" }));
    const welcome = await onceMessage(host);
    expect(welcome.type).toBe("welcome");
    if (welcome.type !== "welcome") return;
    expect(welcome.roomCode).toHaveLength(6);
    expect(welcome.host).toBe(true);

    const guest = new WebSocket(url);
    await new Promise((r) => guest.once("open", r));
    guest.send(
      JSON.stringify({ type: "join", roomCode: welcome.roomCode, nickname: "Bia" }),
    );
    const gWelcome = await onceMessage(guest);
    expect(gWelcome.type).toBe("welcome");

    host.send(JSON.stringify({ type: "start" }));
    const started: S2C = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("start timeout")), 4000);
      const onMsg = (data: WebSocket.RawData) => {
        const msg = JSON.parse(String(data)) as S2C;
        if (msg.type === "state") {
          clearTimeout(t);
          host.off("message", onMsg);
          resolve(msg);
        }
      };
      host.on("message", onMsg);
    });
    expect(started.type).toBe("state");

    const token = welcome.token;
    host.close();
    const host2 = new WebSocket(url);
    await new Promise((r) => host2.once("open", r));
    host2.send(
      JSON.stringify({
        type: "reconnect",
        roomCode: welcome.roomCode,
        token,
      }),
    );
    const re = await onceMessage(host2);
    expect(re.type).toBe("welcome");
    if (re.type === "welcome") expect(re.playerId).toBe(welcome.playerId);

    host2.close();
    guest.close();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
  });

  it("refuses a second start and ignores the old socket after reconnect", async () => {
    const wss = startServer(0);
    const port = (wss.address() as { port: number }).port;
    const url = `ws://127.0.0.1:${port}/ws`;

    const host = new WebSocket(url);
    await new Promise((r) => host.once("open", r));
    host.send(JSON.stringify({ type: "create", nickname: "Ana" }));
    const welcome = await onceMessage(host);
    expect(welcome.type).toBe("welcome");
    if (welcome.type !== "welcome") return;

    const guest = new WebSocket(url);
    await new Promise((r) => guest.once("open", r));
    guest.send(
      JSON.stringify({ type: "join", roomCode: welcome.roomCode, nickname: "Bia" }),
    );
    await onceMessage(guest);

    host.send(JSON.stringify({ type: "start" }));
    await new Promise<S2C>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("start timeout")), 4000);
      const onMsg = (data: WebSocket.RawData) => {
        const msg = JSON.parse(String(data)) as S2C;
        if (msg.type === "state") {
          clearTimeout(t);
          host.off("message", onMsg);
          resolve(msg);
        }
      };
      host.on("message", onMsg);
    });

    host.send(JSON.stringify({ type: "start" }));
    const second = await new Promise<S2C>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("second start timeout")), 4000);
      const onMsg = (data: WebSocket.RawData) => {
        const msg = JSON.parse(String(data)) as S2C;
        if (msg.type === "error") {
          clearTimeout(t);
          host.off("message", onMsg);
          resolve(msg);
        }
      };
      host.on("message", onMsg);
    });
    expect(second.type).toBe("error");
    if (second.type === "error") expect(second.message).toMatch(/já começou/);

    const closed = new Promise<void>((resolve) => host.once("close", () => resolve()));
    const host2 = new WebSocket(url);
    await new Promise((r) => host2.once("open", r));
    host2.send(
      JSON.stringify({
        type: "reconnect",
        roomCode: welcome.roomCode,
        token: welcome.token,
      }),
    );
    await onceMessage(host2);
    await closed;
    expect(host.readyState).toBe(WebSocket.CLOSED);

    host2.close();
    guest.close();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
  });

  it("drops ghost seats when a lobby socket dies, then lets someone else take it", async () => {
    const wss = startServer(0);
    const port = (wss.address() as { port: number }).port;
    const url = `ws://127.0.0.1:${port}/ws`;

    const host = new WebSocket(url);
    await new Promise((r) => host.once("open", r));
    host.send(JSON.stringify({ type: "create", nickname: "Ana" }));
    const welcome = await onceMessage(host);
    if (welcome.type !== "welcome") throw new Error("no welcome");

    const ghost = await joinRoom(url, welcome.roomCode, "Ghost");
    ghost.ws.close();

    // Host sees the roster shrink back to 1 connected player.
    const shrunk = (await waitFor(
      host,
      (m) => m.type === "room" && m.players.length === 1,
    )) as Extract<S2C, { type: "room" }>;
    expect(shrunk.players).toHaveLength(1);

    // A fresh joiner reuses the freed seat id and the game starts with 2.
    const guest = await joinRoom(url, welcome.roomCode, "Bia");
    if (guest.welcome.type !== "welcome") throw new Error("no welcome");
    expect(guest.welcome.playerId).toBe("p2");

    host.send(JSON.stringify({ type: "start" }));
    const started = (await waitFor(host, (m) => m.type === "state")) as Extract<
      S2C,
      { type: "state" }
    >;
    expect(started.state.players).toHaveLength(2);

    host.close();
    guest.ws.close();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
  });

  it("rejects join into an active game but keeps the seat for reconnect", async () => {
    const wss = startServer(0);
    const port = (wss.address() as { port: number }).port;
    const url = `ws://127.0.0.1:${port}/ws`;

    const host = new WebSocket(url);
    await new Promise((r) => host.once("open", r));
    host.send(JSON.stringify({ type: "create", nickname: "Ana" }));
    const welcome = await onceMessage(host);
    if (welcome.type !== "welcome") throw new Error("no welcome");

    const guest = await joinRoom(url, welcome.roomCode, "Bia");
    if (guest.welcome.type !== "welcome") throw new Error("no welcome");

    host.send(JSON.stringify({ type: "start" }));
    await waitFor(host, (m) => m.type === "state");

    // A fresh socket cannot join mid-game…
    const late = await joinRoom(url, welcome.roomCode, "Clo");
    expect(late.welcome.type).toBe("error");
    if (late.welcome.type === "error")
      expect(late.welcome.message).toMatch(/já começou|reconnect/i);

    // …but the disconnected seat still accepts its token.
    const seat = new WebSocket(url);
    await new Promise((r) => seat.once("open", r));
    seat.send(
      JSON.stringify({
        type: "reconnect",
        roomCode: welcome.roomCode,
        token: guest.welcome.token,
      }),
    );
    const re = await onceMessage(seat);
    expect(re.type).toBe("welcome");
    if (re.type === "welcome") {
      expect(re.playerId).toBe(guest.welcome.playerId);
      expect(re.state?.players).toHaveLength(2);
    }

    host.close();
    guest.ws.close();
    seat.close();
    late.ws.close();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
  });

  it("leave frees the seat, migrates host, and empties the room", async () => {
    const wss = startServer(0);
    const port = (wss.address() as { port: number }).port;
    const url = `ws://127.0.0.1:${port}/ws`;

    const host = new WebSocket(url);
    await new Promise((r) => host.once("open", r));
    host.send(JSON.stringify({ type: "create", nickname: "Ana" }));
    const welcome = await onceMessage(host);
    if (welcome.type !== "welcome") throw new Error("no welcome");

    const guest = await joinRoom(url, welcome.roomCode, "Bia");
    if (guest.welcome.type !== "welcome") throw new Error("no welcome");

    // Attach listeners before sending — ws 'message' events are not buffered.
    const promotedP = waitFor(
      guest.ws,
      (m) => m.type === "room" && m.players.length === 1,
    );
    const ackP = waitFor(host, (m) => m.type === "room" && m.players.length === 0);
    host.send(JSON.stringify({ type: "leave" }));
    const ack = await ackP;
    expect(ack.type).toBe("room");

    // Guest is promoted to host after the original host left.
    const promoted = (await promotedP) as Extract<S2C, { type: "room" }>;
    expect(promoted.host).toBe(true);

    // Guest leaves too → room is gone; joining again fails.
    const goneP = waitFor(guest.ws, (m) => m.type === "room" && m.players.length === 0);
    guest.ws.send(JSON.stringify({ type: "leave" }));
    await goneP;

    const late = await joinRoom(url, welcome.roomCode, "Clo");
    expect(late.welcome.type).toBe("error");
    if (late.welcome.type === "error")
      expect(late.welcome.message).toMatch(/não existe|inexistente/i);

    host.close();
    guest.ws.close();
    late.ws.close();
    await new Promise<void>((resolve) => wss.close(() => resolve()));
  });
});
