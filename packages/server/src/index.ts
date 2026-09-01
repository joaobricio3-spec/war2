import {
  createGame,
  createSeededRng,
  reduce,
  viewFor,
  type Action,
  type ArmyColor,
  type GameState,
  type PlayerId,
} from "@war2/engine";
import type { C2S, RoomPlayer, S2C } from "@war2/shared";
import { WebSocket, WebSocketServer } from "ws";
import { randomBytes } from "node:crypto";

const COLORS: ArmyColor[] = ["red", "blue", "green", "yellow", "black", "white"];

type Client = {
  ws: WebSocket;
  roomCode?: string;
  playerId?: PlayerId;
};

type Seat = {
  playerId: PlayerId;
  nickname: string;
  token: string;
  color: ArmyColor;
  ws: WebSocket | null;
};

type Room = {
  code: string;
  hostId: PlayerId;
  seats: Seat[];
  state: GameState | null;
};

const rooms = new Map<string, Room>();

function code6(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  const buf = randomBytes(6);
  for (let i = 0; i < 6; i++) s += alphabet[buf[i]! % alphabet.length];
  return s;
}

function send(ws: WebSocket, msg: S2C) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function playersOf(room: Room): RoomPlayer[] {
  return room.seats.map((s) => ({
    playerId: s.playerId,
    nickname: s.nickname,
    connected: s.ws !== null && s.ws.readyState === WebSocket.OPEN,
  }));
}

function broadcastRoom(room: Room) {
  for (const seat of room.seats) {
    if (!seat.ws) continue;
    const viewed = room.state ? viewFor(room.state, seat.playerId) : null;
    send(seat.ws, {
      type: "room",
      host: seat.playerId === room.hostId,
      players: playersOf(room),
      state: viewed,
    });
  }
}

function broadcastState(room: Room) {
  if (!room.state) return;
  for (const seat of room.seats) {
    if (!seat.ws) continue;
    send(seat.ws, { type: "state", state: viewFor(room.state, seat.playerId) });
  }
}

function welcome(room: Room, seat: Seat, host: boolean) {
  if (!seat.ws) return;
  send(seat.ws, {
    type: "welcome",
    roomCode: room.code,
    playerId: seat.playerId,
    token: seat.token,
    host,
    players: playersOf(room),
    state: room.state ? viewFor(room.state, seat.playerId) : null,
  });
}

function nickOf(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const n = raw.trim().slice(0, 24);
  return n || null;
}

function boundToSeat(seat: Seat, client: Client): boolean {
  return seat.ws === client.ws;
}

function handle(client: Client, raw: string) {
  let msg: C2S;
  try {
    msg = JSON.parse(raw) as C2S;
  } catch {
    send(client.ws, { type: "error", message: "JSON inválido" });
    return;
  }

  if (msg.type === "create") {
    const nickname = nickOf(msg.nickname);
    if (!nickname) {
      send(client.ws, { type: "error", message: "apelido inválido" });
      return;
    }
    const code = code6();
    const playerId = "p1";
    const seat: Seat = {
      playerId,
      nickname,
      token: randomBytes(16).toString("hex"),
      color: COLORS[0]!,
      ws: client.ws,
    };
    const room: Room = { code, hostId: playerId, seats: [seat], state: null };
    rooms.set(code, room);
    client.roomCode = code;
    client.playerId = playerId;
    welcome(room, seat, true);
    return;
  }

  if (msg.type === "join") {
    const nickname = nickOf(msg.nickname);
    if (!nickname) {
      send(client.ws, { type: "error", message: "apelido inválido" });
      return;
    }
    const room = rooms.get(msg.roomCode.toUpperCase());
    if (!room) {
      send(client.ws, { type: "error", message: "sala não existe" });
      return;
    }
    if (room.state) {
      send(client.ws, { type: "error", message: "partida já começou — use reconnect" });
      return;
    }
    if (room.seats.length >= 6) {
      send(client.ws, { type: "error", message: "sala cheia" });
      return;
    }
    const playerId = `p${room.seats.length + 1}`;
    const seat: Seat = {
      playerId,
      nickname,
      token: randomBytes(16).toString("hex"),
      color: COLORS[room.seats.length]!,
      ws: client.ws,
    };
    room.seats.push(seat);
    client.roomCode = room.code;
    client.playerId = playerId;
    welcome(room, seat, false);
    broadcastRoom(room);
    return;
  }

  if (msg.type === "reconnect") {
    const room = rooms.get(msg.roomCode.toUpperCase());
    const seat = room?.seats.find((s) => s.token === msg.token);
    if (!room || !seat) {
      send(client.ws, { type: "error", message: "reconnect inválido" });
      return;
    }
    const prev = seat.ws;
    seat.ws = client.ws;
    client.roomCode = room.code;
    client.playerId = seat.playerId;
    if (prev && prev !== client.ws) prev.close();
    welcome(room, seat, seat.playerId === room.hostId);
    broadcastRoom(room);
    if (room.state) send(client.ws, { type: "state", state: viewFor(room.state, seat.playerId) });
    return;
  }

  const room = client.roomCode ? rooms.get(client.roomCode) : undefined;
  const seat = room?.seats.find((s) => s.playerId === client.playerId);
  if (!room || !seat) {
    send(client.ws, { type: "error", message: "entre numa sala" });
    return;
  }

  if (msg.type === "start") {
    if (!boundToSeat(seat, client)) {
      send(client.ws, { type: "error", message: "reconecte nesta sessão" });
      return;
    }
    if (seat.playerId !== room.hostId) {
      send(client.ws, { type: "error", message: "só o host inicia" });
      return;
    }
    if (room.state) {
      send(client.ws, { type: "error", message: "partida já começou" });
      return;
    }
    if (room.seats.length < 2) {
      send(client.ws, { type: "error", message: "mínimo 2 jogadores" });
      return;
    }
    room.state = createGame({
      rng: createSeededRng(Date.now() % 1_000_000),
      players: room.seats.map((s) => ({
        id: s.playerId,
        nickname: s.nickname,
        color: s.color,
      })),
    });
    broadcastState(room);
    return;
  }

  if (msg.type === "action") {
    if (!boundToSeat(seat, client)) {
      send(client.ws, { type: "error", message: "reconecte nesta sessão" });
      return;
    }
    if (!room.state) {
      send(client.ws, { type: "error", message: "partida não iniciada" });
      return;
    }
    const action: Action = { ...msg.action, playerId: seat.playerId };
    const rng = createSeededRng((Date.now() ^ Number.parseInt(randomBytes(4).toString("hex"), 16)) >>> 0);
    const result = reduce(room.state, action, rng);
    if (!result.ok) {
      send(client.ws, { type: "error", message: result.error });
      return;
    }
    room.state = result.state;
    broadcastState(room);
  }
}

export function startServer(port: number) {
  const wss = new WebSocketServer({ port, path: "/ws" });
  wss.on("connection", (ws) => {
    const client: Client = { ws };
    ws.on("message", (data) => {
      try {
        handle(client, String(data));
      } catch {
        send(ws, { type: "error", message: "erro interno" });
      }
    });
    ws.on("close", () => {
      const room = client.roomCode ? rooms.get(client.roomCode) : undefined;
      const seat = room?.seats.find((s) => s.playerId === client.playerId);
      if (seat && seat.ws === ws) seat.ws = null;
      if (room) broadcastRoom(room);
    });
  });
  return wss;
}
