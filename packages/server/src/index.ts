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

const MAX_PAYLOAD_BYTES = 64 * 1024;
const RATE_WINDOW_MS = 5_000;
const RATE_MAX_MSGS = 40;
const HEARTBEAT_MS = 30_000;

type Client = {
  ws: WebSocket;
  roomCode?: string;
  playerId?: PlayerId;
  isAlive: boolean;
  msgCount: number;
  windowStart: number;
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

/** Deletes the room when nobody is connected; otherwise broadcasts roster. */
function gcOrBroadcast(room: Room) {
  if (room.seats.every((s) => s.ws === null || s.ws.readyState !== WebSocket.OPEN)) {
    rooms.delete(room.code);
    return;
  }
  broadcastRoom(room);
}

/** Migrates host to the next connected seat when the host drops. */
function migrateHostIfNeeded(room: Room) {
  const host = room.seats.find((s) => s.playerId === room.hostId);
  if (host?.ws && host.ws.readyState === WebSocket.OPEN) return;
  const next = room.seats.find((s) => s.ws && s.ws.readyState === WebSocket.OPEN);
  if (next) room.hostId = next.playerId;
}

/** Detaches the client from its current room (used before joining another). */
function detach(client: Client) {
  const prev = client.roomCode ? rooms.get(client.roomCode) : undefined;
  const prevPid = client.playerId;
  client.roomCode = undefined;
  client.playerId = undefined;
  if (!prev) return;
  const seat = prev.seats.find((s) => s.playerId === prevPid);
  if (seat && seat.ws === client.ws) seat.ws = null;
  migrateHostIfNeeded(prev);
  gcOrBroadcast(prev);
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

function codeOf(raw: unknown): string | null {
  return typeof raw === "string" ? raw.trim().toUpperCase() : null;
}

function boundToSeat(seat: Seat, client: Client): boolean {
  return seat.ws === client.ws;
}

function startGame(room: Room) {
  room.state = createGame({
    rng: createSeededRng(randomBytes(4).readUInt32LE(0)),
    players: room.seats.map((s) => ({
      id: s.playerId,
      nickname: s.nickname,
      color: s.color,
    })),
  });
}

function handle(client: Client, raw: string) {
  let msg: C2S;
  try {
    msg = JSON.parse(raw) as C2S;
  } catch {
    send(client.ws, { type: "error", message: "JSON inválido" });
    return;
  }
  if (!msg || typeof msg !== "object" || typeof msg.type !== "string") {
    send(client.ws, { type: "error", message: "mensagem inválida" });
    return;
  }

  if (msg.type === "create") {
    const nickname = nickOf(msg.nickname);
    if (!nickname) {
      send(client.ws, { type: "error", message: "apelido inválido" });
      return;
    }
    detach(client);
    let code = code6();
    while (rooms.has(code)) code = code6();
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
    const roomCode = codeOf(msg.roomCode);
    if (!nickname) {
      send(client.ws, { type: "error", message: "apelido inválido" });
      return;
    }
    if (!roomCode) {
      send(client.ws, { type: "error", message: "código de sala inválido" });
      return;
    }
    const room = rooms.get(roomCode);
    if (!room) {
      send(client.ws, { type: "error", message: "sala não existe" });
      return;
    }
    if (client.roomCode === room.code && client.playerId) {
      send(client.ws, { type: "error", message: "você já está nesta sala" });
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
    detach(client);
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
    const roomCode = codeOf(msg.roomCode);
    const room = roomCode ? rooms.get(roomCode) : undefined;
    const seat =
      typeof msg.token === "string"
        ? room?.seats.find((s) => s.token === msg.token)
        : undefined;
    if (!room || !seat) {
      send(client.ws, { type: "error", message: "reconnect inválido" });
      return;
    }
    if (client.roomCode !== room.code) detach(client);
    const prev = seat.ws;
    seat.ws = client.ws;
    client.roomCode = room.code;
    client.playerId = seat.playerId;
    if (prev && prev !== client.ws) prev.close();
    welcome(room, seat, seat.playerId === room.hostId);
    broadcastRoom(room);
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
    if (room.state && room.state.phase !== "over") {
      send(client.ws, { type: "error", message: "partida já começou" });
      return;
    }
    if (room.seats.length < 2) {
      send(client.ws, { type: "error", message: "mínimo 2 jogadores" });
      return;
    }
    startGame(room);
    broadcastState(room);
    broadcastRoom(room);
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
    if (!msg.action || typeof msg.action !== "object" || Array.isArray(msg.action)) {
      send(client.ws, { type: "error", message: "ação inválida" });
      return;
    }
    const action: Action = { ...msg.action, playerId: seat.playerId };
    const rng = createSeededRng(
      (Date.now() ^ Number.parseInt(randomBytes(4).toString("hex"), 16)) >>> 0,
    );
    const result = reduce(room.state, action, rng);
    if (!result.ok) {
      send(client.ws, { type: "error", message: result.error });
      return;
    }
    room.state = result.state;
    broadcastState(room);
    return;
  }

  send(client.ws, { type: "error", message: "tipo de mensagem desconhecido" });
}

export function startServer(port: number) {
  const wss = new WebSocketServer({ port, path: "/ws", maxPayload: MAX_PAYLOAD_BYTES });
  wss.on("error", () => {
    /* porta em uso / erros de transporte — não derruba o processo */
  });
  wss.on("connection", (ws) => {
    const client: Client = {
      ws,
      isAlive: true,
      msgCount: 0,
      windowStart: Date.now(),
    };
    clientOf.set(ws, client);
    ws.on("error", () => {
      /* erro de socket — o evento close faz a limpeza */
    });
    ws.on("pong", () => {
      client.isAlive = true;
    });
    ws.on("message", (data) => {
      const now = Date.now();
      if (now - client.windowStart > RATE_WINDOW_MS) {
        client.windowStart = now;
        client.msgCount = 0;
      }
      client.msgCount += 1;
      if (client.msgCount > RATE_MAX_MSGS) {
        send(ws, { type: "error", message: "limite de mensagens excedido" });
        ws.terminate();
        return;
      }
      try {
        handle(client, String(data));
      } catch {
        send(ws, { type: "error", message: "erro interno" });
      }
    });
    ws.on("close", () => {
      const room = client.roomCode ? rooms.get(client.roomCode) : undefined;
      const pid = client.playerId;
      client.roomCode = undefined;
      client.playerId = undefined;
      if (!room) return;
      const seat = room.seats.find((s) => s.playerId === pid);
      if (seat && seat.ws === ws) seat.ws = null;
      migrateHostIfNeeded(room);
      gcOrBroadcast(room);
    });
  });
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      const c = clientOf.get(ws);
      if (c && !c.isAlive) {
        ws.terminate();
        continue;
      }
      if (c) c.isAlive = false;
      ws.ping();
    }
  }, HEARTBEAT_MS);
  wss.on("close", () => clearInterval(heartbeat));
  return wss;
}

const clientOf = new WeakMap<WebSocket, Client>();
