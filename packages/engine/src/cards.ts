import type { GameCard } from "./types.ts";

export function isValidTrade(cards: GameCard[]): boolean {
  if (cards.length !== 3) return false;
  const jokers = cards.filter((c) => c.kind === "joker").length;
  const real = cards.filter((c) => c.kind === "territory").map((c) => c.shape);
  const unique = new Set(real);
  if (jokers === 0) return unique.size === 1 || unique.size === 3;
  if (jokers === 1 && real.length === 2) return unique.size === 1 || unique.size === 2;
  if (jokers === 2 && real.length === 1) return true;
  if (jokers === 3) return true;
  return false;
}

/** 0-based number of trades already completed in the game. */
export function tradeArmies(tradeIndex: number): number {
  const table = [4, 6, 8, 10, 12];
  if (tradeIndex < table.length) return table[tradeIndex]!;
  return 15 + (tradeIndex - 5) * 5;
}

export function pendingPlaceTotal(pending: {
  general: number;
  byContinent: Record<string, number | undefined>;
  byTerritory: Record<string, number | undefined>;
}): number {
  let extra = 0;
  for (const v of Object.values(pending.byContinent)) extra += v ?? 0;
  for (const v of Object.values(pending.byTerritory)) extra += v ?? 0;
  return pending.general + extra;
}
