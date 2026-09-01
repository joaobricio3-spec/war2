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
});
