// What a saved plastic calculation records about how it was made, so it can be reproduced and checked later: the staged dataset it read (name and
// fingerprint of the exact rows), the engine contract, the formulas it used with their versions and states, whether it was complete, and which
// parts of a real quote it left out, and the inputs it was given. With the stored reference rows (reference_data_snapshots, by fingerprint) the line
// is recomputed from this record alone (calculation-replay.ts).
import type { ValidationState } from './formula-registry';
import type { QuoteValidation } from './quote-validation';

export const CALCULATION_SNAPSHOT_SCHEMA = 'plastic_calc_snapshot_v1';

export interface CalculationSnapshot {
  schema: typeof CALCULATION_SNAPSHOT_SCHEMA;
  referenceData: { sourceVersion: string; fingerprint: string };
  /** persisted-process-cost.ts COST_ENGINE_CONTRACT_VERSION at the time: a version string someone maintains. */
  engineVersion: string;
  /**
   * The identifier of the engine's actual code: a hash of every runtime source file it imports (engine-build.generated.ts). Not maintained by hand, so
   * two different implementations cannot share it. Absent on a calculation saved before it was recorded.
   */
  engineBuild?: { codeHash: string; files: number };
  formulas: Array<{ id: string; version: number; state: ValidationState }>;
  /**
   * The stored calculators that computed the cycle time, with a fingerprint of their formulas (calculators/plastic-cycle-time.ts): a replay refuses when the formulas now in
   * force differ. Absent on a calculation saved before the cycle time was calculator-driven.
   */
  calculators?: Array<{ name: string; version: number | null; fingerprint: string }>;
  state: ValidationState;
  complete: boolean;
  /** G-ids of what the quote left out. */
  unsupported: string[];
  /**
   * Everything the engine was given except the reference data (stored under the fingerprint): the part's measurements, the material, the press and
   * its rates, the scenario. With the stored rows and the same formula versions, calculation-replay.ts recomputes the line from this alone.
   */
  inputs: Record<string, unknown>;
}

/** The engine input in the form that is stored: JSON-safe, without the reference data (stored by fingerprint) and without the machine selection log. */
export function replayableInputs(input: Record<string, unknown>): Record<string, unknown> {
  // The calculators are the formulas, identified by the snapshot's `calculators` fingerprints, not data of the part.
  const { plasticReference: _ref, plasticReferenceMissing: _missing, calculators: _calculators, mhrRate, ...rest } = input as { plasticReference?: unknown; plasticReferenceMissing?: unknown; calculators?: unknown; mhrRate?: Record<string, unknown> } & Record<string, unknown>;
  const { selection: _selection, ...rate } = mhrRate ?? {};
  return JSON.parse(JSON.stringify({ ...rest, ...(mhrRate ? { mhrRate: rate } : {}) })) as Record<string, unknown>;
}

export function buildCalculationSnapshot(
  validation: QuoteValidation,
  reference: { sourceVersion: string; datasetFingerprint: string },
  engineVersion: string,
  engineBuild: { codeHash: string; files: number },
  inputs: Record<string, unknown>,
  calculators: ReadonlyArray<{ name: string; version: number | null; fingerprint: string }> = [],
): CalculationSnapshot {
  return {
    schema: CALCULATION_SNAPSHOT_SCHEMA,
    referenceData: { sourceVersion: reference.sourceVersion, fingerprint: reference.datasetFingerprint },
    engineVersion,
    engineBuild: { codeHash: engineBuild.codeHash, files: engineBuild.files },
    formulas: validation.formulas.map((f) => ({ id: f.id, version: f.version, state: f.state })),
    ...(calculators.length > 0 ? { calculators: calculators.map((c) => ({ name: c.name, version: c.version, fingerprint: c.fingerprint })) } : {}),
    state: validation.state,
    complete: validation.complete,
    unsupported: validation.unsupported.map((u) => u.id),
    inputs: replayableInputs(inputs),
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
