import { describe, expect, it } from "vitest";
import { cloneState } from "./clone.ts";
import { createGame } from "./createGame.ts";
import { effectiveObjective, isObjectiveMet, objectivesForColors } from "./objectives.ts";
import { createSeededRng } from "./rng.ts";
import { reduce } from "./reduce.ts";
import type { GameState, PlayerId } from "./types.ts";
import { TERRITORY_IDS, type TerritoryId } from "./map/classic.ts";
import { CONTINENTS } from "./map/classic.ts";

function threePlayerGame(seed = 1): GameState {
  return createGame({
    rng: createSeededRng(seed),
    players: [
      { id: "a", nickname: "Ana", color: "red" },
      { id: "b", nickname: "Bia", color: "blue" },
      { id: "c", nickname: "Caio", color: "green" },
    ],
  });
}

function skipSetup(state: GameState): GameState {
  let s = state;
  const rng = createSeededRng(99);
  let guard = 0;
  while (s.phase === "setup_place") {
    const id = s.currentPlayerId;
    const t = (Object.keys(s.territories) as TerritoryId[]).find(
      (k) => s.territories[k].ownerId === id,
    )!;
    const r = reduce(s, { type: "place", playerId: id, territoryId: t, count: 1 }, rng);
    if (!r.ok) throw new Error(r.error);
    s = r.state;
    if (++guard > 500) throw new Error("setup loop");
  }
  return s;
}

describe("createGame", () => {
  it("deals all 42 territories with 1 army and leftover setup pool", () => {
    const g = threePlayerGame();
    expect(Object.keys(g.territories)).toHaveLength(42);
    const byPlayer: Record<string, number> = { a: 0, b: 0, c: 0 };
    for (const t of Object.values(g.territories)) {
      expect(t.armies).toBe(1);
      byPlayer[t.ownerId] = (byPlayer[t.ownerId] ?? 0) + 1;
    }
    expect(byPlayer.a! + byPlayer.b! + byPlayer.c!).toBe(42);
    expect(g.phase).toBe("setup_place");
    for (const p of g.players) {
      expect(p.setupRemaining).toBe(35 - byPlayer[p.id]!);
    }
  });

  it("excludes destroy objectives for colors not at the table", () => {
    const g = threePlayerGame();
    const colors = new Set(g.players.map((p) => p.color));
    for (const p of g.players) {
      if (p.objective.kind === "destroy_color") {
        expect(colors.has(p.objective.color)).toBe(true);
      }
    }
    const pool = objectivesForColors(["red", "blue", "green"]);
    expect(pool.some((o) => o.kind === "destroy_color" && o.color === "white")).toBe(false);
    expect(pool.some((o) => o.kind === "destroy_color" && o.color === "black")).toBe(false);
    expect(pool.some((o) => o.kind === "destroy_color" && o.color === "yellow")).toBe(false);
  });
});

describe("objectives", () => {
  it("treats destroy-own-color as 24 territories", () => {
    expect(
      effectiveObjective({
        id: "a",
        color: "red",
        objective: { kind: "destroy_color", color: "red" },
      }),
    ).toEqual({ kind: "territories", count: 24 });
  });

  it("detects 24 territories", () => {
    const g = skipSetup(threePlayerGame(2));
    const pid = g.currentPlayerId;
    const next: GameState = cloneState(g);
    let i = 0;
    for (const id of TERRITORY_IDS) {
      next.territories[id] = { ownerId: i < 24 ? pid : "b", armies: 1 };
      i += 1;
    }
    next.players.find((p) => p.id === pid)!.objective = { kind: "territories", count: 24 };
    expect(isObjectiveMet(next, pid)).toBe(true);
  });

  it("requires a third continent for europe+oceania", () => {
    const g = skipSetup(threePlayerGame(3));
    const pid = g.currentPlayerId;
    const next: GameState = cloneState(g);
    for (const id of TERRITORY_IDS) {
      next.territories[id] = { ownerId: "b", armies: 1 };
    }
    for (const c of CONTINENTS) {
      if (c.id === "europe" || c.id === "oceania") {
        for (const t of c.territories) next.territories[t] = { ownerId: pid, armies: 1 };
      }
    }
    next.players.find((p) => p.id === pid)!.objective = {
      kind: "continents_plus_one",
      continents: ["europe", "oceania"],
    };
    expect(isObjectiveMet(next, pid)).toBe(false);
    for (const t of CONTINENTS.find((c) => c.id === "africa")!.territories) {
      next.territories[t] = { ownerId: pid, armies: 1 };
    }
    expect(isObjectiveMet(next, pid)).toBe(true);
  });

  it("requires 18 territories each with at least 2 armies", () => {
    const g = skipSetup(threePlayerGame(4));
    const pid: PlayerId = g.currentPlayerId;
    const next: GameState = cloneState(g);
    TERRITORY_IDS.forEach((id, i) => {
      next.territories[id] = { ownerId: i < 18 ? pid : "b", armies: i < 18 ? 1 : 1 };
    });
    next.players.find((p) => p.id === pid)!.objective = {
      kind: "territories_min_armies",
      count: 18,
      minArmies: 2,
    };
    expect(isObjectiveMet(next, pid)).toBe(false);
    TERRITORY_IDS.slice(0, 18).forEach((id) => {
      next.territories[id].armies = 2;
    });
    expect(isObjectiveMet(next, pid)).toBe(true);
  });
});
