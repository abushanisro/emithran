// Injection-molded plastic parts — cost engine.
//
// Consumes the routed process tree from routing-engine.ts and prices exactly
// the operations the route selected — the tree decides WHAT happens, this file
// decides what each step COSTS. Same layering as sheet metal and CNC: route
// first, cost the route. Mirrors cost-machining-engine.ts's conventions (makeLine
// process lines, r2/r3 rounding, CostSummaryDto output) so this family costs
// like every other one from the API consumer's point of view.
//
// Real inputs only (see cycle-time.ts, clamp-force.ts, shot-size.ts):
//   Cycle    → material reference thermal data + the press's injection rate and
//              dry cycle + staged reference factors
//   Press    → reference clamp force and GPPS-equivalent shot, checked against
//              the selected press for the reference defaultNumCavities
//   Gate     → the part's gate signal, else the reference default runner system
// Anything missing marks the molding line incomplete (physicsGap) with the reason.
//
// The gate feeds the gate_trimming routing rule: hot_tip and sub gates
// self-de-gate, so gate_trimming is not routed for those gate types.

import { RATES_SOURCE_LABEL } from '../../shared/core/default-rates.constants';
import type { MHRRateInput } from '../../shared/core/cost-engine';
import { computeSustainability } from '../../shared/core/cost-engine';
import type {
  CostSummaryDto,
  ProcessLineCost,
  InjectionMoldingBreakdown,
  ToolingCostDto,
} from '../../../dto/cost-breakdown.dto';
import type { IMProcessTree, MoldingSubtype } from './process-tree';
import { isSiliconeGrade } from './process-tree';
import type { InjectionMoldingSignals } from './routing-engine';
import { computeMoldToolingCost } from './mold-tooling-engine';
import type { MoldClass, PlasticReference } from '../plastic-reference';
import { requiredClampForce, type ClampForceResult, type MaterialClampProperties, type RunnerSystem } from '../clamp-force';
import { shotGppsGramsPerCavity, shotWeightKgPerPart } from '../shot-size';
import { buildInjectionMoldingRoute } from './routing-engine';
import {
  computeCycleTime,
  type CycleTimeResult,
  type GateType,
  type PressTiming,
  type RealResinInputs,
} from './cycle-time';

function r2(n: number): number { return Math.round(n * 100) / 100; }
function r3(n: number): number { return Math.round(n * 1000) / 1000; }

// ── Constants not replaced by Phase 4 cycle-time engine ───────────────────────

// Runner allowance and shot rule: shot-size.ts (shared with press selection).
export { IM_RUNNER_SCRAP_PCT } from '../shot-size';

// ── Removed, uncited constants (2026-09-11) ───────────────────────────────────
// This block used to hold 16 named-literal time constants (mold setup 60min,
// material drying 15min, gate trim 5s/10cm², deflash 20s, side-action
// 2.5s/undercut, insert install/load/inspect, ultrasonic weld 12s/joint, core
// unscrewing 4s, LSR dosing/secondary-cure-oven, visual/dimensional/weight-
// check inspection) with zero source anywhere in the reference data — checked
// against every file under memory/plastic modeling/ (variables, lookup,
// process): no drying/setup/inspection/handling time exists for this domain
// there (toolDryingTime is TOOL cleaning, an unrelated real variable; the
// cm* setup-time variables are Compression Molding heater-line machining
// only). Root-caused and removed per explicit user direction (2026-09-11):
// a real, sourced $0 (operation genuinely not costed, disclosed below) is
// correct; a plausible-looking $0.24 built on an invented 60-minute mold-
// setup guess is not — it looked "database driven" (real rate × time) while
// the time itself was never measured. The operations below are still
// ROUTED (routing-engine.ts's real geometry rules — hygroscopic resin needs
// drying, N undercuts need side action, etc. — are real signals, unchanged)
// but no longer COSTED: each routed-but-uncosted operation below emits a
// disclosure warning instead of a process line, so a real, still-needed
// operation is flagged as a genuine gap rather than silently priced from a
// guess or silently dropped with no trace at all.
const UNCOSTED_OPERATION_LABELS: Record<string, string> = {
  mold_setup: 'Mold Setup (mounting + trial shots)',
  material_drying: 'Material Drying',
  gate_trimming: 'Gate Trimming',
  deflashing: 'Deflashing',
  side_action: 'Side Action (Slide/Lifter)',
  core_unscrewing: 'Core Unscrewing',
  insert_loading: 'Insert Loading (In-Mold)',
  insert_inspection: 'Insert Pull Test',
  insert_installation: 'Insert Installation',
  lsr_compound_dosing: 'LSR Compound Dosing',
  secondary_cure_oven: 'Secondary Cure Oven',
  ultrasonic_welding: 'Ultrasonic Welding',
  visual_inspection: 'Visual Inspection',
  dimensional_inspection: 'Dimensional Inspection (First Article)',
  weight_check: 'Weight Check',
};

function uncostedOpWarning(label: string, detail?: string): string {
  return `⚠ ${label} required${detail ? ` (${detail})` : ''} — not costed: no sourced time/rate ` +
    'data exists for this operation yet; excluded from Direct Process Costs rather than estimated.';
}

// Hot-tip and sub gates self-de-gate; no vestige trimming needed.
const SELF_DEGATE_TYPES: ReadonlySet<GateType> = new Set(['hot_tip', 'sub']);

// ── SPI mold classification ────────────────────────────────────────────────────
// Source: SPI (Society of the Plastics Industry) mold classification standard.
// Class 101 = highest precision/life, Class 105 = prototype only.
//
// Class cycle ratings come from the staged tblSpiType table
// (PlasticReference.spiClasses, plastic-reference.ts), never from a copy
// here. The column is labelled "Num Annual Mold Cycles", but its values are
// LIFETIME cycles and are compared against lifetime shots: classes 101-104
// equal the SPI AR-106 lifetime bounds exactly (>1M, 1M, 500k, 100k), and
// every other mold-life figure in the same dataset is shots per tool
// (tblToolLife, variables defaultToolLife).
// Mold cost is computed from the itemized mold-tooling BOM
// (mold-tooling-engine.ts); mold class drives only the life-rating check.

export type { MoldClass } from '../plastic-reference';

export function recommendMoldClass(
  lifetimeShots: number,
  spiClasses: PlasticReference['spiClasses'],
  partingComplexity: number | null,
  undercutCount: number | null,
): { moldClass: MoldClass; cycleRating: number } {
  // spiClasses is ordered cheapest (lowest rating) first; the last is the most durable.
  const needsBump = (partingComplexity ?? 0) > 0.6 || (undercutCount ?? 0) > 2;
  let idx = spiClasses.findIndex((c) => c.cycleRating >= lifetimeShots);
  if (idx < 0) idx = spiClasses.length - 1;
  // Bump one tier toward more durable (complex tooling wears faster).
  if (needsBump) idx = Math.min(spiClasses.length - 1, idx + 1);
  return spiClasses[idx]!;
}

// ── Cavity count ──────────────────────────────────────────────────────────────
// Cavities per mold: the user's count (Cost Guide, scenario override
// cavityCount) when it is a reference mold layout (layoutNumCav), else the
// reference defaultNumCavities ("user may override via Process Setup
// Options"). A count with no reference layout is reported, never replaced. It
// is never derived from a volume rule of thumb. The press must hold that many
// cavities closed (reference clamp force) and fill them (GPPS-equivalent shot);
// if it cannot, the molding line is marked incomplete with the reason.

// ── Cost confidence ────────────────────────────────────────────────────────────

function computeCostConfidence(
  signals: Partial<InjectionMoldingSignals>,
  hasSelectedMachine: boolean,
  cavityConstrainedBy: InjectionMoldingBreakdown['cavityConstrainedBy'],
): number {
  let confidence = 1.0;
  if (signals.undercutCount == null)          confidence -= 0.15;
  if (signals.gateType == null)               confidence -= 0.10;
  if ((signals.wallThicknessNominalMm ?? 0) <= 0) confidence -= 0.20;
  if (!hasSelectedMachine)                    confidence -= 0.15;
  if (signals.partingComplexity == null)      confidence -= 0.10;
  if (cavityConstrainedBy === 'shot_capacity') confidence -= 0.05;
  return Math.max(0.20, Math.round(confidence * 100) / 100);
}

export interface InjectionMoldingCostInput {
  volume: number;               // mm³ — net part volume from CAD (shot basis)
  surfaceArea: number;          // mm² — for trim time
  wallThicknessNominalMm: number; // from InjectionMoldedFeatureExtractor, drives cooling time
  materialGrade: string | null;
  materialCostPerKg: number;
  materialDensityKgM3: number;
  materialSource: 'db' | 'default';
  batchSize: number;
  family: string;
  mhrRate: MHRRateInput;        // selected injection molding machine rate
  deburrRate: MHRRateInput;     // bench/secondary ops reuse the finishing rate
  inspectionRate: MHRRateInput;
  // Routing signals beyond what the fields above cover. Optional so callers
  // without Phase-2 extraction keep working; when absent the router applies
  // conservative defaults and records routingWarnings instead of guessing
  // silently.
  signals?: Partial<InjectionMoldingSignals>;
  // Bounding-box dimensions: the projected-area footprint when CAD has no
  // projected area (press sizing and tooling).
  bboxMaxMm?: number;
  bboxMidMm?: number;
  // Cavities per mold set by the user (Cost Guide); null = reference default.
  cavityCountOverride?: number | null;
  // The selected press's own process data from its HR Rates row
  // (PlasticReferenceService.getPressRecords): injection rate and dry cycle
  // (absent = cycle time not derivable) and its good-part yield (cost per good
  // part = cost / yield; absent = the line is incomplete).
  pressTiming?: PressTiming | null;
  goodPartYield?: number | null;
  // The selected press's real clamp tonnage (t) and shot capacity (g), from its
  // machine record. Absent = no press: cavities are not sized and the molding
  // line is marked incomplete (never a default press).
  machineClampTonnes?: number | null;
  machineShotCapacityG?: number | null;
  // The material's reference clamp properties (raw_materials, migration 831).
  materialClamp?: MaterialClampProperties;
  // Tooling amortization inputs — required for ToolingCostDto.
  // When not provided, tooling cost is omitted from the response (no proxy guesses).
  annualVolume?: number;
  productionLifeYears?: number;
  // Molding subtype — auto-derived from material grade + signals when not supplied.
  moldingSubtype?: MoldingSubtype;
  // Local currency symbol (₹, $, €, …) for warning messages; defaults to '$'.
  currencySymbol?: string;
  // The material's reference thermal properties (resolveMaterialForFamily, the
  // same raw_materials row as cost and density; melt density via migration
  // 831). Every field is required for the cooling model; any missing leaves
  // the cycle not derivable (cycle-time.ts), never a resin-family default.
  realResinInputs?: RealResinInputs | null;
  // Staged Plastic reference data (plastic-reference.ts): SPI classes and the
  // mold-tooling tables. Null = not staged: no tooling result is produced and
  // plasticReferenceMissing names what is absent.
  plasticReference?: PlasticReference | null;
  plasticReferenceMissing?: string[];
  // Quote location: toolroom rates exist in memory/ for USA only.
  location?: string;
  // raw_materials.material_type of the resolved grade (tblToolLife key).
  materialType?: string | null;
}

// Auto-derive molding subtype from material grade + signals.
// Caller can override by setting moldingSubtype explicitly on the input.
function resolveSubtype(input: InjectionMoldingCostInput): MoldingSubtype {
  if (isSiliconeGrade(input.materialGrade)) return 'lsr';
  if (input.moldingSubtype) return input.moldingSubtype;
  if ((input.signals?.insertCount ?? 0) > 0 && !input.moldingSubtype) return 'insert';
  if ((input.signals as any)?.unscrewingCoreCount > 0) return 'unscrewing';
  return 'standard';
}

function makeLine(
  process: string,
  setupCost: number,
  runCost: number,
  cycleTimeMin: number,
  rate: MHRRateInput,
): ProcessLineCost {
  return {
    process,
    setupCost: r2(setupCost),
    runCost: r2(runCost),
    totalCost: r2(setupCost + runCost),
    cycleTimeMin: r2(cycleTimeMin),
    hourlyRate: rate.rate,
    rateSource: rate.source,
    machineClass: rate.machineClass,
    machineName: rate.machineName,
    commodityCode: rate.commodityCode,
  };
}

type EngineResult = CostSummaryDto & { processTree: IMProcessTree };
type CavitySizing = { count: number; constrainedBy: InjectionMoldingBreakdown['cavityConstrainedBy']; unverifiedReason: string | null };

/** The press-sizing facts shared by every cavity candidate. */
function pressSizingBasis(input: InjectionMoldingCostInput) {
  const plasticRef = input.plasticReference ?? null;
  const isLsr = resolveSubtype(input) === 'lsr';
  // One projected-area rule for clamp, cavities and tooling: the CAD projected
  // area, else the bounding-box footprint when both real dimensions exist.
  const projectedAreaMm2 = (input.signals?.projectedAreaMm2 ?? 0) > 0
    ? input.signals!.projectedAreaMm2 as number
    : (input.bboxMaxMm ?? 0) > 0 && (input.bboxMidMm ?? 0) > 0 ? input.bboxMaxMm! * input.bboxMidMm! : null;
  // Gate / runner: the part's own gate signal, else the reference default
  // runner system (defaultRunnerSystem; cold runner = edge gate, the reference
  // defaultGatingType). LSR molds use a self-degating cold deck.
  const callerGate = (input.signals?.gateType ?? null) as GateType | null;
  const gate: GateType | null = isLsr ? 'sub' : callerGate
    ?? (plasticRef ? (plasticRef.cycleModel.defaultRunner === 'hot' ? 'hot_tip' : 'edge') : null);
  const runner: RunnerSystem = gate != null && SELF_DEGATE_TYPES.has(gate) ? 'hot' : 'cold';
  const clampPerCavity: ClampForceResult = !plasticRef
    ? { derivable: false, reason: `Clamp force not derivable: Plastic reference data missing (${(input.plasticReferenceMissing ?? ['not loaded']).join('; ')}).` }
    : requiredClampForce({
        model: plasticRef.clampModel,
        material: input.materialClamp ?? { injectionPressureMaxMpa: null, flowLengthRatio: null, referenceMaterial: null },
        materialLabel: input.materialGrade ?? 'this material',
        projectedAreaMm2: projectedAreaMm2 ?? 0,
        cavityCount: 1,
        runner,
      });
  // Shot per part and its GPPS-equivalent grams (shot-size.ts).
  const netWeightKg = r3((Math.max(input.volume, 0) / 1e9) * input.materialDensityKgM3);
  const shotWeightKg = shotWeightKgPerPart(netWeightKg, runner);
  const meltDensity = input.realResinInputs?.densityOfMeltKgM3 ?? null;
  const shotGppsGPerCavity = shotGppsGramsPerCavity({ shotWeightKg, meltDensityKgM3: meltDensity, reference: plasticRef });
  return { plasticRef, isLsr, projectedAreaMm2, callerGate, gate, runner, clampPerCavity, netWeightKg, shotWeightKg, meltDensity, shotGppsGPerCavity };
}

export function computeInjectionMoldedCostSummary(input: InjectionMoldingCostInput): EngineResult {
  const b = pressSizingBasis(input);
  const clampT = input.machineClampTonnes ?? null;
  const shotG = input.machineShotCapacityG ?? null;
  const ref = b.plasticRef;
  const requested = input.cavityCountOverride ?? null;
  const n = requested ?? ref?.defaultNumCavities ?? 1;
  const unverified = (reason: string) => computeAtCavities(input, { count: n, constrainedBy: 'unverified', unverifiedReason: reason });

  if (requested != null && ref && !ref.cavityLayouts.includes(requested)) {
    return unverified(`${requested} cavities has no reference mold layout (layoutNumCav: ${ref.cavityLayouts.join(', ')}).`);
  }
  if (!b.clampPerCavity.derivable) return unverified(b.clampPerCavity.reason);
  if (clampT == null || shotG == null) return unverified('No press selected with a real clamp tonnage and shot capacity: press fit is not checked.');
  if (b.shotGppsGPerCavity == null) return unverified('Shot size not derivable: the material has no reference melt density (migration 831).');
  if (n * b.clampPerCavity.requiredTonnes > clampT) {
    return unverified(`The selected press (${clampT.toFixed(1)} t) cannot hold ${n} cavit${n === 1 ? 'y' : 'ies'} closed: it needs ${(n * b.clampPerCavity.requiredTonnes).toFixed(1)} t (${b.clampPerCavity.trace}).`);
  }
  if (n * b.shotGppsGPerCavity > shotG) {
    return unverified(`The selected press shot size (${shotG} g GPPS) cannot fill ${n} cavit${n === 1 ? 'y' : 'ies'}: it needs ${(n * b.shotGppsGPerCavity).toFixed(1)} g GPPS-equivalent.`);
  }
  return computeAtCavities(input, { count: n, constrainedBy: requested != null ? 'user' : 'default', unverifiedReason: null });
}

function computeAtCavities(input: InjectionMoldingCostInput, sizing: CavitySizing): EngineResult {
  const {
    volume, wallThicknessNominalMm, materialGrade, materialCostPerKg,
    materialDensityKgM3, materialSource, batchSize, family, mhrRate,
  } = input;
  const b = pressSizingBasis(input);
  const { plasticRef, isLsr, projectedAreaMm2, callerGate, gate, clampPerCavity, netWeightKg, shotWeightKg, shotGppsGPerCavity } = b;
  const cavityCount = sizing.count;
  const cavityConstrainedBy = sizing.constrainedBy;

  const warnings: string[] = [];
  const processLines: ProcessLineCost[] = [];
  const moldingSubtype = resolveSubtype(input);

  if (!materialGrade) warnings.push('Material grade not set');
  if (volume <= 0)    warnings.push('Part volume is zero — shot weight and material cost may be inaccurate');
  if (isLsr) {
    warnings.push('LSR (thermoset) — Arrhenius cure model used; Menges cooling does NOT apply. Mold temperature 180°C (heated).');
  }
  // Engineering plastics are $2–40/kg (commodity to engineering resin).
  // Anything above $50/kg almost certainly indicates a mis-mapped material grade
  // (e.g. a metal or composite grade resolved as the fallback for a plastic name).
  // Surface this early so it is impossible to miss in the cost breakdown.
  if (materialCostPerKg > 50) {
    const alertSym = input.currencySymbol ?? '$';
    warnings.push(
      `MATERIAL COST ALERT: ${materialGrade ?? 'Unknown'} resolved to ${alertSym}${materialCostPerKg.toFixed(2)}/kg — ` +
      `engineering plastics are typically $2–40/kg (USD benchmark). ` +
      `Verify the material grade in the BOM item; the cost breakdown below is unreliable until corrected.`,
    );
  }
  if (sizing.unverifiedReason) warnings.push(sizing.unverifiedReason);
  if (gate != null && callerGate == null && !isLsr) {
    warnings.push(`Gate: ${gate} (reference defaultRunnerSystem ${plasticRef!.cycleModel.defaultRunner} runner; no gate signal on the part)`);
  }

  // ── Cycle time: material, press and reference only (cycle-time.ts) ──────────
  const cycle: CycleTimeResult = plasticRef
    ? computeCycleTime({
        wallMm: wallThicknessNominalMm > 0 ? wallThicknessNominalMm : null,
        isLsr,
        real: input.realResinInputs,
        model: plasticRef.cycleModel,
        press: input.pressTiming ?? null,
        shotMeltVolumeMm3: b.meltDensity && b.meltDensity > 0 ? (shotWeightKg * cavityCount / b.meltDensity) * 1e9 : null,
        cavityCount,
        // No per-part gate-count signal: the reference defaultNumberOfGatesPerCavity.
        gatesPerCavity: plasticRef.defaultGatesPerCavity,
      })
    : { derivable: false, missing: [`Plastic reference data (${(input.plasticReferenceMissing ?? ['not loaded']).join('; ')})`] };
  const cycleGapReason = cycle.derivable ? null : `Cycle time not derivable: missing ${cycle.missing.join('; ')}.`;
  if (cycleGapReason) warnings.push(cycleGapReason);

  // ── Route the part ─────────────────────────────────────────────────────────
  const signals: InjectionMoldingSignals = {
    materialGrade,
    projectedAreaMm2: input.signals?.projectedAreaMm2 ?? null,
    partVolumeMm3: volume > 0 ? volume : null,
    partMassKg: netWeightKg > 0 ? netWeightKg : null,
    wallThicknessNominalMm: wallThicknessNominalMm > 0 ? wallThicknessNominalMm : null,
    wallThicknessMinMm: input.signals?.wallThicknessMinMm ?? null,
    wallThicknessMaxMm: input.signals?.wallThicknessMaxMm ?? null,
    ribCount: input.signals?.ribCount ?? null,
    bossCount: input.signals?.bossCount ?? null,
    undercutCount: input.signals?.undercutCount ?? null,
    insertCount: input.signals?.insertCount ?? null,
    textFeatureCount: input.signals?.textFeatureCount ?? null,
    assemblyFeatureCount: input.signals?.assemblyFeatureCount ?? null,
    gateType: gate,
    partingComplexity: input.signals?.partingComplexity ?? null,
    unscrewingCoreCount: (input.signals as any)?.unscrewingCoreCount ?? null,
    overmoldSubstrate: (input.signals as any)?.overmoldSubstrate ?? null,
  };
  const processTree = buildInjectionMoldingRoute(signals, moldingSubtype);
  warnings.push(...processTree.routingWarnings);
  const routed = new Set<string>(processTree.operations.map((o) => o.id));

  // ── Good-part yield of the press: every good part carries the scrapped shots ──
  const yieldFrac = input.goodPartYield != null && input.goodPartYield > 0 && input.goodPartYield <= 1 ? input.goodPartYield : null;
  const yieldGapReason = input.machineClampTonnes != null && yieldFrac == null
    ? 'The selected press has no good-part yield on its HR Rates record (good_part_yield): cost per good part is not derivable.'
    : null;
  if (yieldGapReason) warnings.push(yieldGapReason);
  const perGood = yieldFrac ?? 1;

  // ── Material: shot weight = part + runner/sprue allowance, per good part ────
  const materialCost = r2((shotWeightKg * materialCostPerKg) / perGood);

  // ── Cost every routed operation, in route order ─────────────────────────────
  let setupMin = 0;      // batch-amortized station time (drying + mold setup)
  let moldingMin = 0;    // in-cycle machine time per part
  const secondaryMin = 0;  // bench ops per part
  const inspectionMin = 0;

  if (routed.has('lsr_compound_dosing')) {
    warnings.push(uncostedOpWarning(UNCOSTED_OPERATION_LABELS.lsr_compound_dosing, 'LSR two-component A+B metering'));
  }
  if (routed.has('material_drying')) {
    warnings.push(uncostedOpWarning(
      UNCOSTED_OPERATION_LABELS.material_drying,
      materialGrade ? `${materialGrade} is hygroscopic` : undefined,
    ));
  }
  if (routed.has('mold_setup')) {
    warnings.push(uncostedOpWarning(UNCOSTED_OPERATION_LABELS.mold_setup));
  }

  // One molding process line (the catalog's own process, not one row per
  // internal phase — see stored-process-lines.ts's machine_class match). Its
  // time is the whole cycle over the cavities; a gap names what is missing.
  const MOLDING_PROCESS_LABEL: Record<string, string> = {
    injection_molding: 'Injection Molding',
    structural_foam_molding: 'Structural Foam Molding',
  };
  const processLabel = MOLDING_PROCESS_LABEL[mhrRate.machineClass] ?? 'Injection Molding';
  const inCycleMin = cycle.derivable ? (cycle.totalCycleSec / cavityCount / perGood) / 60 : 0;
  moldingMin += inCycleMin;
  const line = makeLine(processLabel, 0, r2((inCycleMin / 60) * mhrRate.rate), inCycleMin, mhrRate);
  const gapReason = sizing.unverifiedReason ?? cycleGapReason ?? yieldGapReason;
  if (gapReason) {
    line.physicsGap = {
      gapType: 'unsupported_operation', process: processLabel, machineClass: mhrRate.machineClass,
      reason: gapReason,
      requiredCapability: sizing.unverifiedReason ? 'Press sizing (reference clamp force + a real press)' : cycleGapReason ? 'Cycle time (material thermal data + press timing)' : 'Press good-part yield',
    };
  }
  if (cycle.derivable) line.calculationTrace = cycle.trace;
  processLines.push(line);

  if (routed.has('gate_trimming')) warnings.push(uncostedOpWarning(UNCOSTED_OPERATION_LABELS.gate_trimming));
  if (routed.has('deflashing')) warnings.push(uncostedOpWarning(UNCOSTED_OPERATION_LABELS.deflashing));
  if (routed.has('side_action')) {
    warnings.push(uncostedOpWarning(
      UNCOSTED_OPERATION_LABELS.side_action,
      `${signals.undercutCount ?? '?'} undercut feature(s) — slide/lifter tooling required`,
    ));
  }
  if (routed.has('core_unscrewing')) {
    warnings.push(uncostedOpWarning(
      UNCOSTED_OPERATION_LABELS.core_unscrewing,
      `${(signals as any).unscrewingCoreCount ?? '?'} unscrewing core(s) — hydraulic/servo rotation required`,
    ));
  }
  if (routed.has('insert_loading')) {
    warnings.push(uncostedOpWarning(UNCOSTED_OPERATION_LABELS.insert_loading, `${signals.insertCount ?? '?'} insert(s)`));
  }
  if (routed.has('insert_inspection')) warnings.push(uncostedOpWarning(UNCOSTED_OPERATION_LABELS.insert_inspection));
  if (routed.has('insert_installation')) {
    warnings.push(uncostedOpWarning(UNCOSTED_OPERATION_LABELS.insert_installation, `${signals.insertCount ?? '?'} insert candidate(s)`));
  }
  if (routed.has('secondary_cure_oven')) warnings.push(uncostedOpWarning(UNCOSTED_OPERATION_LABELS.secondary_cure_oven));
  if (routed.has('ultrasonic_welding')) {
    warnings.push(uncostedOpWarning(UNCOSTED_OPERATION_LABELS.ultrasonic_welding, `${signals.assemblyFeatureCount ?? '?'} assembly/weld feature(s)`));
  }
  if (routed.has('visual_inspection')) warnings.push(uncostedOpWarning(UNCOSTED_OPERATION_LABELS.visual_inspection));
  if (routed.has('dimensional_inspection')) warnings.push(uncostedOpWarning(UNCOSTED_OPERATION_LABELS.dimensional_inspection));
  if (routed.has('weight_check')) warnings.push(uncostedOpWarning(UNCOSTED_OPERATION_LABELS.weight_check));

  // ── Totals ──────────────────────────────────────────────────────────────────
  const totalProcessCost = r2(processLines.reduce((s, l) => s + l.totalCost, 0));
  const totalCost        = r2(materialCost + totalProcessCost);
  const totalMin         = r2(processLines.reduce((s, l) => s + l.cycleTimeMin, 0));

  const sustainability = computeSustainability(
    materialGrade, materialCostPerKg, netWeightKg, shotWeightKg, batchSize, processLines,
  );

  // ── Runner ─────────────────────────────────────────────────────────────────
  const runnerScrapKg = r3(Math.max(0, shotWeightKg - netWeightKg) * cavityCount);
  const runnerSystemType: 'hot' | 'cold' = b.runner;

  // ── Cost confidence ───────────────────────────────────────────────────────
  const hasSelectedMachine = mhrRate.source === 'mhr_database';
  const confidence = computeCostConfidence(
    { ...signals, wallThicknessNominalMm: wallThicknessNominalMm > 0 ? wallThicknessNominalMm : 0 },
    hasSelectedMachine,
    cavityConstrainedBy,
  );

  const clampRequiredT = clampPerCavity.derivable ? clampPerCavity.requiredTonnes * cavityCount : null;
  const shotRequiredG = shotGppsGPerCavity != null ? shotGppsGPerCavity * cavityCount : null;
  const machineClampTonnes = input.machineClampTonnes ?? null;
  const machineShotG = input.machineShotCapacityG ?? null;
  const pct = (req: number | null, cap: number | null) => (req != null && cap != null && cap > 0 ? Math.round((req / cap) * 1000) / 10 : null);
  const imBreakdown: InjectionMoldingBreakdown = {
    moldingSubtype,
    cavityCount,
    cavityConstrainedBy,
    cavityLayouts: plasticRef?.cavityLayouts ?? [],
    defaultCavityCount: plasticRef?.defaultNumCavities ?? null,
    runnerSystemType,
    runnerScrapKg,
    gateType: gate ?? 'unknown',
    undercutCount: signals.undercutCount ?? null,
    partingComplexity: signals.partingComplexity ?? null,
    cycleTimeSec: cycle.derivable ? r2(cycle.totalCycleSec) : 0,
    cavityCycleTimeSec: cycle.derivable ? r2(cycle.totalCycleSec / cavityCount) : 0,
    costConfidence: confidence,
    projectedAreaCm2: projectedAreaMm2 != null ? Math.round(projectedAreaMm2 / 10) / 10 : null,
    flowClass: clampPerCavity.derivable ? clampPerCavity.flowClass : null,
    cavityPressureMpa: clampPerCavity.derivable ? r2(clampPerCavity.cavityPressureMpa) : null,
    clampTrace: clampPerCavity.derivable ? clampPerCavity.trace : clampPerCavity.reason,
    clampRequiredT: clampRequiredT != null ? Math.round(clampRequiredT * 10) / 10 : null,
    clampMachineT: machineClampTonnes,
    clampUtilPct: pct(clampRequiredT, machineClampTonnes),
    shotRequiredG: shotRequiredG != null ? Math.round(shotRequiredG * 10) / 10 : null,
    shotMachineG: machineShotG,
    shotUtilPct: pct(shotRequiredG, machineShotG),
  };

  // ── Tooling cost (separate from piece cost, omitted when inputs absent) ────
  let toolingResult: ToolingCostDto | undefined;
  const annualVol = input.annualVolume;
  const prodLife = input.productionLifeYears;
  if (annualVol != null && prodLife != null && annualVol > 0 && prodLife > 0 && !plasticRef) {
    warnings.push(`Tooling cost not computed: Plastic reference data missing (${(input.plasticReferenceMissing ?? ['not loaded']).join('; ')}).`);
  }
  if (annualVol != null && prodLife != null && annualVol > 0 && prodLife > 0 && plasticRef) {
    const annualShotsPerCavity = annualVol / cavityCount;
    const lifetimeShots = annualShotsPerCavity * prodLife;
    // Unscrewing cores add mold complexity beyond parting line — treat as additional undercut bump.
    const effectiveUndercutCount = (signals.undercutCount ?? 0) + ((signals as any).unscrewingCoreCount ?? 0);
    const mold = recommendMoldClass(lifetimeShots, plasticRef.spiClasses, signals.partingComplexity ?? null, effectiveUndercutCount);

    // Required mold-window area: the press-sizing projected area x cavities.
    const moldBaseAreaMm2 = Math.max(0, projectedAreaMm2 ?? 0) * cavityCount;
    const moldTooling = computeMoldToolingCost({
      moldBaseAreaMm2,
      cavityCount,
      undercutCount: effectiveUndercutCount,
      tables: plasticRef.tooling,
      toolroomRates: input.location === 'USA' ? plasticRef.toolroomRatesUsa : null,
      location: input.location ?? '(unknown location)',
    });
    // Molds the job wears out: tblToolLife shots per tool for the material type,
    // the reference default (its median) for a type with no row.
    const lifeRow = plasticRef.toolLifeShotsByType.find((t) => t.materialType === input.materialType);
    const toolLifeShots = lifeRow?.shots ?? plasticRef.defaultToolLifeShots;
    if (!lifeRow) {
      warnings.push(`No tblToolLife row for material type ${input.materialType ?? '(unknown)'}: mold life uses the reference default ${plasticRef.defaultToolLifeShots.toLocaleString()} shots.`);
    }
    const moldsRequired = Math.max(1, Math.ceil(lifetimeShots / toolLifeShots));
    const moldCostUsd = r2((moldTooling.bomSubtotalUsd + (moldTooling.labourCostUsd ?? 0)) * moldsRequired);
    const moldCostPerPartUsd = r2(moldCostUsd / (annualVol * prodLife));
    toolingResult = {
      moldClass: mold.moldClass,
      moldLifeShotRating: mold.cycleRating,
      moldCostUsd,
      moldCostPerPartUsd,
      annualVolume: annualVol,
      productionLifeYears: prodLife,
      moldBomSubtotalUsd: moldTooling.bomSubtotalUsd,
      moldMissingComponents: moldTooling.missingComponents,
      moldEstimatedDesignHrs: moldTooling.estimatedDesignHrs,
      moldEstimatedMachiningHrs: moldTooling.estimatedMachiningHrs,
      moldEstimatedAssemblyHrs: moldTooling.estimatedAssemblyHrs,
      moldEstimatedAssemblyOperators: moldTooling.estimatedAssemblyOperators,
      moldLabourCostUsd: moldTooling.labourCostUsd == null ? null : r2(moldTooling.labourCostUsd),
      moldToolLifeShots: toolLifeShots,
      moldsRequired,
    };
    warnings.push(...moldTooling.warnings);
    if (moldCostPerPartUsd > materialCostPerKg * netWeightKg * 2) {
      warnings.push(
        `Tooling-dominated: mold cost $${moldCostUsd.toFixed(0)} amortizes to $${moldCostPerPartUsd.toFixed(3)}/part — ` +
        `consider higher volumes or shared tooling (indicative tooling cost only)`,
      );
    }
  }

  return {
    materialCost,
    materialGrade: materialGrade ?? 'Unknown',
    grossWeightKg: shotWeightKg,
    materialCostPerKg,
    materialSource,
    processLines,
    totalProcessCost,
    totalCost,
    cycleTimes: {
      laserMin:      r2(moldingMin),                   // in-cycle molding time
      pressBrakeMin: r2(setupMin),                     // batch-amortized setup time
      tappingMin:    0,                                // unused for this family
      deburrMin:     r2(secondaryMin + inspectionMin), // secondary + inspection
      totalMin,
    },
    batchSize,
    family,
    warnings,
    ratesSource: RATES_SOURCE_LABEL,
    sustainability,
    processTree,
    injectionMolding: imBreakdown,
    ...(toolingResult ? { tooling: toolingResult } : {}),
  };
}
