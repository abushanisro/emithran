// Recompute a saved plastic line from what was stored with it, and say whether it comes out the same. Nothing is guessed: a missing piece (the reference
// rows, the inputs, the formula code at the version used) is a stated reason, never a silent substitution of today's values.
//
// What makes a saved calculation reconstructable (all three must hold):
//   1. its inputs, stored in the snapshot (calculation_breakdown.inputs);
//   2. the reference rows it read, stored once per fingerprint (reference_data_snapshots) and checked against that fingerprint;
//   3. the same engine contract and the same version of every formula it used. The code that runs is today's, so a formula whose version has changed since cannot be replayed:
//      the old code is in the repository history at the recorded engine version, not here.
import type { CalculationSnapshot } from './calculation-snapshot';
import { snapshotDrift } from './calculation-snapshot';
import { PLASTIC_FORMULAS } from './formula-registry';
import { canonicalReferenceRows, resolvePlasticReference, restoreReferenceRows, type CanonicalReferenceRows } from './plastic-reference';
import { computeInjectionMoldedCostSummary, type InjectionMoldingCostInput } from './process/cost-injection-molding-engine';
import { PLASTIC_ENGINE_BUILD } from './engine-build.generated';
import { fingerprintRows } from './reference-fingerprint';
import { calculatorFingerprint } from './calculators/plastic-cycle-time';
import { plasticMoldingCalculatorsByName } from './calculators/plastic-molding-calculator-spec';
import { COST_ENGINE_CONTRACT_VERSION } from '../shared/core/persisted-process-cost';

/** The money of a saved line (process_cost_records), per part, in the currency it was saved in. */
export interface SavedLineMoney { setupCost: number; runCost: number; totalCost: number; machineCostPerPart?: number | null; laborCostPerPart?: number | null }

/** What a replay stood on: enough to audit it without re-running it. */
export interface ReplayEvidence {
  /** Where the reference rows came from. Always the stored copy: a replay has no path to the live reference data. */
  referenceSource: 'stored' | 'unavailable';
  snapshotFingerprint: string;
  /** The fingerprint of the stored rows as recomputed now; null when none were given. */
  storedRowsFingerprint: string | null;
  fingerprintVerified: boolean;
  formulaVersionsMatch: boolean;
  engineVersionRecorded: string;
  engineVersionNow: string;
  /** The hash of the engine's code the calculation was made with (null when it was not recorded), the one running now, and whether they are the same code. */
  engineBuildRecorded: string | null;
  engineBuildNow: string;
  engineBuildMatches: boolean | null;
  inputsRecorded: boolean;
}

export interface ReplayResult {
  /** True only when the line was recomputed and every saved amount equals the recomputed one. */
  reproduced: boolean;
  /** Why not, or what differed; empty when reproduced. */
  reasons: string[];
  replayed: SavedLineMoney | null;
  evidence: ReplayEvidence;
  /** Every check in the order it was made, with its outcome: the audit trail of this replay. */
  audit: string[];
}

const EPS = 1e-9;
const FORMULA_VERSIONS = new Map(PLASTIC_FORMULAS.map((f) => [f.id, f.version]));

export function replayPlasticLine(snapshot: CalculationSnapshot, storedRows: CanonicalReferenceRows | null, saved: SavedLineMoney): ReplayResult {
  const evidence: ReplayEvidence = {
    referenceSource: storedRows ? 'stored' : 'unavailable',
    snapshotFingerprint: snapshot.referenceData.fingerprint,
    storedRowsFingerprint: storedRows ? fingerprintRows(storedRows) : null,
    fingerprintVerified: false,
    formulaVersionsMatch: false,
    engineVersionRecorded: snapshot.engineVersion,
    engineVersionNow: COST_ENGINE_CONTRACT_VERSION,
    engineBuildRecorded: snapshot.engineBuild?.codeHash ?? null,
    engineBuildNow: PLASTIC_ENGINE_BUILD.codeHash,
    engineBuildMatches: snapshot.engineBuild ? snapshot.engineBuild.codeHash === PLASTIC_ENGINE_BUILD.codeHash : null,
    inputsRecorded: !!snapshot.inputs && Object.keys(snapshot.inputs).length > 0,
  };
  const audit: string[] = [];
  const fail = (...reasons: string[]): ReplayResult => ({ reproduced: false, reasons, replayed: null, evidence, audit: [...audit, ...reasons.map((r) => `REFUSED: ${r}`)] });

  if (!evidence.inputsRecorded) return fail('the inputs were not recorded with this calculation');
  audit.push('inputs: recorded with the calculation');

  // The engine contract is the stamp of the code path outside the registered formulas: a different one is a different engine.
  if (snapshot.engineVersion !== COST_ENGINE_CONTRACT_VERSION) {
    return fail(`the engine contract is now ${COST_ENGINE_CONTRACT_VERSION} (calculated with ${snapshot.engineVersion}): the code that made this number is not available to replay`);
  }
  audit.push(`engine contract: ${snapshot.engineVersion}, the recorded one`);
  // The code itself: the contract version is a label, the build is a hash of the files that run. A different build is disclosed, not hidden, and does
  // not by itself stop a replay: if the recomputation equals the saved amounts, newer code has reproduced the number, and the trail says so.
  audit.push(evidence.engineBuildMatches === null
    ? 'engine build: not recorded with this calculation (it cannot be said whether the same code made it)'
    : evidence.engineBuildMatches
      ? `engine build: identical code (${PLASTIC_ENGINE_BUILD.codeHash}, ${PLASTIC_ENGINE_BUILD.files} files)`
      : `engine build: DIFFERENT code (recorded ${evidence.engineBuildRecorded}, now ${PLASTIC_ENGINE_BUILD.codeHash})`);

  // The data is checked below against the stored rows; here only the formulas.
  const formulaDrift = snapshotDrift(snapshot, { referenceFingerprint: snapshot.referenceData.fingerprint, formulaVersions: FORMULA_VERSIONS }).reasons;
  if (formulaDrift.length > 0) return fail(...formulaDrift.map((r) => `${r}: the code of the version it used is not available to replay`));
  evidence.formulaVersionsMatch = true;
  audit.push(`formulas: ${snapshot.formulas.length} used, each at its recorded version (${snapshot.formulas.map((f) => `${f.id} v${f.version}`).join(', ')})`);

  if (!storedRows) return fail(`the reference rows for fingerprint ${snapshot.referenceData.fingerprint} are not stored`);
  if (evidence.storedRowsFingerprint !== snapshot.referenceData.fingerprint) return fail('the stored reference rows do not match their fingerprint: they have been altered');
  evidence.fingerprintVerified = true;
  audit.push(`reference rows: the stored copy (not the live data), fingerprint ${snapshot.referenceData.fingerprint} verified against the stored rows`);

  const { reference } = resolvePlasticReference(restoreReferenceRows(storedRows));
  if (!reference) return fail('the stored reference rows no longer resolve to a complete reference');

  // The formulas are the stored calculators as this engine build holds them (the spec), never the live database. A calculation that recorded which calculators it ran
  // is refused when their formulas now in force differ; one saved before the cycle time was calculator-driven is recomputed with them, and the parity test is what says
  // they give the numbers the earlier in-code formulas gave.
  const calculators = plasticMoldingCalculatorsByName();
  for (const recorded of snapshot.calculators ?? []) {
    const now = calculators[recorded.name];
    if (!now) return fail(`the calculator "${recorded.name}" it ran is not in this engine build`);
    if (calculatorFingerprint(now) !== recorded.fingerprint) return fail(`the formulas of "${recorded.name}" have changed since this calculation (fingerprint ${recorded.fingerprint}, now ${calculatorFingerprint(now)}): the formulas it used are not available to replay`);
  }
  audit.push(snapshot.calculators?.length
    ? `calculators: ${snapshot.calculators.map((c) => `${c.name} (formulas ${c.fingerprint})`).join(', ')}, the same formulas as recorded`
    : 'calculators: none recorded (saved before the cycle time was calculator-driven); recomputed with the stored calculators of this build');

  // The reference is always the one resolved from the stored rows: anything a snapshot's inputs might carry under these keys is overwritten.
  const result = computeInjectionMoldedCostSummary({ ...snapshot.inputs, calculators, plasticReference: reference, plasticReferenceMissing: [] } as unknown as InjectionMoldingCostInput);
  const line = result.processLines.find((l) => l.calculationSnapshot !== undefined);
  if (!line) return fail('the recomputation produced no molding line');
  audit.push('recomputed: the molding line from the recorded inputs');

  const replayed: SavedLineMoney = {
    setupCost: line.setupCost, runCost: line.runCost, totalCost: line.totalCost,
    ...(line.machineCostPerPart != null ? { machineCostPerPart: line.machineCostPerPart } : {}),
    ...(line.laborCostPerPart != null ? { laborCostPerPart: line.laborCostPerPart } : {}),
  };
  const reasons: string[] = [];
  let compared = 0;
  for (const k of ['setupCost', 'runCost', 'totalCost', 'machineCostPerPart', 'laborCostPerPart'] as const) {
    const was = saved[k]; const now = replayed[k];
    if (was == null && now == null) continue;
    compared += 1;
    if (was == null || now == null || Math.abs(was - now) > EPS) reasons.push(`${k}: saved ${was ?? 'none'}, recomputed ${now ?? 'none'}`);
  }
  audit.push(reasons.length === 0 ? `compared: ${compared} amounts, all equal to the saved ones` : `compared: ${compared} amounts, ${reasons.length} differ`);
  if (evidence.engineBuildMatches === false) {
    audit.push(reasons.length === 0
      ? 'note: reproduced by different code: the number is the same, the code is not'
      : 'note: the engine code differs from the code that made this number, which may be the cause of the difference');
    if (reasons.length > 0) reasons.push(`the engine build differs (recorded ${evidence.engineBuildRecorded}, now ${PLASTIC_ENGINE_BUILD.codeHash}): the difference may be the cause`);
  }
  return { reproduced: reasons.length === 0, reasons, replayed, evidence, audit };
}

export { canonicalReferenceRows };
