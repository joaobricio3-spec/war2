import type { Action, GameState } from "@war2/engine";

export type C2S =
  | { type: "create"; nickname: string }
  | { type: "join"; roomCode: string; nickname: string }
  | { type: "reconnect"; roomCode: string; token: string }
  | { type: "start" }
  | { type: "action"; action: Action };

export type RoomPlayer = {
  playerId: string;
  nickname: string;
  connected: boolean;
};

export type S2C =
  | {
      type: "welcome";
      roomCode: string;
      playerId: string;
      token: string;
      host: boolean;
      players: RoomPlayer[];
      state: GameState | null;
    }
  | { type: "room"; host: boolean; players: RoomPlayer[]; state: GameState | null }
  | { type: "state"; state: GameState }
  | { type: "error"; message: string };

export const DEFAULT_WS_PORT = 8787;
export const DEFAULT_WS_PATH = "/ws";
