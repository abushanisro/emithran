import type { BlankSpecDto } from '@/lib/api/hooks/useBOMItems';

/**
 * Where a Raw Material record's Net/Gross Usage comes from.
 *
 * - `sheet_nesting`: the real per-part yield from the sheet-metal nesting engine.
 * - `stock_blank`: machining -- the weight of the stock the blank optimizer
 *   actually selected (stock volume x material density). The engine prices
 *   material on this same figure, so the record must agree with it.
 * - `scrap_allowance_fallback`: no real stock/nesting result is available yet
 *   (cost summary still loading, or material density unresolved), so Gross is
 *   estimated as Net / (1 - scrap allowance). A disclosed estimate, never
 *   used when a real stock or nesting result exists.
 * - `none`: nothing to derive from.
 */
export type MaterialUsageSource =
  | 'sheet_nesting'
  | 'stock_blank'
  | 'scrap_allowance_fallback'
  | 'none';

export interface MaterialUsage {
  grossUsage: number;
  netUsage: number;
  scrapPct: number;
  source: MaterialUsageSource;
}

export const FALLBACK_SCRAP_PCT = 10;

const STOCK_DRIVEN_FORMS: ReadonlyArray<BlankSpecDto['form']> = [
  'round_bar',
  'hex_bar',
  'rectangular_bar',
  'billet',
  'extrusion',
];

/**
 * True when `blankSpec` describes a real, density-resolved machining stock
 * whose weight can drive Gross Usage. Requires both weights to be real and the
 * stock to be at least as heavy as the part: a blank smaller than the part it
 * is cut into is physically impossible (the backend already warns that the
 * geometry/units are inconsistent in that case), so it is not trusted.
 */
export function isStockDrivenBlank(
  blankSpec: Pick<BlankSpecDto, 'form' | 'grossWeightKg' | 'netWeightKg'> | null | undefined,
): boolean {
  if (!blankSpec) return false;
  if (!STOCK_DRIVEN_FORMS.includes(blankSpec.form)) return false;
  return blankSpec.grossWeightKg > 0
    && blankSpec.netWeightKg > 0
    && blankSpec.grossWeightKg >= blankSpec.netWeightKg;
}

const r6 = (n: number) => parseFloat(n.toFixed(6));
const r2 = (n: number) => parseFloat(n.toFixed(2));

export interface DeriveMaterialUsageInput {
  blankSpec: BlankSpecDto | null | undefined;
  isSheetMetal: boolean;
  /** Engine's live per-part gross weight (cost summary `grossWeightKg`). */
  engineGrossKg: number | null;
  /** Engine's live per-part net weight (`blankSpec.netWeightKg`). */
  engineNetKg: number | null;
  itemVolumeMm3: number | null | undefined;
  densityKgM3: number | null | undefined;
  cadWeightKg: number | null | undefined;
}

/**
 * Net/Gross/Scrap for a Raw Material record, in order of trustworthiness:
 * real sheet nesting, then real machining stock, then a disclosed
 * scrap-allowance estimate. Scrap % is always derived from the resulting
 * gross/net, never assumed, except inside the estimate branch where it is the
 * stated allowance.
 */
export function deriveMaterialUsage(input: DeriveMaterialUsageInput): MaterialUsage {
  const { blankSpec, isSheetMetal, engineGrossKg, engineNetKg, itemVolumeMm3, densityKgM3, cadWeightKg } = input;

  if (isSheetMetal && engineGrossKg !== null && engineNetKg !== null) {
    const grossUsage = r6(engineGrossKg);
    const netUsage = r6(engineNetKg);
    return {
      grossUsage,
      netUsage,
      scrapPct: grossUsage > 0 ? r2(((grossUsage - netUsage) / grossUsage) * 100) : 0,
      source: 'sheet_nesting',
    };
  }

  if (blankSpec && isStockDrivenBlank(blankSpec)) {
    const grossUsage = r6(blankSpec.grossWeightKg);
    const netUsage = r6(blankSpec.netWeightKg);
    return {
      grossUsage,
      netUsage,
      scrapPct: r2(((grossUsage - netUsage) / grossUsage) * 100),
      source: 'stock_blank',
    };
  }

  const fromNet = (net: number): MaterialUsage => ({
    netUsage: r6(net),
    grossUsage: r6(net / (1 - FALLBACK_SCRAP_PCT / 100)),
    scrapPct: FALLBACK_SCRAP_PCT,
    source: 'scrap_allowance_fallback',
  });

  if (itemVolumeMm3 && densityKgM3) return fromNet((itemVolumeMm3 * densityKgM3) / 1e9);
  if (cadWeightKg != null && cadWeightKg > 0) return fromNet(cadWeightKg);
  if (engineGrossKg != null) {
    const grossUsage = r6(engineGrossKg);
    return {
      grossUsage,
      netUsage: r6(grossUsage * (1 - FALLBACK_SCRAP_PCT / 100)),
      scrapPct: FALLBACK_SCRAP_PCT,
      source: 'scrap_allowance_fallback',
    };
  }

  return { grossUsage: 0, netUsage: 0, scrapPct: 0, source: 'none' };
}
