// Type-only import — erased at runtime, so the cost-engine <-> composer cycle
// this creates in the module graph never exists in emitted JS.
import type { CostEngineInput } from '../../shared/core/cost-engine';
import type { ProcessLineCost } from '../../../dto/cost-breakdown.dto';
import {
  TAPPING_SETUP_MIN,
  COUNTERBORE_SETUP_MIN,
  COUNTERSINK_SETUP_MIN,
  PEM_INSERTION_SETUP_MIN,
  BURRING_SETUP_MIN,
  TIGHT_TOLERANCE_REAM_THRESHOLD_MM,
  REAM_SETUP_MIN,
} from '../../shared/core/default-rates.constants';
import { computeHoleExtrusionCost } from './hole-extrusion-engine';
import { computeTappingCost } from './tapping-engine';
import { computeDeburringCost } from './deburring-engine';
import { computeCounterboringCost } from './counterboring-engine';
import { computeCountersinkingCost } from './countersinking-engine';
import { computePemInsertionCost } from './pem-insertion-engine';
import { computeReamingCost } from './reaming-engine';
import { computeSurfaceTreatmentLine } from '../../shared/process/cost-surface-treatment';

// ── The canonical feature-driven operation composer ───────────────────────────
//
// The one definition of which secondary operations a sheet-metal part needs and
// in what order. A route's own core operations (the cutting or forming process,
// and Press Brake where that route does not bend in-process) are composed around
// the result — see composeOperationSequence() below:
//
//     selected route's core operations + applicable feature-driven operations
//     = one canonical final operation sequence
//
// Root cause this exists to remove (traced 2026-09-06): this composition was
// written twice. computeCostSummary() assembled nine feature-driven operations;
// getRouteComparison()'s assembleRoute() independently assembled four of them.
// The two disagreed in both directions and the divergence was live and priced:
//
//   cost-summary : Laser + Press Brake + Deburring + PEM Insertion + Inspection
//   sm-laser route: Laser + Press Brake + Deburring + Inspection
//
// PEM Insertion — a genuinely feature-driven operation, recognised from real CAD
// through-hole groups matched against sm_lookup_pem_hardware by diameter and
// sheet thickness — was absent from every route in the comparison, so every
// route total understated the part by that operation. Counterboring,
// Countersinking, Reaming/CMM and Surface Treatment were absent for the same
// reason. Whichever path the user happened to be looking at decided what the
// part appeared to cost.
//
// Nothing here decides *whether* an operation applies. Each engine is gated on a
// real feature count the CAD extractor produced (extrudedFlangeCount, threads,
// counterboreCount, countersinkCount, pemCount, holeCount + tightestToleranceMm)
// or on a real recognition result, exactly as before. An operation with no
// feature behind it contributes no line. No operation is invented, and no
// operation is forced into a route.

/**
 * Exactly the fields this composer reads, picked from CostEngineInput so the
 * two can never drift apart.
 *
 * Narrowed on purpose: the route-comparison path builds one of these from what
 * it has resolved, and must not be forced to invent the unrelated material,
 * nesting or machine-attribute fields a full CostEngineInput carries. A real
 * CostEngineInput is structurally assignable, so the primary quote path keeps
 * passing its own input unchanged.
 */
export type FeatureDrivenOperationInput = Pick<CostEngineInput,
  | 'batchSize' | 'cutLengthMm' | 'threads' | 'location'
  | 'extrudedFlangeCount' | 'counterboreCount' | 'countersinkCount' | 'pemCount'
  | 'holeCount' | 'tightestToleranceMm'
  | 'opSetupMinByOp' | 'mhrRates' | 'processIdentityByMachineClass'
  | 'burringCycleTimeSecFromCalculator' | 'burringCalculatorId' | 'burringCalculatorVersion'
  | 'burringPhysicsGap' | 'burringConfidence'
  | 'tappingCycleTimeSecFromCalculator' | 'tappingCalculatorId' | 'tappingCalculatorVersion'
  | 'tappingPhysicsGap' | 'tappingConfidence'
  | 'deburrCycleTimeSecFromCalculator' | 'deburrCalculatorId' | 'deburrCalculatorVersion'
  | 'deburrPhysicsGap' | 'deburrConfidence'
  | 'counterboreCycleTimeSecFromCalculator' | 'counterboreCalculatorId' | 'counterboreCalculatorVersion'
  | 'counterborePhysicsGap' | 'counterboreConfidence'
  | 'countersinkCycleTimeSecFromCalculator' | 'countersinkCalculatorId' | 'countersinkCalculatorVersion'
  | 'countersinkPhysicsGap' | 'countersinkConfidence'
  | 'pemCycleTimeSecFromCalculator' | 'pemCalculatorId' | 'pemCalculatorVersion'
  | 'pemPhysicsGap' | 'pemConfidence'
  | 'reamCycleTimeSecFromCalculator' | 'reamCalculatorId' | 'reamCalculatorVersion'
  | 'reamPhysicsGap' | 'reamConfidence'
  | 'inspectionResult' | 'surfaceTreatment' | 'surfaceAreaMm2' | 'surfaceTreatmentDbRate'
>;

/**
 * The shared cost-composition context every operation engine already receives
 * (eMithranTerms' labour, QA-sampling, yield-loss and scrap-recovery terms).
 * Passed through untouched — this composer changes no formula.
 */
export interface EMithranSharedContext {
  dlrPerHr: number;
  qairPerHr: number;
  inspTimeMin: number;
  samplingRate: number;
  yieldPct: number;
  netMatCost: number;
  netWeightKg: number;
  scrapPricePerKg: number;
}

/**
 * Where an operation sits relative to the route's forming step.
 *
 * The split is physical, not cosmetic. Hole extrusion forms the collar and
 * tapping cuts the thread into it while the part is still FLAT: tapping into an
 * already-bent flange risks tool access and interference, and bending first
 * means handling an already-threaded part through the remaining operations.
 * Everything else finishes the part after it has been formed.
 */
export interface FeatureDrivenOperations {
  /** Performed while the blank is still flat, before any bending. */
  preForm: ProcessLineCost[];
  /** Performed after forming — finishing, hardware insertion, inspection. */
  postForm: ProcessLineCost[];
  warnings: string[];
  /** Real cycle minutes the route DTO reports per operation family. */
  cycleMinutes: { tappingMin: number; deburrMin: number };
}

/**
 * Composes every feature-driven operation that applies to this part.
 *
 * `input` carries the already-resolved physics for each operation (cycle
 * seconds from the real DB calculator, calculator id/version, structured gap,
 * confidence) exactly as CostEngineInput has always defined it — this function
 * resolves no physics of its own and reads no database. `ctx` is the shared
 * eMithran cost-composition context every engine already received.
 */
export function composeFeatureDrivenOperations(
  input: FeatureDrivenOperationInput,
  ctx: EMithranSharedContext,
): FeatureDrivenOperations {
  const warnings: string[] = [];
  const preForm: ProcessLineCost[] = [];
  const postForm: ProcessLineCost[] = [];

  const batchSize = input.batchSize;
  const noRate = (machineClass: string) =>
    ({ rate: 0, source: 'no_db_rate' as const, machineClass, machineName: null, commodityCode: null });

  // ── Hole Extrusion (Burring) — before Press Brake AND Tapping ──────────────
  // Forms the extruded hole flange/collar (e.g. drawing callout "2X M3 BURLING
  // BACK CONVEX") before the hole is threaded — physically required ordering.
  const extrudedFlangeCount = input.extrudedFlangeCount ?? 0;
  if (extrudedFlangeCount > 0 && input.opSetupMinByOp?.burring == null) {
    warnings.push(`Hole extrusion (burring) setup time not on file — generic default applied (${BURRING_SETUP_MIN} min)`);
  }
  const holeFormingRate = input.mhrRates?.holeForming ?? noRate('hole_forming');
  const burringResult = computeHoleExtrusionCost({
    extrudedFlangeCount, batchSize,
    rate: holeFormingRate,
    processIdentity: input.processIdentityByMachineClass?.[holeFormingRate.machineClass],
    cycleTimeSecFromCalculator: input.burringCycleTimeSecFromCalculator,
    operationSetupMin: input.opSetupMinByOp?.burring ?? null,
    fallbackSetupMin: BURRING_SETUP_MIN,
    calculatorId: input.burringCalculatorId,
    calculatorVersion: input.burringCalculatorVersion,
    physicsGap: input.burringPhysicsGap,
    confidence: input.burringConfidence,
    ...ctx,
  });
  warnings.push(...burringResult.warnings);
  preForm.push(...burringResult.processLines);

  // ── Tapping ───────────────────────────────────────────────────────────────
  const tappingRate = input.mhrRates?.tapping ?? noRate('tapping');
  const tappingResult = computeTappingCost({
    threadCount: input.threads.length, batchSize,
    rate: tappingRate,
    processIdentity: input.processIdentityByMachineClass?.[tappingRate.machineClass],
    cycleTimeSecFromCalculator: input.tappingCycleTimeSecFromCalculator,
    operationSetupMin: input.opSetupMinByOp?.tapping ?? null,
    fallbackSetupMin: TAPPING_SETUP_MIN,
    calculatorId: input.tappingCalculatorId,
    calculatorVersion: input.tappingCalculatorVersion,
    physicsGap: input.tappingPhysicsGap,
    confidence: input.tappingConfidence,
    ...ctx,
  });
  warnings.push(...tappingResult.warnings);
  preForm.push(...tappingResult.processLines);

  // ── Deburring ─────────────────────────────────────────────────────────────
  // Has its own real, differentiated 'Deburr' process-group LHR rate
  // (lhr_benchmark_rates), distinct from the generic 'Sheet Metal' rate — that
  // resolution happens upstream and reaches here on `rate`, unchanged.
  const deburrRate = input.mhrRates?.deburring ?? noRate('deburring');
  const deburrResult = computeDeburringCost({
    cutLengthMm: input.cutLengthMm,
    rate: deburrRate,
    processIdentity: input.processIdentityByMachineClass?.[deburrRate.machineClass],
    cycleTimeSecFromCalculator: input.deburrCycleTimeSecFromCalculator,
    calculatorId: input.deburrCalculatorId,
    calculatorVersion: input.deburrCalculatorVersion,
    physicsGap: input.deburrPhysicsGap,
    confidence: input.deburrConfidence,
    ...ctx,
  });
  warnings.push(...deburrResult.warnings);
  postForm.push(...deburrResult.processLines);

  // ── Counterboring — only when the extractor found a counterbore hole ───────
  const drillPressRate = input.mhrRates?.drillPress ?? noRate('drill_press');
  const counterboreCount = input.counterboreCount ?? 0;
  if (counterboreCount > 0 && input.opSetupMinByOp?.counterbore == null) {
    warnings.push(`Counterboring setup time not on file — generic default applied (${COUNTERBORE_SETUP_MIN} min)`);
  }
  const counterboreResult = computeCounterboringCost({
    counterboreCount, batchSize,
    rate: drillPressRate,
    processIdentity: input.processIdentityByMachineClass?.[drillPressRate.machineClass],
    cycleTimeSecFromCalculator: input.counterboreCycleTimeSecFromCalculator,
    operationSetupMin: input.opSetupMinByOp?.counterbore ?? null,
    fallbackSetupMin: COUNTERBORE_SETUP_MIN,
    calculatorId: input.counterboreCalculatorId,
    calculatorVersion: input.counterboreCalculatorVersion,
    physicsGap: input.counterborePhysicsGap,
    confidence: input.counterboreConfidence,
    ...ctx,
  });
  warnings.push(...counterboreResult.warnings);
  postForm.push(...counterboreResult.processLines);

  // ── Countersinking ────────────────────────────────────────────────────────
  const countersinkCount = input.countersinkCount ?? 0;
  if (countersinkCount > 0 && input.opSetupMinByOp?.countersink == null) {
    warnings.push(`Countersinking setup time not on file — generic default applied (${COUNTERSINK_SETUP_MIN} min)`);
  }
  const countersinkResult = computeCountersinkingCost({
    countersinkCount, batchSize,
    rate: drillPressRate,
    processIdentity: input.processIdentityByMachineClass?.[drillPressRate.machineClass],
    cycleTimeSecFromCalculator: input.countersinkCycleTimeSecFromCalculator,
    operationSetupMin: input.opSetupMinByOp?.countersink ?? null,
    fallbackSetupMin: COUNTERSINK_SETUP_MIN,
    calculatorId: input.countersinkCalculatorId,
    calculatorVersion: input.countersinkCalculatorVersion,
    physicsGap: input.countersinkPhysicsGap,
    confidence: input.countersinkConfidence,
    ...ctx,
  });
  warnings.push(...countersinkResult.warnings);
  postForm.push(...countersinkResult.processLines);

  // ── PEM Insertion ─────────────────────────────────────────────────────────
  // Gated on a real recognition result: the caller matched hole diameter +
  // sheet thickness against sm_lookup_pem_hardware. A diameter with no hardware
  // match is simply not a PEM hole — never a reported gap.
  const pemCount = input.pemCount ?? 0;
  if (pemCount > 0 && input.opSetupMinByOp?.pem_insertion == null) {
    warnings.push(`PEM insertion setup time not on file — generic default applied (${PEM_INSERTION_SETUP_MIN} min)`);
  }
  const pemRate = input.mhrRates?.pemPress ?? noRate('pem_press');
  const pemResult = computePemInsertionCost({
    pemCount, batchSize,
    rate: pemRate,
    processIdentity: input.processIdentityByMachineClass?.[pemRate.machineClass],
    cycleTimeSecFromCalculator: input.pemCycleTimeSecFromCalculator,
    operationSetupMin: input.opSetupMinByOp?.pem_insertion ?? null,
    fallbackSetupMin: PEM_INSERTION_SETUP_MIN,
    calculatorId: input.pemCalculatorId,
    calculatorVersion: input.pemCalculatorVersion,
    physicsGap: input.pemPhysicsGap,
    confidence: input.pemConfidence,
    ...ctx,
  });
  warnings.push(...pemResult.warnings);
  postForm.push(...pemResult.processLines);

  // ── Drill + Ream + CMM Inspection (tight-tolerance holes) ─────────────────
  // Additive: the cutting process still pierces every hole; reaming brings a
  // pierced hole to final tolerance when the drawing's tightest callout cannot
  // be held by piercing alone.
  const tightTolerance = input.tightestToleranceMm ?? null;
  const allHoleCount = input.holeCount ?? 0;
  const reamTriggered = tightTolerance != null && tightTolerance > 0
    && tightTolerance < TIGHT_TOLERANCE_REAM_THRESHOLD_MM && allHoleCount > 0;
  if (reamTriggered && input.opSetupMinByOp?.ream == null) {
    warnings.push(`Reaming setup time not on file — generic default applied (${REAM_SETUP_MIN} min)`);
  }
  const reamResult = computeReamingCost({
    reamHoleCount: reamTriggered ? allHoleCount : 0,
    tightestToleranceMm: tightTolerance,
    batchSize,
    rate: drillPressRate,
    processIdentity: input.processIdentityByMachineClass?.[drillPressRate.machineClass],
    cycleTimeSecFromCalculator: input.reamCycleTimeSecFromCalculator,
    operationSetupMin: input.opSetupMinByOp?.ream ?? null,
    fallbackSetupMin: REAM_SETUP_MIN,
    calculatorId: input.reamCalculatorId,
    calculatorVersion: input.reamCalculatorVersion,
    physicsGap: input.reamPhysicsGap,
    confidence: input.reamConfidence,
    ...ctx,
  });
  warnings.push(...reamResult.warnings);
  postForm.push(...reamResult.processLines);

  // ── Inspection (general-purpose, tiered) ──────────────────────────────────
  // Fully resolved by the caller before this runs — consumed, never recomputed.
  if (input.inspectionResult) {
    postForm.push(...input.inspectionResult.processLines);
    warnings.push(...input.inspectionResult.warnings);
  }

  // ── Surface treatment ─────────────────────────────────────────────────────
  const stLine = computeSurfaceTreatmentLine(
    input.surfaceTreatment ?? null,
    input.surfaceAreaMm2 ?? 0,
    batchSize,
    input.location ?? '__default__',
    warnings,
    input.surfaceTreatmentDbRate,
  );
  if (stLine) postForm.push(stLine);

  return {
    preForm,
    postForm,
    warnings,
    cycleMinutes: {
      tappingMin: tappingResult.cycleTimeMin,
      deburrMin: deburrResult.cycleTimeMin,
    },
  };
}

/**
 * The final operation sequence for a route: its own core operations with the
 * feature-driven operations placed around them.
 *
 * `coreCutting` is the route's cutting or forming process. `coreForming` is the
 * separate Press Brake step, which a cutting route needs and a forming route
 * does not (that press or roll bends in-process — see
 * shouldAddSeparatePressBrakeLine). Passing an empty array is how a forming
 * route expresses that, so this function never has to know which is which.
 *
 * Every consumer — route comparison, the applied route, the Cost Guide and the
 * Workflow Builder — must obtain its sequence from here rather than assembling
 * one of its own.
 */
export function composeOperationSequence(args: {
  coreCutting: readonly ProcessLineCost[];
  coreForming: readonly ProcessLineCost[];
  featureDriven: FeatureDrivenOperations;
}): ProcessLineCost[] {
  const { coreCutting, coreForming, featureDriven } = args;
  return [
    ...coreCutting,
    ...featureDriven.preForm,
    ...coreForming,
    ...featureDriven.postForm,
  ];
}
