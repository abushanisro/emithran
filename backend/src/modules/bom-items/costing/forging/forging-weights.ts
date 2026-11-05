// Closed-die hot forging: net, flash, scale, kerf and gross weight of one part
// cut from one round bar size (v1.1 sections 6.1, 6.3, 6.5). Pure.
//
//   net      Vp (mm3) x 1e-9 (m3/mm3) x density (kg/m3)
//   flash    flash % x Vp; flash % = forging_partComplexityBasedData "Hot
//            Forging - Flash Percentage Volume" at the part complexity score.
//            The column does not name its base: it is applied to the net
//            part volume (v1.1 6.3, open decision D1).
//   scale    scale % x (Vp + flash); scaleLossAllowancePercentage (gas
//            furnace) or ...InductionHeating, whose notes define it as a
//            percentage of the total forged volume including flash
//   mult     Vp + flash + scale: the heated slug; its length on the bar is
//            mult / bar area
//   kerf     bar area x bandSawKerfWidth: the saw cut that frees the mult
//   gross    mult + kerf, priced at the material's Round Bar Unit Cost
//
// Not modelled, and said so in the warnings: the bar-end loss over a stock
// length (standardStockLength, multLengthElongationFactor; their formula is
// not in memory) and a tong hold (closed-die forging from bar has none in
// memory). Scale is lost as oxide; flash and kerf are solid scrap, credited
// only under enableScrapMaterialCredit (forging-engine.ts).

import type { ForgingMaterial, ForgingReference } from './forging-reference';

export type HeatingMethod = 'induction' | 'furnace';

const MM3_TO_M3 = 1e-9;

export interface TraceStep { label: string; value: string }

export interface ForgingWeights {
  barDiameterMm: number;
  barAreaMm2: number;
  flashPct: number;
  scalePct: number;
  netVolumeMm3: number;
  flashVolumeMm3: number;
  scaleVolumeMm3: number;
  multVolumeMm3: number;
  multLengthMm: number;
  /** Mult length / bar diameter. */
  multRatio: number;
  kerfVolumeMm3: number;
  grossVolumeMm3: number;
  netKg: number;
  flashKg: number;
  scaleKg: number;
  kerfKg: number;
  grossKg: number;
  /** Gross material cost per part (USD, round bar price). */
  grossCostUsd: number;
  /** Net / gross weight. */
  materialYield: number;
}

export type WeightsResult =
  | { ok: true; weights: ForgingWeights; trace: TraceStep[] }
  | { ok: false; missing: string[] };

/** Bar cross-section (mm2). */
export const barArea = (diameterMm: number): number => (Math.PI / 4) * diameterMm * diameterMm;

/** Flash and scale percentages for the part; the inputs that are not on file otherwise. */
export function forgingAllowances(input: {
  reference: ForgingReference;
  complexityScore: number | null;
  heating: HeatingMethod | null;
}): { ok: true; complexityScore: number; flashPct: number; scalePct: number; scaleKey: string } | { ok: false; missing: string[] } {
  const missing: string[] = [];
  const v = input.reference.variables;
  const score = input.complexityScore;
  const flashPct = score != null ? input.reference.flashPctByComplexity.get(score) : undefined;
  if (score == null) missing.push('part complexity score (1-12; its scoring algorithm is not in memory, v1.1 6.2: enter it)');
  else if (flashPct == null) missing.push(`forging_partComplexityBasedData row for part complexity ${score}`);
  if (input.heating == null) missing.push('heating method (induction or furnace)');
  if (missing.length || score == null || flashPct == null) return { ok: false, missing };
  const scaleKey = input.heating === 'induction' ? 'scaleLossAllowancePercentageInductionHeating' : 'scaleLossAllowancePercentage';
  return { ok: true, complexityScore: score, flashPct, scalePct: v[scaleKey], scaleKey };
}

export function forgingWeights(input: {
  reference: ForgingReference;
  material: ForgingMaterial;
  partVolumeMm3: number | null;
  complexityScore: number | null;
  heating: HeatingMethod | null;
  barDiameterMm: number;
}): WeightsResult {
  const missing: string[] = [];
  const m = input.material;
  const vp = input.partVolumeMm3;
  if (vp == null || !(vp > 0)) missing.push('part volume (mm³)');
  if (m.densityKgM3 == null || !(m.densityKgM3 > 0)) missing.push(`${m.name}: Density (kg/m³)`);
  if (m.roundBarUsdPerKg == null || !(m.roundBarUsdPerKg > 0)) missing.push(`${m.name}: Round Bar Unit Cost (USD/kg)`);
  if (!(input.barDiameterMm > 0)) missing.push('bar diameter (mm)');
  const allow = forgingAllowances(input);
  if (!allow.ok) missing.push(...allow.missing);
  const rho = m.densityKgM3;
  const price = m.roundBarUsdPerKg;
  if (missing.length || !allow.ok || vp == null || rho == null || price == null) return { ok: false, missing };

  const kg = (mm3: number) => mm3 * MM3_TO_M3 * rho;
  const d = input.barDiameterMm;
  const area = barArea(d);
  const netVolumeMm3 = vp;
  const flashVolumeMm3 = (allow.flashPct / 100) * netVolumeMm3;
  const scaleVolumeMm3 = (allow.scalePct / 100) * (netVolumeMm3 + flashVolumeMm3);
  const multVolumeMm3 = netVolumeMm3 + flashVolumeMm3 + scaleVolumeMm3;
  const multLengthMm = multVolumeMm3 / area;
  const kerfVolumeMm3 = area * input.reference.variables.bandSawKerfWidth;
  const grossVolumeMm3 = multVolumeMm3 + kerfVolumeMm3;
  const grossKg = kg(grossVolumeMm3);
  const weights: ForgingWeights = {
    barDiameterMm: d, barAreaMm2: area, flashPct: allow.flashPct, scalePct: allow.scalePct,
    netVolumeMm3, flashVolumeMm3, scaleVolumeMm3, multVolumeMm3, multLengthMm, multRatio: multLengthMm / d,
    kerfVolumeMm3, grossVolumeMm3,
    netKg: kg(netVolumeMm3), flashKg: kg(flashVolumeMm3), scaleKg: kg(scaleVolumeMm3), kerfKg: kg(kerfVolumeMm3), grossKg,
    grossCostUsd: grossKg * price,
    materialYield: netVolumeMm3 / grossVolumeMm3,
  };
  const r = (x: number, p = 2) => x.toFixed(p);
  const trace: TraceStep[] = [
    { label: 'Net', value: `${r(netVolumeMm3)} mm³ × ${rho} kg/m³ = ${r(weights.netKg, 4)} kg` },
    { label: 'Flash', value: `${allow.flashPct} % of net volume (forging_partComplexityBasedData, complexity ${allow.complexityScore}; basis per v1.1 D1) = ${r(flashVolumeMm3)} mm³` },
    { label: 'Scale', value: `${allow.scalePct} % (${allow.scaleKey}) of ${r(netVolumeMm3 + flashVolumeMm3)} mm³ forged volume incl. flash = ${r(scaleVolumeMm3)} mm³` },
    { label: 'Mult', value: `${r(multVolumeMm3)} mm³ on Ø${d} mm bar: length ${r(multLengthMm)} mm, L/D ${r(weights.multRatio, 3)}` },
    { label: 'Kerf', value: `${r(area)} mm² × bandSawKerfWidth ${input.reference.variables.bandSawKerfWidth} mm = ${r(kerfVolumeMm3)} mm³` },
    { label: 'Gross', value: `${r(grossVolumeMm3)} mm³ = ${r(grossKg, 5)} kg × ${price} USD/kg = ${r(weights.grossCostUsd, 4)} USD; yield ${r(weights.materialYield * 100, 1)} %` },
  ];
  return { ok: true, weights, trace };
}
