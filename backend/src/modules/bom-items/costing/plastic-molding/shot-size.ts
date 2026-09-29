// Shot size one cavity needs, in the unit press shot capacity is rated in:
// GPPS grams (memory/Plastic Modeling/machine: limits.shotSizeGppsG). The ONE
// rule the press selector and the cost engine both use.
//
//   shot mass       net part mass x (1 + runner allowance)
//   GPPS grams      shot mass x (GPPS melt density / material melt density):
//                   the same barrel melt volume, filled with GPPS
//   required        x shotSizeSafetyFactor (material left in the chamber)
//
// The runner allowance is the one figure here without a reference source:
// the reference runner tables (tblRunnerCalculationCoefficients, layoutNumCav)
// give branch counts and diameters per layout, but memory/ does not define the
// branch length rule, so runner volume cannot be derived from geometry yet.

import type { RunnerSystem } from './clamp-force';
import type { PlasticReference } from './plastic-reference';

/** Runner / sprue share of the part mass per shot: cold runner 8 %, hot runner 1 % (see header). */
export const IM_RUNNER_SCRAP_PCT = 8;
export const IM_HOT_RUNNER_SCRAP_PCT = 1;

export function shotWeightKgPerPart(netWeightKg: number, runner: RunnerSystem): number {
  const pct = runner === 'hot' ? IM_HOT_RUNNER_SCRAP_PCT : IM_RUNNER_SCRAP_PCT;
  return Math.round(netWeightKg * (1 + pct / 100) * 1000) / 1000;
}

/** GPPS-equivalent grams one cavity needs, or null without a melt density or reference. */
export function shotGppsGramsPerCavity(input: {
  shotWeightKg: number;
  meltDensityKgM3: number | null | undefined;
  reference: PlasticReference | null;
}): number | null {
  const { reference: ref, meltDensityKgM3: melt } = input;
  if (!ref || melt == null || !(melt > 0)) return null;
  return input.shotWeightKg * 1000 * (ref.cycleModel.gppsMeltDensityKgM3 / melt) * ref.shotSizeSafetyFactor;
}
