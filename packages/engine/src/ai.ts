import { attackDiceCount } from "./combat.ts";
import { listLegalActions } from "./legal.ts";
import { areNeighbors, TERRITORY_IDS, type TerritoryId } from "./map/classic.ts";
import { territoryContinent } from "./objectives.ts";
import type { Action, GameState, PlayerId } from "./types.ts";

export type Difficulty = "recruta" | "oficial" | "marechal";

interface Profile {
  /** Minimum (from.armies − to.armies) advantage to launch an attack. */
  minAdvantage: number;
  /** Minimum armies on the origin to consider attacking. */
  minFromArmies: number;
  /** Trade voluntarily once the hand reaches this size. */
  tradeHandSize: number;
  /** Consolidate armies with one fortify when there is nothing worth attacking. */
  fortifies: boolean;
}

const PROFILES: Record<Difficulty, Profile> = {
  recruta: { minAdvantage: 2, minFromArmies: 3, tradeHandSize: 5, fortifies: false },
  oficial: { minAdvantage: 1, minFromArmies: 3, tradeHandSize: 4, fortifies: true },
  marechal: { minAdvantage: 1, minFromArmies: 2, tradeHandSize: 3, fortifies: true },
};

const neighborsOf = (id: TerritoryId): TerritoryId[] =>
  TERRITORY_IDS.filter((other) => areNeighbors(id, other));

const ownedIds = (state: GameState, playerId: PlayerId): TerritoryId[] =>
  TERRITORY_IDS.filter((id) => state.territories[id].ownerId === playerId);

function enemyNeighbors(state: GameState, playerId: PlayerId, id: TerritoryId): TerritoryId[] {
  return neighborsOf(id).filter((n) => state.territories[n].ownerId !== playerId);
}

const isBorder = (state: GameState, playerId: PlayerId, id: TerritoryId): boolean =>
  enemyNeighbors(state, playerId, id).length > 0;

function enemyPressure(state: GameState, playerId: PlayerId, id: TerritoryId): number {
  return enemyNeighbors(state, playerId, id).reduce(
    (sum, n) => sum + state.territories[n].armies,
    0,
  );
}

/** Where the next placement army should go, respecting continent/territory locks. */
function placementTarget(
  state: GameState,
  playerId: PlayerId,
  profile: Profile,
): { territoryId: TerritoryId; count: number } | null {
  const owned = ownedIds(state, playerId);
  if (owned.length === 0) return null;
  const pending = state.armiesToPlace;

  // 1. Territory-locked armies must land on their own territory.
  for (const id of owned) {
    const locked = pending.byTerritory[id] ?? 0;
    if (locked > 0) return { territoryId: id, count: locked };
  }

  // 2. Continent-locked armies must land inside that continent.
  for (const [cont, amount] of Object.entries(pending.byContinent)) {
    if (!amount) continue;
    const inCont = owned.filter((id) => territoryContinent(id) === cont);
    if (inCont.length === 0) continue;
    const borders = inCont.filter((id) => isBorder(state, playerId, id));
    const pool = borders.length ? borders : inCont;
    return { territoryId: pickPlacement(state, playerId, profile, pool), count: amount };
  }

  // 3. General armies go to the best border (or anywhere if fully interior).
  if (pending.general > 0) {
    const borders = owned.filter((id) => isBorder(state, playerId, id));
    const pool = borders.length ? borders : owned;
    return { territoryId: pickPlacement(state, playerId, profile, pool), count: pending.general };
  }
  return null;
}

function pickPlacement(
  state: GameState,
  playerId: PlayerId,
  profile: Profile,
  pool: TerritoryId[],
): TerritoryId {
  const scored = pool.map((id) => {
    const own = state.territories[id].armies;
    const pressure = enemyPressure(state, playerId, id);
    // Marechal builds a spearhead (concentrate where it already leads);
    // recruta/oficial shore up the border under the most pressure.
    const score = profile.minFromArmies <= 2 ? own - pressure : pressure - own;
    return { id, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0]!.id;
}

interface AttackChoice {
  from: TerritoryId;
  to: TerritoryId;
  armies: 1 | 2 | 3;
  advantage: number;
}

function bestAttack(state: GameState, playerId: PlayerId, profile: Profile): AttackChoice | null {
  let best: AttackChoice | null = null;
  for (const from of ownedIds(state, playerId)) {
    const fromArmies = state.territories[from].armies;
    if (fromArmies < profile.minFromArmies || fromArmies < 2) continue;
    const dice = attackDiceCount(fromArmies, 3);
    if (dice < 1) continue;
    for (const to of enemyNeighbors(state, playerId, from)) {
      const advantage = fromArmies - state.territories[to].armies;
      if (advantage < profile.minAdvantage) continue;
      if (
        !best ||
        advantage > best.advantage ||
        (advantage === best.advantage &&
          state.territories[to].armies < state.territories[best.to].armies)
      ) {
        best = { from, to, armies: dice as 1 | 2 | 3, advantage };
      }
    }
  }
  return best;
}

/** One consolidating move: interior surplus → the neediest adjacent border. */
function bestFortify(
  state: GameState,
  playerId: PlayerId,
): { from: TerritoryId; to: TerritoryId; armies: number } | null {
  let best: { from: TerritoryId; to: TerritoryId; armies: number; gain: number } | null = null;
  for (const from of ownedIds(state, playerId)) {
    const arrived = state.arrivedThisTurn[from] ?? 0;
    const movable = state.territories[from].armies - 1 - arrived;
    if (movable < 1) continue;
    if (isBorder(state, playerId, from)) continue; // keep border garrisons in place
    for (const to of neighborsOf(from)) {
      if (state.territories[to].ownerId !== playerId) continue;
      if (!isBorder(state, playerId, to)) continue;
      const gain = enemyPressure(state, playerId, to);
      if (!best || gain > best.gain) best = { from, to, armies: movable, gain };
    }
  }
  return best ? { from: best.from, to: best.to, armies: best.armies } : null;
}

/**
 * Decide the next single action for an AI player whose turn it is. Returns null
 * only when the player cannot legally act (not this player's turn / game over).
 * Every returned action is guaranteed to be one of `listLegalActions`.
 */
export function aiChooseAction(
  state: GameState,
  playerId: PlayerId,
  difficulty: Difficulty,
): Action | null {
  if (state.phase === "over" || state.currentPlayerId !== playerId) return null;
  const legal = listLegalActions(state, playerId);
  if (legal.length === 0) return null;
  const profile = PROFILES[difficulty];

  // Occupy a just-conquered territory: push forward with the max legal armies.
  if (state.pendingOccupy) {
    const occupies = legal.filter((a) => a.type === "occupy");
    return occupies.length ? occupies[occupies.length - 1]! : legal[0]!;
  }

  // Setup: drop the lone army on the neediest owned border.
  if (state.phase === "setup_place") {
    const target = placementTarget(state, playerId, profile);
    if (target) return { type: "place", playerId, territoryId: target.territoryId, count: 1 };
    return legal[0]!;
  }

  const player = state.players.find((p) => p.id === playerId)!;
  const trades = legal.filter((a) => a.type === "trade");

  // Mandatory trade (5+ cards, or 6+ after an elimination).
  if (state.mustTrade) return trades[0] ?? legal[0]!;

  if (state.phase === "reinforce") {
    // Optional trade when the hand is large enough for this personality.
    if (trades.length && player.cards.length >= profile.tradeHandSize) return trades[0]!;
    const target = placementTarget(state, playerId, profile);
    if (target) {
      return { type: "place", playerId, territoryId: target.territoryId, count: target.count };
    }
    const end = legal.find((a) => a.type === "endReinforce");
    return end ?? legal[0]!;
  }

  if (state.phase === "attack") {
    const attack = bestAttack(state, playerId, profile);
    if (attack) {
      return { type: "attack", playerId, from: attack.from, to: attack.to, armies: attack.armies };
    }
    if (profile.fortifies) {
      const fort = bestFortify(state, playerId);
      if (fort) {
        return { type: "fortify", playerId, from: fort.from, to: fort.to, armies: fort.armies };
      }
    }
    return legal.find((a) => a.type === "endTurn") ?? legal[0]!;
  }

  if (state.phase === "fortify") {
    return legal.find((a) => a.type === "endTurn") ?? legal[0]!;
  }

  return legal[0]!;
}
