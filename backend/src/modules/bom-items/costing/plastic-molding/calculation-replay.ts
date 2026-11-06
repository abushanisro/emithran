// Recompute a saved plastic line from what was stored with it, and say whether it comes out the same. Nothing is guessed: a missing piece (the reference
// rows, the inputs, the formula code at the version used) is a stated reason, never a silent substitution of today's values.
//
// What makes a saved calculation reconstructable (all three must hold):
//   1. its inputs, stored in the snapshot (calculation_breakdown.inputs);
//   2. the reference rows it read, stored once per fingerprint (reference_data_snapshots) and checked against that fingerprint;
//   3. the same version of every formula it used. The code that runs is today's, so a formula whose version has changed since cannot be replayed:
//      the old code is in the repository history at the recorded engine version, not here.
import type { CalculationSnapshot } from './calculation-snapshot';
import { snapshotDrift } from './calculation-snapshot';
import { PLASTIC_FORMULAS } from './formula-registry';
import { canonicalReferenceRows, resolvePlasticReference, restoreReferenceRows, type CanonicalReferenceRows } from './plastic-reference';
import { computeInjectionMoldedCostSummary, type InjectionMoldingCostInput } from './process/cost-injection-molding-engine';
import { fingerprintRows } from './reference-fingerprint';

/** The money of a saved line (process_cost_records), per part, in the currency it was saved in. */
export interface SavedLineMoney { setupCost: number; runCost: number; totalCost: number; machineCostPerPart?: number | null; laborCostPerPart?: number | null }

export interface ReplayResult {
  /** True only when the line was recomputed and every saved amount equals the recomputed one. */
  reproduced: boolean;
  /** Why not, or what differed; empty when reproduced. */
  reasons: string[];
  replayed: SavedLineMoney | null;
}

const EPS = 1e-9;
const FORMULA_VERSIONS = new Map(PLASTIC_FORMULAS.map((f) => [f.id, f.version]));

export function replayPlasticLine(snapshot: CalculationSnapshot, storedRows: CanonicalReferenceRows | null, saved: SavedLineMoney): ReplayResult {
  const fail = (...reasons: string[]): ReplayResult => ({ reproduced: false, reasons, replayed: null });

  if (!snapshot.inputs || Object.keys(snapshot.inputs).length === 0) return fail('the inputs were not recorded with this calculation');
  // The data is checked below against the stored rows; here only the formulas.
  const formulaDrift = snapshotDrift(snapshot, { referenceFingerprint: snapshot.referenceData.fingerprint, formulaVersions: FORMULA_VERSIONS }).reasons;
  if (formulaDrift.length > 0) return fail(...formulaDrift.map((r) => `${r}: the code of the version it used is not available to replay`));
  if (!storedRows) return fail(`the reference rows for fingerprint ${snapshot.referenceData.fingerprint} are not stored`);
  if (fingerprintRows(storedRows) !== snapshot.referenceData.fingerprint) return fail('the stored reference rows do not match their fingerprint: they have been altered');

  const { reference } = resolvePlasticReference(restoreReferenceRows(storedRows));
  if (!reference) return fail('the stored reference rows no longer resolve to a complete reference');

  const result = computeInjectionMoldedCostSummary({ ...snapshot.inputs, plasticReference: reference, plasticReferenceMissing: [] } as unknown as InjectionMoldingCostInput);
  const line = result.processLines.find((l) => l.calculationSnapshot !== undefined);
  if (!line) return fail('the recomputation produced no molding line');

  const replayed: SavedLineMoney = {
    setupCost: line.setupCost, runCost: line.runCost, totalCost: line.totalCost,
    ...(line.machineCostPerPart != null ? { machineCostPerPart: line.machineCostPerPart } : {}),
    ...(line.laborCostPerPart != null ? { laborCostPerPart: line.laborCostPerPart } : {}),
  };
  const reasons: string[] = [];
  for (const k of ['setupCost', 'runCost', 'totalCost', 'machineCostPerPart', 'laborCostPerPart'] as const) {
    const was = saved[k]; const now = replayed[k];
    if (was == null && now == null) continue;
    if (was == null || now == null || Math.abs(was - now) > EPS) reasons.push(`${k}: saved ${was ?? 'none'}, recomputed ${now ?? 'none'}`);
  }
  return { reproduced: reasons.length === 0, reasons, replayed };
}

export { canonicalReferenceRows };
