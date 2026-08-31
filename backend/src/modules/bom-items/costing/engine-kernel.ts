// Shared arithmetic kernel for the cutting-family engines (laser, waterjet,
// turret punch — and future registered engines). Extracted from what was
// previously copy-pasted verbatim into each engine file (Track B, Phase 1 —
// see the redesign plan): the r2() rounder, the no-DB-rate fallback literal,
// and the direct-labor-cost formula.
//
// Root-cause bug fixed here: waterjet-engine.ts and turret-punch-engine.ts
// both charge a direct-labor cost (rate.labourRate × time, one operator,
// same eMithranTerms setupNDL/cycleNDL=1 convention as cost-engine.ts) —
// laser-cutting-engine.ts never did, an unintended divergence, not a
// deliberate design choice (laser has no physical reason to need less
// operator attention than waterjet/turret). Every caller of
// computeDirectLaborCost() now gets this term consistently; laser is wired
// onto it in the same change that introduces this file, closing the gap.
import type { MHRRateInput } from './cost-engine';

export function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function noRateFallback(machineClass: string): MHRRateInput {
  return { rate: 0, source: 'no_db_rate', machineClass, machineName: null, commodityCode: null };
}

export interface DirectLaborCost {
  setupLaborCost: number;
  runLaborCost: number;
}

/**
 * One operator's direct-labor cost for a cutting operation, amortized the
 * same way as every eMithranTerms() call site (setup cost divided by
 * batchSize, run cost charged per-piece). `rate.labourRate == null` means no
 * differentiated labor rate resolved for this location/process — $0 labor
 * is disclosed via `warnings`, never silently guessed.
 */
export function computeDirectLaborCost(
  rate: MHRRateInput,
  setupMin: number,
  cycleMin: number,
  batchSize: number,
  processLabel: string,
  warnings: string[],
): DirectLaborCost {
  if (rate.labourRate == null) {
    warnings.push(`${processLabel}: no direct labor rate resolved for this process — labor cost excluded from quote`);
  }
  const dlrMin = (rate.labourRate ?? 0) / 60;
  return {
    setupLaborCost: dlrMin * setupMin / Math.max(batchSize, 1),
    runLaborCost: dlrMin * cycleMin,
  };
}

// eMithranTerms() itself stays defined in cost-engine.ts (its 9 existing
// inline call sites there are untouched by this phase) — re-exported here so
// new cross-engine code has one canonical import path, per the redesign
// plan's Track B Phase 1 file list.
export { eMithranTerms } from './cost-engine';
