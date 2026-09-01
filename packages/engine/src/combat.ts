export function resolveBattle(
  attackDice: number[],
  defendDice: number[],
): { attackLosses: number; defendLosses: number } {
  const a = [...attackDice].sort((x, y) => y - x);
  const d = [...defendDice].sort((x, y) => y - x);
  const n = Math.min(a.length, d.length);
  let attackLosses = 0;
  let defendLosses = 0;
  for (let i = 0; i < n; i++) {
    if ((a[i] ?? 0) > (d[i] ?? 0)) defendLosses += 1;
    else attackLosses += 1;
  }
  return { attackLosses, defendLosses };
}

export function attackDiceCount(armiesOnFrom: number, requested: number): number {
  return Math.min(3, requested, Math.max(0, armiesOnFrom - 1));
}

export function defendDiceCount(armiesOnTo: number): number {
  return Math.min(3, armiesOnTo);
}
