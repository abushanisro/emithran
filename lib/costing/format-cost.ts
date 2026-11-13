/**
 * A per-part cost as text: four decimals from a cent up, and two significant figures below a cent, so a fraction of a cent reads as its
 * value ("0.00081") instead of "0.0000", and machines that differ by less than a cent are visibly ranked. Zero is "0.00".
 */
export function formatPerPartCost(value: number): string {
  if (value === 0) return '0.00';
  if (Math.abs(value) >= 0.01) return value.toFixed(4);
  return value.toLocaleString('en-US', { maximumSignificantDigits: 2, useGrouping: false });
}
