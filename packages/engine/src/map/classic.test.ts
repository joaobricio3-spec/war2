import { describe, expect, it } from "vitest";
import {
  CONTINENTS,
  TERRITORIES,
  TERRITORY_BY_ID,
  TERRITORY_IDS,
  areNeighbors,
} from "./classic.ts";

describe("classic map", () => {
  it("has 42 territories", () => {
    expect(TERRITORIES).toHaveLength(42);
    expect(new Set(TERRITORY_IDS).size).toBe(42);
  });

  it("partitions territories into continents with classic bonuses", () => {
    const all = CONTINENTS.flatMap((c) => c.territories);
    expect(all).toHaveLength(42);
    expect(new Set(all).size).toBe(42);
    const bonus = Object.fromEntries(CONTINENTS.map((c) => [c.id, c.bonus]));
    expect(bonus).toEqual({
      south_america: 2,
      north_america: 5,
      europe: 5,
      africa: 3,
      asia: 7,
      oceania: 2,
    });
  });

  it("is an undirected graph without self-loops", () => {
    for (const t of TERRITORIES) {
      expect(t.neighbors).not.toContain(t.id);
      for (const n of t.neighbors) {
        expect(TERRITORY_BY_ID[n].neighbors).toContain(t.id);
      }
    }
  });

  it("connects Alaska to Vladivostok and Brazil to Algeria", () => {
    expect(areNeighbors("alaska", "vladivostok")).toBe(true);
    expect(areNeighbors("brasil", "argelia")).toBe(true);
    expect(areNeighbors("brasil", "mexico")).toBe(false);
  });

  it("assigns 14 of each shape", () => {
    const counts = { circle: 0, triangle: 0, square: 0 };
    for (const t of TERRITORIES) counts[t.shape] += 1;
    expect(counts).toEqual({ circle: 14, triangle: 14, square: 14 });
  });
});
