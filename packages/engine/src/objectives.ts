import { CONTINENTS, type ContinentId, TERRITORY_BY_ID } from "./map/classic.ts";
import type { ArmyColor, GameState, Objective, PlayerId } from "./types.ts";

export const ALL_OBJECTIVES: Objective[] = [
  { kind: "continents_plus_one", continents: ["europe", "oceania"] },
  { kind: "continents", continents: ["asia", "south_america"] },
  { kind: "continents_plus_one", continents: ["europe", "south_america"] },
  { kind: "territories_min_armies", count: 18, minArmies: 2 },
  { kind: "continents", continents: ["asia", "africa"] },
  { kind: "continents", continents: ["north_america", "africa"] },
  { kind: "territories", count: 24 },
  { kind: "continents", continents: ["north_america", "oceania"] },
  { kind: "destroy_color", color: "blue" },
  { kind: "destroy_color", color: "yellow" },
  { kind: "destroy_color", color: "red" },
  { kind: "destroy_color", color: "black" },
  { kind: "destroy_color", color: "white" },
  { kind: "destroy_color", color: "green" },
];

export function objectivesForColors(colors: ArmyColor[]): Objective[] {
  return ALL_OBJECTIVES.filter((o) => {
    if (o.kind !== "destroy_color") return true;
    return colors.includes(o.color);
  });
}

function ownedIds(state: GameState, playerId: PlayerId): string[] {
  return Object.entries(state.territories)
    .filter(([, t]) => t.ownerId === playerId)
    .map(([id]) => id);
}

function controlsContinent(state: GameState, playerId: PlayerId, id: ContinentId): boolean {
  const spec = CONTINENTS.find((c) => c.id === id);
  if (!spec) return false;
  return spec.territories.every((tid) => state.territories[tid].ownerId === playerId);
}

export function effectiveObjective(player: { id: PlayerId; color: ArmyColor; objective: Objective }): Objective {
  const o = player.objective;
  if (o.kind === "hidden") return o;
  if (o.kind === "destroy_color" && o.color === player.color) {
    return { kind: "territories", count: 24 };
  }
  return o;
}

export function playerControlsCount(state: GameState, playerId: PlayerId): number {
  return ownedIds(state, playerId).length;
}

export function isObjectiveMet(state: GameState, playerId: PlayerId): boolean {
  const player = state.players.find((p) => p.id === playerId);
  if (!player?.alive) return false;
  const o = effectiveObjective(player);
  if (o.kind === "hidden") return false;
  const mine = ownedIds(state, playerId);

  if (o.kind === "territories") return mine.length >= o.count;
  if (o.kind === "territories_min_armies") {
    const n = mine.filter((id) => (state.territories[id as keyof typeof state.territories]?.armies ?? 0) >= o.minArmies)
      .length;
    return n >= o.count;
  }
  if (o.kind === "continents") {
    return o.continents.every((c) => controlsContinent(state, playerId, c));
  }
  if (o.kind === "continents_plus_one") {
    if (!o.continents.every((c) => controlsContinent(state, playerId, c))) return false;
    const extra = CONTINENTS.some(
      (c) => !o.continents.includes(c.id) && controlsContinent(state, playerId, c.id),
    );
    return extra;
  }
  if (o.kind === "destroy_color") {
    const target = state.players.find((p) => p.color === o.color);
    if (!target) return false;
    if (target.id === playerId) return mine.length >= 24;
    return !target.alive && target.killedBy === playerId;
  }
  return false;
}

export function continentBonusFor(state: GameState, playerId: PlayerId): Partial<Record<ContinentId, number>> {
  const out: Partial<Record<ContinentId, number>> = {};
  for (const c of CONTINENTS) {
    if (c.territories.every((tid) => state.territories[tid].ownerId === playerId)) {
      out[c.id] = c.bonus;
    }
  }
  return out;
}

export function convertOrphanDestroyObjectives(state: GameState, victimColor: ArmyColor, killerId: PlayerId): void {
  for (const p of state.players) {
    if (!p.alive || p.id === killerId) continue;
    const o = effectiveObjective(p);
    if (o.kind === "destroy_color" && o.color === victimColor) {
      p.objective = { kind: "territories", count: 24 };
    }
  }
}

export function territoryContinent(territoryId: string): ContinentId {
  return TERRITORY_BY_ID[territoryId as keyof typeof TERRITORY_BY_ID].continent;
}
