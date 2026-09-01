import { pendingPlaceTotal, isValidTrade } from "./cards.ts";
import { attackDiceCount } from "./combat.ts";
import { areNeighbors, TERRITORY_IDS, type TerritoryId } from "./map/classic.ts";
import { territoryContinent } from "./objectives.ts";
import type { Action, GameState, PlayerId } from "./types.ts";

function placeableCount(state: GameState, territoryId: TerritoryId): number {
  const byTer = state.armiesToPlace.byTerritory[territoryId] ?? 0;
  const byCont = state.armiesToPlace.byContinent[territoryContinent(territoryId)] ?? 0;
  return byTer + byCont + state.armiesToPlace.general;
}

export function listLegalActions(state: GameState, playerId: PlayerId): Action[] {
  if (state.phase === "over" || state.currentPlayerId !== playerId) return [];
  const out: Action[] = [];
  const mine = TERRITORY_IDS.filter((id) => state.territories[id].ownerId === playerId);

  if (state.phase === "setup_place") {
    for (const id of mine) out.push({ type: "place", playerId, territoryId: id, count: 1 });
    return out;
  }

  if (state.pendingOccupy) {
    const { minArmies, maxArmies, from } = state.pendingOccupy;
    const origin = state.territories[from].armies;
    const max = Math.min(maxArmies, origin - 1);
    for (let a = minArmies; a <= max; a++) out.push({ type: "occupy", playerId, armies: a });
    return out;
  }

  if (state.mustTrade || state.phase === "reinforce") {
    const player = state.players.find((p) => p.id === playerId)!;
    if (player.cards.length >= 3) {
      const ids = player.cards.map((c) => c.id);
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          for (let k = j + 1; k < ids.length; k++) {
            const cardIds = [ids[i]!, ids[j]!, ids[k]!];
            const cards = cardIds.map((id) => player.cards.find((c) => c.id === id)!);
            if (isValidTrade(cards)) out.push({ type: "trade", playerId, cardIds });
          }
        }
      }
    }
    if (state.mustTrade) return out;
  }

  if (state.phase === "reinforce" && !state.mustTrade) {
    const pending = pendingPlaceTotal(state.armiesToPlace);
    if (pending > 0) {
      for (const id of mine) {
        if (placeableCount(state, id) < 1) continue;
        out.push({ type: "place", playerId, territoryId: id, count: 1 });
      }
    } else {
      out.push({ type: "endReinforce", playerId });
    }
    return out;
  }

  if (state.phase === "attack") {
    for (const from of mine) {
      const armies = state.territories[from].armies;
      const dice = attackDiceCount(armies, 3);
      if (dice < 1) continue;
      for (const to of TERRITORY_BY_NEIGHBORS(from)) {
        if (state.territories[to].ownerId === playerId) continue;
        for (let a = 1; a <= dice; a++) {
          out.push({ type: "attack", playerId, from, to, armies: a as 1 | 2 | 3 });
        }
      }
    }
    out.push({ type: "endTurn", playerId });
    for (const from of mine) {
      const arrived = state.arrivedThisTurn[from] ?? 0;
      const movable = state.territories[from].armies - 1 - arrived;
      if (movable < 1) continue;
      for (const to of TERRITORY_BY_NEIGHBORS(from)) {
        if (state.territories[to].ownerId !== playerId) continue;
        out.push({ type: "fortify", playerId, from, to, armies: 1 });
      }
    }
    return out;
  }

  if (state.phase === "fortify") {
    for (const from of mine) {
      const arrived = state.arrivedThisTurn[from] ?? 0;
      const movable = state.territories[from].armies - 1 - arrived;
      if (movable < 1) continue;
      for (const to of TERRITORY_BY_NEIGHBORS(from)) {
        if (state.territories[to].ownerId !== playerId) continue;
        out.push({ type: "fortify", playerId, from, to, armies: 1 });
      }
    }
    out.push({ type: "endTurn", playerId });
  }
  return out;
}

function TERRITORY_BY_NEIGHBORS(from: TerritoryId): TerritoryId[] {
  return TERRITORY_IDS.filter((id) => areNeighbors(from, id));
}
