import { describe, expect, it } from "vitest";
import { resolveBattle } from "./combat.ts";

describe("resolveBattle", () => {
  it("gives ties to the defender", () => {
    expect(resolveBattle([5, 4, 1], [6, 3, 1])).toEqual({
      attackLosses: 2,
      defendLosses: 1,
    });
  });

  it("compares only the paired highest dice", () => {
    expect(resolveBattle([3, 2], [6])).toEqual({ attackLosses: 1, defendLosses: 0 });
  });

  it("lets the attacker wipe three with 6,3,2 vs 5,4,2", () => {
    expect(resolveBattle([6, 3, 2], [5, 4, 2])).toEqual({
      attackLosses: 2,
      defendLosses: 1,
    });
  });

  it("attacker can win all three", () => {
    expect(resolveBattle([5, 3, 2], [4, 2, 1])).toEqual({
      attackLosses: 0,
      defendLosses: 3,
    });
  });
});
