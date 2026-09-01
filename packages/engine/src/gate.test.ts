import { describe, expect, it } from "vitest";
import { beginTurn, createGame } from "./createGame.ts";
import { resolveBattle } from "./combat.ts";
import { cloneState } from "./clone.ts";
import { isObjectiveMet } from "./objectives.ts";
import { createSeededRng } from "./rng.ts";
import { CONTINENTS, TERRITORIES, TERRITORY_BY_ID, TERRITORY_IDS } from "./map/classic.ts";
import type { GameState, PlayerId } from "./types.ts";

/**
 * Gate assertions required by GOAL.md / scripts/war-gate.mjs. These pin the
 * Grow/War Brazil rules the whole product depends on. If one breaks, the gate
 * fails and no visual polish counts.
 */
describe("WAR GATE", () => {
  it("has 42 territories across 6 continents with Grow bonuses", () => {
    expect(TERRITORIES).toHaveLength(42);
    expect(new Set(TERRITORY_IDS).size).toBe(42);
    const bonus = Object.fromEntries(CONTINENTS.map((c) => [c.id, c.bonus]));
    expect(bonus).toEqual({
      north_america: 5,
      south_america: 2,
      europe: 5,
      africa: 3,
      asia: 7,
      oceania: 2,
    });
  });

  it("is a symmetric graph (A→B ⇒ B→A) and links Alaska–Vladivostok", () => {
    for (const t of TERRITORIES) {
      expect(t.neighbors).not.toContain(t.id);
      for (const n of t.neighbors) {
        expect(TERRITORY_BY_ID[n].neighbors).toContain(t.id);
      }
    }
    expect(TERRITORY_BY_ID.alaska.neighbors).toContain("vladivostok");
    expect(TERRITORY_BY_ID.vladivostok.neighbors).toContain("alaska");
  });

  it("reinforces with max(3, floor(n/2)) — never divided by 3", () => {
    const g = createGame({
      rng: createSeededRng(7),
      players: [
        { id: "a", nickname: "A", color: "red" },
        { id: "b", nickname: "B", color: "blue" },
      ],
    });
    const pid: PlayerId = "a";
    for (const owned of [1, 2, 3, 6, 7, 10, 11, 20, 42]) {
      const s: GameState = cloneState(g);
      for (const id of TERRITORY_IDS) s.territories[id] = { ownerId: "b", armies: 1 };
      let k = 0;
      for (const id of TERRITORY_IDS) {
        if (k >= owned) break;
        s.territories[id] = { ownerId: pid, armies: 1 };
        k += 1;
      }
      s.players.find((p) => p.id === pid)!.cards = [];
      const started = beginTurn(s, pid);
      const expected = Math.max(3, Math.floor(owned / 2));
      const risk = Math.max(3, Math.floor(owned / 3));
      expect(started.armiesToPlace.general).toBe(expected);
      // guard against the Risk /3 rule sneaking in, whenever /2 and /3 diverge
      if (expected !== risk) expect(started.armiesToPlace.general).not.toBe(risk);
    }
  });

  it("gives dice ties to the defender", () => {
    expect(resolveBattle([6], [6])).toEqual({ attackLosses: 1, defendLosses: 0 });
    expect(resolveBattle([5, 4, 1], [6, 3, 1])).toEqual({ attackLosses: 2, defendLosses: 1 });
  });

  it("counts the 18-with-2 mission as 18 qualifying territories, not merely 18 owned", () => {
    const g = createGame({
      rng: createSeededRng(11),
      players: [
        { id: "a", nickname: "A", color: "red" },
        { id: "b", nickname: "B", color: "blue" },
      ],
    });
    const pid: PlayerId = "a";
    const s: GameState = cloneState(g);
    TERRITORY_IDS.forEach((id, i) => {
      s.territories[id] = { ownerId: i < 18 ? pid : "b", armies: 1 };
    });
    s.players.find((p) => p.id === pid)!.objective = {
      kind: "territories_min_armies",
      count: 18,
      minArmies: 2,
    };
    // 18 owned but all at 1 army: NOT met.
    expect(isObjectiveMet(s, pid)).toBe(false);
    TERRITORY_IDS.slice(0, 18).forEach((id) => {
      s.territories[id].armies = 2;
    });
    expect(isObjectiveMet(s, pid)).toBe(true);
  });
});
