/**
 * 1-based ascending ranks (smallest value = rank 1) over the values that are
 * present and positive. A missing (null) or non-positive value gets rank 0,
 * meaning "not ranked" — it must never win rank 1 by counting as 0.
 */
export function rankAscending(values: readonly (number | null | undefined)[]): number[] {
  const ranks: number[] = Array.from({ length: values.length }, () => 0);
  values
    .map((value, index) => ({ value, index }))
    .filter((e): e is { value: number; index: number } => typeof e.value === 'number' && e.value > 0)
    .sort((a, b) => a.value - b.value)
    .forEach((e, position) => {
      ranks[e.index] = position + 1;
    });
  return ranks;
}

/**
 * Weighted sum of one vendor's ranks (weights in percent), rounded to 2 dp.
 * 0 when any rank is missing: a score over partial data is not comparable.
 */
export function weightedRankScore(
  ranks: readonly number[],
  weightsPct: readonly number[],
): number {
  if (ranks.some((r) => !(r > 0))) return 0;
  const sum = ranks.reduce((s, r, i) => s + (r * (weightsPct[i] ?? 0)) / 100, 0);
  return Math.round(sum * 100) / 100;
}
