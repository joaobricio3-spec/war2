import { cloneState } from "./clone.ts";
import { TERRITORIES, TERRITORY_IDS, type TerritoryId } from "./map/classic.ts";
import { objectivesForColors } from "./objectives.ts";
import type { Rng } from "./rng.ts";
import type {
  ArmiesToPlace,
  ArmyColor,
  GameCard,
  GameState,
  Player,
  PlayerId,
} from "./types.ts";
import { continentBonusFor, playerControlsCount } from "./objectives.ts";

const STARTING_POOL: Record<number, number> = {
  2: 40,
  3: 35,
  4: 30,
  5: 25,
  6: 20,
};

export function emptyPending(): ArmiesToPlace {
  return { general: 0, byContinent: {}, byTerritory: {} };
}

function buildDeck(): GameCard[] {
  const territoryCards: GameCard[] = TERRITORIES.map((t) => ({
    id: `card-${t.id}`,
    kind: "territory",
    territoryId: t.id,
    shape: t.shape,
  }));
  const jokers: GameCard[] = [
    { id: "joker-1", kind: "joker", shape: "joker" },
    { id: "joker-2", kind: "joker", shape: "joker" },
  ];
  return [...territoryCards, ...jokers];
}

export function beginTurn(state: GameState, playerId: PlayerId): GameState {
  const next: GameState = {
    ...state,
    phase: "reinforce",
    currentPlayerId: playerId,
    conqueredThisTurn: false,
    pendingOccupy: null,
    lastBattle: null,
    arrivedThisTurn: {},
    armiesToPlace: emptyPending(),
    mustTrade: false,
  };
  const owned = playerControlsCount(next, playerId);
  const general = Math.max(3, Math.floor(owned / 2));
  const byContinent = continentBonusFor(next, playerId);
  const player = next.players.find((p) => p.id === playerId)!;
  next.armiesToPlace = { general, byContinent, byTerritory: {} };
  next.mustTrade = player.cards.length >= 5;
  return next;
}

export function drawCard(state: GameState, playerId: PlayerId, rng: Rng): GameState {
  const next = cloneState(state);
  if (next.deck.length === 0 && next.discard.length > 0) {
    next.deck = rng.shuffle(next.discard);
    next.discard = [];
  }
  if (next.deck.length === 0) return next;
  const card = next.deck.shift()!;
  const player = next.players.find((p) => p.id === playerId)!;
  player.cards.push(card);
  next.mustTrade = player.cards.length >= 5;
  return next;
}

export function createGame(opts: {
  players: { id: PlayerId; nickname: string; color: ArmyColor }[];
  rng: Rng;
}): GameState {
  const n = opts.players.length;
  if (n < 2 || n > 6) throw new Error("2 a 6 jogadores");
  const colors = new Set(opts.players.map((p) => p.color));
  if (colors.size !== n) throw new Error("cores devem ser únicas");

  const order = opts.rng.shuffle(opts.players.map((p) => p.id));
  const ids = opts.rng.shuffle([...TERRITORY_IDS]);
  const ownerOf: Record<TerritoryId, PlayerId> = {} as Record<TerritoryId, PlayerId>;
  ids.forEach((tid, i) => {
    ownerOf[tid] = order[i % n]!;
  });

  const pool = STARTING_POOL[n] ?? 20;
  const objectives = opts.rng.shuffle(objectivesForColors(opts.players.map((p) => p.color)));

  const players: Player[] = opts.players.map((p, i) => {
    const owned = TERRITORY_IDS.filter((tid) => ownerOf[tid] === p.id).length;
    return {
      id: p.id,
      nickname: p.nickname,
      color: p.color,
      objective: objectives[i] ?? { kind: "territories", count: 24 },
      cards: [],
      alive: true,
      killedBy: null,
      setupRemaining: pool - owned,
    };
  });

  const territories = {} as GameState["territories"];
  for (const tid of TERRITORY_IDS) {
    territories[tid] = { ownerId: ownerOf[tid]!, armies: 1 };
  }

  const deck = opts.rng.shuffle(buildDeck());
  const setupLeft = players.some((p) => p.setupRemaining > 0);

  let state: GameState = {
    phase: setupLeft ? "setup_place" : "reinforce",
    players,
    playerOrder: order,
    currentPlayerId: order[0]!,
    territories,
    deck,
    discard: [],
    tradeCount: 0,
    conqueredThisTurn: false,
    pendingOccupy: null,
    armiesToPlace: emptyPending(),
    arrivedThisTurn: {},
    mustTrade: false,
    lastBattle: null,
    winnerId: null,
    turnIndex: 0,
  };

  if (!setupLeft) {
    state = beginTurn(state, order[0]!);
  }
  return state;
}

export function nextAlive(state: GameState, fromId: PlayerId): PlayerId {
  const order = state.playerOrder;
  const start = order.indexOf(fromId);
  for (let i = 1; i <= order.length; i++) {
    const id = order[(start + i) % order.length]!;
    const p = state.players.find((pl) => pl.id === id);
    if (p?.alive) return id;
  }
  return fromId;
}
