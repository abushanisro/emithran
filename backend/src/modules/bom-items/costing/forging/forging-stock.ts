// Closed-die hot forging: which round bar the mult is cut from (v1.1 6.5, D8).
// Pure.
//
// Every forging_roundBarSizes diameter is checked:
//   minBilletRatio <= mult length / diameter <= maxBilletRatio   (all stock)
//   diameter <= inductionHeatMaxStockWidth and
//   mult length / diameter >= inductionHeatMinMultRatio          (induction only)
// and each valid size is priced (gross kg x Round Bar Unit Cost). The cheapest
// per part is chosen; on equal cost the smaller bar.
//
// Round bar only: virtualStockForm is ROUND_BAR and memory prices no other
// form. validMaterialStocksListLimit / virtualMaterialStocksListLimit cap how
// many stocks the source model evaluates, but memory does not say which come
// first, so every size is evaluated here and the trace says so. The induction
// coil diameter of the actual heater (mhr_records specs) is checked with the
// machines, not here.

import { forgingWeights, type ForgingWeights, type HeatingMethod, type TraceStep } from './forging-weights';

import type { ForgingMaterial, ForgingReference } from './forging-reference';

export interface BarCheck {
  diameterMm: number;
  valid: boolean;
  reasons: string[];
  /** Present when the weights could be computed. */
  weights: ForgingWeights | null;
}

export type StockResult =
  | { ok: true; chosen: ForgingWeights; checks: BarCheck[]; trace: TraceStep[] }
  | { ok: false; reason: string; checks: BarCheck[] };

export function chooseRoundBar(input: {
  reference: ForgingReference;
  material: ForgingMaterial;
  partVolumeMm3: number | null;
  complexityScore: number | null;
  heating: HeatingMethod | null;
}): StockResult {
  const v = input.reference.variables;
  const checks: BarCheck[] = [];
  const valid: ForgingWeights[] = [];
  for (const d of input.reference.roundBarSizesMm) {
    const w = forgingWeights({ ...input, barDiameterMm: d });
    if (!w.ok) return { ok: false, reason: `Gross weight not derivable: missing ${w.missing.join('; ')}.`, checks };
    const x = w.weights;
    const reasons: string[] = [];
    if (x.multRatio < v.minBilletRatio) reasons.push(`L/D ${x.multRatio.toFixed(3)} < minBilletRatio ${v.minBilletRatio}`);
    if (x.multRatio > v.maxBilletRatio) reasons.push(`L/D ${x.multRatio.toFixed(3)} > maxBilletRatio ${v.maxBilletRatio}`);
    if (input.heating === 'induction') {
      if (d > v.inductionHeatMaxStockWidth) reasons.push(`Ø${d} mm > inductionHeatMaxStockWidth ${v.inductionHeatMaxStockWidth} mm`);
      if (x.multRatio < v.inductionHeatMinMultRatio) reasons.push(`L/D ${x.multRatio.toFixed(3)} < inductionHeatMinMultRatio ${v.inductionHeatMinMultRatio}`);
    }
    checks.push({ diameterMm: d, valid: reasons.length === 0, reasons, weights: x });
    if (reasons.length === 0) valid.push(x);
  }
  valid.sort((a, b) => a.grossCostUsd - b.grossCostUsd || a.barDiameterMm - b.barDiameterMm);
  if (valid.length === 0) {
    const limits = input.heating === 'induction'
      ? `minBilletRatio ${v.minBilletRatio} to maxBilletRatio ${v.maxBilletRatio}, inductionHeatMinMultRatio ${v.inductionHeatMinMultRatio}, inductionHeatMaxStockWidth ${v.inductionHeatMaxStockWidth} mm`
      : `minBilletRatio ${v.minBilletRatio} to maxBilletRatio ${v.maxBilletRatio}`;
    return { ok: false, reason: `No round bar in forging_roundBarSizes (${checks.length} sizes) gives a valid mult (${limits}).`, checks };
  }
  const chosen = valid[0];
  const trace: TraceStep[] = [{
    label: 'Stock',
    value: `Ø${chosen.barDiameterMm} mm round bar: cheapest gross material of ${valid.length} valid sizes `
      + `(${valid.map((w) => `Ø${w.barDiameterMm}`).join(', ')}); every size evaluated, `
      + 'validMaterialStocksListLimit / virtualMaterialStocksListLimit not applied (their ordering is not in memory)',
  }];
  return { ok: true, chosen, checks, trace };
}
