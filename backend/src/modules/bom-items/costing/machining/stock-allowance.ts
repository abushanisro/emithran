// Machining stock allowance — the reference rule, never a code constant.
//
// Source: memory/Stock Maching/variables.csv (staged by migration 816 as
// machining_reference_data category 'variable', source_version
// '2026-Stock-Machining'):
//   percentStockAllowance  5        "Stock thickness as a percent (%) of the
//                                     maximum cross section dimension
//                                     (OD or max(width, height))"
//   minStockAllowance      0.79375  "Minimum allowed stock thickness for any size part"
//   maxStockAllowance      3.175    "Maximum allowed stock thickness for any size part"
// memory/Multi-Spindle Maching/variables.csv carries the same three values.
//
// Per-side allowance = clamp(percent / 100 × max cross-section, min, max).
// For a billet the cross-section is perpendicular to its longest side, so the
// max cross-section dimension is the middle of the three sorted dimensions.

export const STOCK_MACHINING_SOURCE_VERSION = '2026-Stock-Machining';
export const STOCK_ALLOWANCE_VARIABLE_KEYS = ['percentStockAllowance', 'minStockAllowance', 'maxStockAllowance'] as const;

export interface StockAllowanceRule {
  percentOfMaxCrossSection: number;
  minMm: number;
  maxMm: number;
}

/** Reads the rule from staged variable rows; null (naming what is missing)
 *  when any of the three is absent or not a number. */
export function resolveStockAllowanceRule(
  rows: ReadonlyArray<{ key: string; value: string | number | null }> | null | undefined,
): { rule: StockAllowanceRule | null; missing: string[] } {
  const byKey = new Map((rows ?? []).map((r) => [r.key, Number(r.value)]));
  const missing = STOCK_ALLOWANCE_VARIABLE_KEYS.filter((k) => !Number.isFinite(byKey.get(k)));
  if (missing.length > 0) return { rule: null, missing: [...missing] };
  return {
    rule: {
      percentOfMaxCrossSection: byKey.get('percentStockAllowance')!,
      minMm: byKey.get('minStockAllowance')!,
      maxMm: byKey.get('maxStockAllowance')!,
    },
    missing: [],
  };
}

/** Per-side allowance (mm) for a billet of these outer dimensions. */
export function stockAllowancePerSideMm(
  rule: StockAllowanceRule,
  dims: { length: number; width: number; height: number },
): number {
  const [, maxCrossSection] = [dims.length, dims.width, dims.height].sort((a, b) => b - a);
  const raw = (rule.percentOfMaxCrossSection / 100) * (maxCrossSection ?? 0);
  return Math.min(rule.maxMm, Math.max(rule.minMm, raw));
}
