// What a saved plastic calculation records about how it was made, so it can be reproduced and checked later: the staged dataset it read (name and
// fingerprint of the exact rows), the engine contract, the formulas it used with their versions and states, whether it was complete, and which
// parts of a real quote it left out. Small by design (ids and versions, not the assumption text): the text is in the formula registry at that version.
import type { ValidationState } from './formula-registry';
import type { QuoteValidation } from './quote-validation';

export const CALCULATION_SNAPSHOT_SCHEMA = 'plastic_calc_snapshot_v1';

export interface CalculationSnapshot {
  schema: typeof CALCULATION_SNAPSHOT_SCHEMA;
  referenceData: { sourceVersion: string; fingerprint: string };
  /** persisted-process-cost.ts COST_ENGINE_CONTRACT_VERSION at the time. */
  engineVersion: string;
  formulas: Array<{ id: string; version: number; state: ValidationState }>;
  state: ValidationState;
  complete: boolean;
  /** G-ids of what the quote left out. */
  unsupported: string[];
}

export function buildCalculationSnapshot(
  validation: QuoteValidation,
  reference: { sourceVersion: string; datasetFingerprint: string },
  engineVersion: string,
): CalculationSnapshot {
  return {
    schema: CALCULATION_SNAPSHOT_SCHEMA,
    referenceData: { sourceVersion: reference.sourceVersion, fingerprint: reference.datasetFingerprint },
    engineVersion,
    formulas: validation.formulas.map((f) => ({ id: f.id, version: f.version, state: f.state })),
    state: validation.state,
    complete: validation.complete,
    unsupported: validation.unsupported.map((u) => u.id),
  };
}

/**
 * Whether a saved snapshot still describes what the engine would use today: the same dataset rows and the same version of every formula it used.
 * `reasons` names what changed; empty when nothing did.
 */
export function snapshotDrift(
  saved: CalculationSnapshot,
  current: { referenceFingerprint: string; formulaVersions: ReadonlyMap<string, number> },
): { reproducible: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (saved.referenceData.fingerprint !== current.referenceFingerprint) reasons.push('the reference data has changed since this calculation');
  for (const f of saved.formulas) {
    const now = current.formulaVersions.get(f.id);
    if (now === undefined) reasons.push(`${f.id} is no longer in the formula registry`);
    else if (now !== f.version) reasons.push(`${f.id} is now version ${now} (calculated with version ${f.version})`);
  }
  return { reproducible: reasons.length === 0, reasons };
}
