export type PlayerId = string;

export type ArmyColor = "white" | "black" | "red" | "blue" | "yellow" | "green";

export type Phase =
  | "setup_place"
  | "reinforce"
  | "attack"
  | "fortify"
  | "over";

export type CardShape = "circle" | "triangle" | "square" | "joker";

export interface TerritoryCard {
  id: string;
  kind: "territory";
  territoryId: import("./map/classic.ts").TerritoryId;
  shape: Exclude<CardShape, "joker">;
}

export interface JokerCard {
  id: string;
  kind: "joker";
  shape: "joker";
}

export type GameCard = TerritoryCard | JokerCard;

export type Objective =
  | { kind: "territories"; count: 24 }
  | { kind: "territories_min_armies"; count: 18; minArmies: 2 }
  | { kind: "continents"; continents: import("./map/classic.ts").ContinentId[] }
  | {
      kind: "continents_plus_one";
      continents: import("./map/classic.ts").ContinentId[];
    }
  | { kind: "destroy_color"; color: ArmyColor }
  | { kind: "hidden" };

export interface Player {
  id: PlayerId;
  nickname: string;
  color: ArmyColor;
  objective: Objective;
  cards: GameCard[];
  alive: boolean;
  killedBy: PlayerId | null;
  setupRemaining: number;
}

export interface OccupiedTerritory {
  ownerId: PlayerId;
  armies: number;
}

export interface PendingOccupy {
  from: import("./map/classic.ts").TerritoryId;
  to: import("./map/classic.ts").TerritoryId;
  minArmies: number;
  maxArmies: number;
}

export interface ArmiesToPlace {
  general: number;
  byContinent: Partial<Record<import("./map/classic.ts").ContinentId, number>>;
  byTerritory: Partial<Record<import("./map/classic.ts").TerritoryId, number>>;
}

export interface LastBattle {
  attackDice: number[];
  defendDice: number[];
  attackLosses: number;
  defendLosses: number;
}

export interface GameState {
  phase: Phase;
  players: Player[];
  playerOrder: PlayerId[];
  currentPlayerId: PlayerId;
  territories: Record<import("./map/classic.ts").TerritoryId, OccupiedTerritory>;
  deck: GameCard[];
  discard: GameCard[];
  tradeCount: number;
  conqueredThisTurn: boolean;
  pendingOccupy: PendingOccupy | null;
  armiesToPlace: ArmiesToPlace;
  fortifiedThisTurn: boolean;
  mustTrade: boolean;
  lastBattle: LastBattle | null;
  winnerId: PlayerId | null;
  turnIndex: number;
}

export type Action =
  | {
      type: "place";
      playerId: PlayerId;
      territoryId: import("./map/classic.ts").TerritoryId;
      count: number;
    }
  | { type: "trade"; playerId: PlayerId; cardIds: string[] }
  | { type: "endReinforce"; playerId: PlayerId }
  | {
      type: "attack";
      playerId: PlayerId;
      from: import("./map/classic.ts").TerritoryId;
      to: import("./map/classic.ts").TerritoryId;
      armies: 1 | 2 | 3;
    }
  | { type: "occupy"; playerId: PlayerId; armies: number }
  | {
      type: "fortify";
      playerId: PlayerId;
      from: import("./map/classic.ts").TerritoryId;
      to: import("./map/classic.ts").TerritoryId;
      armies: number;
    }
  | { type: "endTurn"; playerId: PlayerId };

export type ReduceResult =
  | { ok: true; state: GameState }
  | { ok: false; error: string };
