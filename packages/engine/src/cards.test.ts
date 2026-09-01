import { describe, expect, it } from "vitest";
import { isValidTrade, tradeArmies } from "./cards.ts";
import type { GameCard } from "./types.ts";

const ter = (id: string, shape: "circle" | "triangle" | "square"): GameCard => ({
  id,
  kind: "territory",
  territoryId: "brasil",
  shape,
});

const joker = (id: string): GameCard => ({ id, kind: "joker", shape: "joker" });

describe("isValidTrade", () => {
  it("accepts three of a kind and three distinct", () => {
    expect(isValidTrade([ter("a", "circle"), ter("b", "circle"), ter("c", "circle")])).toBe(
      true,
    );
    expect(
      isValidTrade([ter("a", "circle"), ter("b", "triangle"), ter("c", "square")]),
    ).toBe(true);
  });

  it("rejects two-and-one without joker", () => {
    expect(
      isValidTrade([ter("a", "circle"), ter("b", "circle"), ter("c", "square")]),
    ).toBe(false);
  });

  it("lets a joker complete three of a kind or three distinct", () => {
    expect(isValidTrade([ter("a", "circle"), ter("b", "circle"), joker("j")])).toBe(true);
    expect(isValidTrade([ter("a", "circle"), ter("b", "triangle"), joker("j")])).toBe(
      true,
    );
  });

  it("accepts two jokers plus anything", () => {
    expect(isValidTrade([ter("a", "square"), joker("j1"), joker("j2")])).toBe(true);
  });
});

describe("tradeArmies", () => {
  it("follows 4-6-8-10-12 then +5", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(tradeArmies)).toEqual([
      4, 6, 8, 10, 12, 15, 20, 25,
    ]);
  });
});
