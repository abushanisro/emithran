// Injection-molded plastic parts — cost engine.
//
// Consumes the routed process tree from routing-engine.ts and prices exactly
// the operations the route selected — the tree decides WHAT happens, this file
// decides what each step COSTS. Same layering as sheet metal and CNC: route
// first, cost the route. Mirrors cost-cnc-engine.ts's conventions (makeLine
// process lines, r2/r3 rounding, CostSummaryDto output) so this family costs
// like every other one from the API consumer's point of view.
//
// Phase 4 cycle-time engine replaces Phase 1 named-constant approximations:
//   Cooling  → Menges thermal formula (material-specific α, Tm, Tw, Te)
//   Fill     → flow-length model (L_flow / v_front, material-specific)
//   Pack     → gate-freeze proxy (0.35 × t_cool, scales with material and wall)
//   Gate     → auto-recommended from geometry + material when caller has no signal
//
// The gate recommendation feeds the gate_trimming routing rule: hot_tip and sub
// gates self-de-gate, so gate_trimming is not routed for those gate types.

import { RATES_SOURCE_LABEL } from './default-rates';
import type { MHRRateInput } from './cost-engine';
import { computeSustainability } from './cost-engine';
import type {
  CostSummaryDto,
  ProcessLineCost,
  InjectionMoldingBreakdown,
  ToolingCostDto,
} from '../dto/cost-breakdown.dto';
import type { IMProcessTree, MoldingSubtype } from './injection-molding/process-tree';
import { isSiliconeGrade } from './injection-molding/process-tree';
import type { InjectionMoldingSignals } from './injection-molding/routing-engine';
import { buildInjectionMoldingRoute } from './injection-molding/routing-engine';
import {
  computeCycleTime,
  computeLsrCureTime,
  lookupResinProps,
  type GateType,
} from './injection-molding/cycle-time';

function r2(n: number): number { return Math.round(n * 100) / 100; }
function r3(n: number): number { return Math.round(n * 1000) / 1000; }

// ── Constants not replaced by Phase 4 cycle-time engine ───────────────────────
// These govern operations outside the molding cycle and are not material-
// or geometry-dependent in a way that warrants a physics model at this fidelity.

const IM_SETUP_MIN = 60;               // mold mounting + trial shots, amortized per batch
const IM_DEFAULT_WALL_MM = 2.0;        // Menges cooling fallback when wall not measured

// Material drying — hygroscopic resins. Dryer runs unattended; only the
// attended load/unload labour is costed, amortized per batch.
const IM_DRYING_ATTENDED_MIN = 15;

// Secondary
const IM_TRIM_SEC_PER_10CM2 = 5;       // gate/runner trim scaled by surface area
const IM_TRIM_MIN_SEC = 3;             // every cold gate leaves at least a vestige
const IM_DEFLASH_SEC = 20;             // manual flash removal, per part
// Phase 3: side action (slide/lifter).
// 2.5 s/undercut: 0.5 s hydraulic/spring actuation + 2 s mold-open travel delay.
const IM_SIDE_ACTION_SEC_PER_UNDERCUT = 2.5;
const IM_INSERT_SEC_PER_INSERT = 8;    // post-mold press/heat-stake (legacy)
const IM_INSERT_LOADING_SEC_PER_INSERT = 20; // in-mold placement per insert (manual)
const IM_INSERT_INSPECTION_SEC = 15;   // pull test / torque check (sampled, per part amortized)
const IM_WELD_SEC_PER_JOINT = 12;      // ultrasonic weld cycle per joint
const IM_UNSCREWING_CORE_SEC = 4;      // hydraulic rack-and-pinion per core per shot

// LSR — compound dosing and secondary cure oven
const IM_LSR_DOSING_ATTENDED_MIN = 10; // metering head setup + purge, per batch (attended)
const IM_LSR_DOSING_RUN_SEC = 90;      // per-part: connect + dose A+B before each shot
// Secondary cure oven: 4h oven at 200°C, amortized. Oven MHR ≈ deburrRate proxy
// (low-capital oven, operator checks batch).  4h oven total = 240 min / batch.
const IM_LSR_SECONDARY_CURE_OVEN_MIN = 240; // oven time per batch

// Inspection
const IM_VISUAL_SEC = 10;
const IM_DIMENSIONAL_MIN = 5;
const IM_WEIGHT_CHECK_SEC = 5;

// Material — exported: machine selection uses the same runner allowance to
// compute shot weight (one number, not two drifting copies).
export const IM_RUNNER_SCRAP_PCT = 8;  // runner/sprue material lost per shot (cold runner)

// Hot-tip and sub gates self-de-gate; no vestige trimming needed.
const SELF_DEGATE_TYPES: ReadonlySet<GateType> = new Set(['hot_tip', 'sub']);

// ── SPI mold classification ────────────────────────────────────────────────────
// Source: SPI (Society of the Plastics Industry) mold classification standard.
// Class 101 = highest precision/life, Class 105 = prototype only.

export type MoldClass = 'Class101' | 'Class102' | 'Class103' | 'Class104' | 'Class105';

interface MoldClassSpec {
  lifeShotRating: number; // shots the mold is rated for
  baseCostUsd: number;    // single-cavity base cost (USD)
}

const SPI_MOLD_CLASSES: Record<MoldClass, MoldClassSpec> = {
  Class101: { lifeShotRating: 1_000_000, baseCostUsd: 50_000 },
  Class102: { lifeShotRating: 1_000_000, baseCostUsd: 25_000 },
  Class103: { lifeShotRating:   500_000, baseCostUsd: 12_000 },
  Class104: { lifeShotRating:   100_000, baseCostUsd:  5_000 },
  Class105: { lifeShotRating:       500, baseCostUsd:  1_500 },
};

// Ordered from cheapest to most expensive — pick first class whose rated life
// covers the required lifetime shots.
const MOLD_CLASS_ORDER: MoldClass[] = ['Class105', 'Class104', 'Class103', 'Class102', 'Class101'];

export function recommendMoldClass(
  lifetimeShots: number,
  partingComplexity: number | null,
  undercutCount: number | null,
): MoldClass {
  const needsBump = (partingComplexity ?? 0) > 0.6 || (undercutCount ?? 0) > 2;
  let cls: MoldClass = 'Class101';
  for (const c of MOLD_CLASS_ORDER) {
    if (SPI_MOLD_CLASSES[c].lifeShotRating >= lifetimeShots) {
      cls = c;
      break;
    }
  }
  if (needsBump) {
    // Bump one tier toward more durable (complex tooling wears faster).
    // MOLD_CLASS_ORDER is cheapest→most-durable so +1 index = more durable.
    const idx = MOLD_CLASS_ORDER.indexOf(cls);
    cls = MOLD_CLASS_ORDER[Math.min(MOLD_CLASS_ORDER.length - 1, idx + 1)] ?? cls;
  }
  return cls;
}

export function computeMoldCost(
  moldClass: MoldClass,
  cavityCount: number,
): number {
  const spec = SPI_MOLD_CLASSES[moldClass];
  // Additional cavities cost ~35% of base each (shared base plate, guide pins, ejector system)
  return spec.baseCostUsd + Math.max(0, cavityCount - 1) * spec.baseCostUsd * 0.35;
}

// ── Cavity count recommendation ───────────────────────────────────────────────
// Three constraints applied; take the minimum and round down to nearest power of 2.

export function recommendCavityCount(opts: {
  projectedAreaMm2: number | null;
  annualVolume: number;           // parts/year
  clampTonnageKN: number;         // machine clamp force
  shotCapacityCm3: number;        // machine shot capacity
  partVolumeMm3: number;
  gateType: GateType;
}): { count: number; constrainedBy: InjectionMoldingBreakdown['cavityConstrainedBy'] } {
  const { projectedAreaMm2, annualVolume, clampTonnageKN, shotCapacityCm3, partVolumeMm3, gateType } = opts;

  // 1. Clamp constraint: n_max = floor(clampTonnage_kN / (projArea_cm² × 0.35))
  const projAreaCm2 = (projectedAreaMm2 ?? 0) / 100;
  const nClamp = projAreaCm2 > 0
    ? Math.floor(clampTonnageKN / (projAreaCm2 * 0.35))
    : 999;

  // 2. Shot capacity constraint: 80% utilization; runner adds 8% for cold runner, 1% for hot
  const partVolCm3 = Math.max(partVolumeMm3, 1) / 1000;
  const runnerFactor = SELF_DEGATE_TYPES.has(gateType) ? 1.01 : 1.08;
  const nShot = Math.floor((shotCapacityCm3 * 0.80) / (partVolCm3 * runnerFactor));

  // 3. Economic constraint: break-even at ~50k parts/cavity/year
  const nEcon = Math.ceil(annualVolume / 50_000);

  const raw = Math.min(nClamp, nShot, nEcon);
  const clamped = Math.max(1, Math.min(raw, 16));

  // Round down to nearest power of 2 (1, 2, 4, 8, 16)
  const powers = [1, 2, 4, 8, 16] as const;
  const count = powers.reduce((best, p) => (p <= clamped ? p : best), 1 as number);

  let constrainedBy: InjectionMoldingBreakdown['cavityConstrainedBy'] = 'economic';
  if (nClamp <= nShot && nClamp <= nEcon) constrainedBy = 'clamp';
  else if (nShot <= nClamp && nShot <= nEcon) constrainedBy = 'shot_capacity';

  return { count, constrainedBy };
}

// ── Runner volume estimation ───────────────────────────────────────────────────

export function estimateRunnerVolumeCm3(
  bboxMaxMm: number,
  cavityCount: number,
  gateType: GateType,
): number {
  if (SELF_DEGATE_TYPES.has(gateType)) return 0; // hot runner: no runner scrap
  // SPI rule of thumb: runner diameter ~8mm, length ≈ 0.12 × bbox × cavity_layout_factor
  return Math.round((0.12 * bboxMaxMm * Math.sqrt(cavityCount)) * 10) / 10;
}

// ── Cost confidence ────────────────────────────────────────────────────────────

export function computeCostConfidence(
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
  // Bounding-box dimensions for the fill-time and gate-recommendation models.
  // When not provided, fill time falls back to the minimum (0.5 s) — no error.
  bboxMaxMm?: number;
  bboxMidMm?: number;
  // Machine physical specs for cavity count recommendation.
  // Derived from the selected machine record; defaults applied when not present.
  clampTonnageKN?: number;
  shotCapacityCm3?: number;
  // Tooling amortization inputs — required for ToolingCostDto.
  // When not provided, tooling cost is omitted from the response (no proxy guesses).
  annualVolume?: number;
  productionLifeYears?: number;
  // Molding subtype — auto-derived from material grade + signals when not supplied.
  moldingSubtype?: MoldingSubtype;
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

export function computeInjectionMoldedCostSummary(
  input: InjectionMoldingCostInput,
): CostSummaryDto & { processTree: IMProcessTree } {
  const {
    volume, surfaceArea, wallThicknessNominalMm, materialGrade, materialCostPerKg,
    materialDensityKgM3, materialSource, batchSize, family, mhrRate, deburrRate, inspectionRate,
  } = input;
  const batch = Math.max(batchSize, 1);

  const warnings: string[] = [];
  const processLines: ProcessLineCost[] = [];

  // Resolve molding subtype first — drives cycle time model + routing.
  const moldingSubtype = resolveSubtype(input);
  const isLsr = moldingSubtype === 'lsr';

  if (!materialGrade) warnings.push('Material grade not set — default engineering-plastic rates applied');
  if (volume <= 0)    warnings.push('Part volume is zero — shot weight and material cost may be inaccurate');
  if (wallThicknessNominalMm <= 0) {
    const model = isLsr ? 'LSR Arrhenius cure' : 'Menges cooling';
    warnings.push(`Wall thickness not detected — ${model} computed from ${IM_DEFAULT_WALL_MM}mm default gauge`);
  }
  if (isLsr) {
    warnings.push('LSR (thermoset) — Arrhenius cure model used; Menges cooling does NOT apply. Mold temperature 180°C (heated).');
  }
  // Injection-molded plastics are $2–40/kg (commodity to engineering resin).
  // Anything above $50/kg almost certainly indicates a mis-mapped material grade
  // (e.g. a metal or composite grade resolved as the fallback for a plastic name).
  // Surface this early so it is impossible to miss in the cost breakdown.
  if (materialCostPerKg > 50) {
    warnings.push(
      `MATERIAL COST ALERT: ${materialGrade ?? 'Unknown'} resolved to $${materialCostPerKg.toFixed(2)}/kg — ` +
      `injection-molded plastics are typically $2–40/kg. ` +
      `Verify the material grade in the BOM item; the cost breakdown below is unreliable until corrected.`,
    );
  }

  // ── Phase 4: compute cycle time via thermal + rheology models ─────────────
  const wall = wallThicknessNominalMm > 0 ? wallThicknessNominalMm : IM_DEFAULT_WALL_MM;
  // When bbox not provided, estimate from volume (cube root × 2 approximates longest dim).
  // bboxMid fallback prevents the sub-gate area heuristic from triggering on area=0.
  const bboxMax = (input.bboxMaxMm ?? 0) > 0 ? input.bboxMaxMm! : Math.cbrt(volume) * 2;
  const bboxMid = (input.bboxMidMm ?? 0) > 0 ? input.bboxMidMm! : Math.cbrt(volume) * 1.2;
  const callerGateType = (input.signals?.gateType ?? null) as GateType | null;

  const cycleTime = computeCycleTime({
    wallMm: wall,
    longestBboxMm: bboxMax,
    bboxMidMm: bboxMid,
    volumeMm3: volume,
    projectedAreaMm2: input.signals?.projectedAreaMm2 ?? null,
    grade: materialGrade,
    gateTypeOverride: callerGateType,
    isLsr,
  });

  // Surfacing the gate recommendation as a routing signal and (when changed from
  // any caller-supplied value) as an explicit audit note in warnings.
  const recommendedGate = cycleTime.gateRecommendation.gateType;
  if (callerGateType == null) {
    // Auto-recommendation: emit as an informational note (not a warning)
    warnings.push(`Gate recommendation: ${recommendedGate} — ${cycleTime.gateRecommendation.reason}`);
  } else if (callerGateType !== recommendedGate) {
    warnings.push(
      `Gate type overridden by caller: ${callerGateType} (recommended: ${recommendedGate} — ${cycleTime.gateRecommendation.reason})`,
    );
  }

  // Clamp tonnage advisory — computed from projected area and material pressure
  // factor. The machine selector already uses this for IMM selection; surface it
  // here so the user sees the constraint in the cost breakdown warnings.
  if ((input.signals?.projectedAreaMm2 ?? 0) > 0) {
    const resinProps = lookupResinProps(materialGrade);
    // Reuse physics.ts classifyResinFamily via pressure factor approximation.
    // Phase 5 will import clampTonnageRequired directly from the machine selector.
    const projAreaCm2 = (input.signals!.projectedAreaMm2 as number) / 100;
    // Conservative 0.65 ton/cm² default for mixed engineering plastics.
    const pressureFactor = resinProps.Tm > 300 ? 1.0 : resinProps.Tm > 240 ? 0.75 : 0.65;
    const clampTon = Math.ceil(projAreaCm2 * pressureFactor);
    warnings.push(`Estimated clamp force: ~${clampTon}T (${projAreaCm2.toFixed(0)} cm² × ${pressureFactor} tons/cm²)`);
  }

  // ── Cavity count: 3-constraint recommendation ─────────────────────────────
  // Machine defaults: 80T class (conservative) when no machine data supplied.
  // 1 ton ≈ 10 kN; shot capacity ≈ 0.9 × tonnage (industry rule of thumb).
  const DEFAULT_CLAMP_KN = 800;    // 80T default class
  const DEFAULT_SHOT_CM3 = 72;     // 80T × 0.9
  const clampKN = input.clampTonnageKN ?? DEFAULT_CLAMP_KN;
  const shotCm3 = input.shotCapacityCm3 ?? DEFAULT_SHOT_CM3;

  const { count: cavityCount, constrainedBy: cavityConstrainedBy } = recommendCavityCount({
    projectedAreaMm2: input.signals?.projectedAreaMm2 ?? null,
    annualVolume: input.annualVolume ?? batch,
    clampTonnageKN: clampKN,
    shotCapacityCm3: shotCm3,
    partVolumeMm3: volume,
    gateType: (input.signals?.gateType ?? 'edge') as GateType,
  });

  if (cavityCount > 1) {
    warnings.push(`Cavity count: ${cavityCount} (constrained by ${cavityConstrainedBy}) — confirm with toolmaker`);
  }
  if (!input.clampTonnageKN) {
    warnings.push('Machine clamp tonnage not supplied — cavity count estimated from 80T default class');
  }

  // ── Route the part — gate type from Phase 4 feeds into routing ─────────────
  const netWeightKg = r3((Math.max(volume, 0) / 1e9) * materialDensityKgM3);
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
    // Phase 4: always supply gate type — either the caller's or the recommendation.
    gateType: recommendedGate,
    partingComplexity: input.signals?.partingComplexity ?? null,
    unscrewingCoreCount: (input.signals as any)?.unscrewingCoreCount ?? null,
    overmoldSubstrate: (input.signals as any)?.overmoldSubstrate ?? null,
  };
  const processTree = buildInjectionMoldingRoute(signals, moldingSubtype);
  warnings.push(...processTree.routingWarnings);
  const routed = new Set<string>(processTree.operations.map((o) => o.id));

  // ── Material: shot weight = part + runner/sprue allowance ───────────────────
  // Hot-runner tools have negligible runner scrap; cold-runner tools lose ~8%.
  const runnerPct = SELF_DEGATE_TYPES.has(recommendedGate) ? 1 : IM_RUNNER_SCRAP_PCT;
  const shotWeightKg = r3(netWeightKg * (1 + runnerPct / 100));
  const materialCost = r2(shotWeightKg * materialCostPerKg);

  // ── Cost every routed operation, in route order ─────────────────────────────

  let setupMin = 0;      // batch-amortized station time (drying + mold setup)
  let moldingMin = 0;    // in-cycle machine time per part
  let secondaryMin = 0;  // bench ops per part
  let inspectionMin = 0;

  if (routed.has('lsr_compound_dosing')) {
    const dosingSetupMin = IM_LSR_DOSING_ATTENDED_MIN / batch;
    const dosingRunMin   = IM_LSR_DOSING_RUN_SEC / 60;
    setupMin += dosingSetupMin;
    secondaryMin += dosingRunMin;
    processLines.push(makeLine('LSR Compound Dosing',
      r2((dosingSetupMin / 60) * deburrRate.rate),
      r2((dosingRunMin / 60) * deburrRate.rate),
      dosingSetupMin + dosingRunMin, deburrRate));
  }

  if (routed.has('material_drying')) {
    const dryMin = IM_DRYING_ATTENDED_MIN / batch;
    setupMin += dryMin;
    processLines.push(makeLine('Material Drying', r2((dryMin / 60) * deburrRate.rate), 0, dryMin, deburrRate));
  }

  if (routed.has('mold_setup')) {
    const moldSetupMin = IM_SETUP_MIN / batch;
    setupMin += moldSetupMin;
    processLines.push(makeLine('Mold Setup', r2((moldSetupMin / 60) * mhrRate.rate), 0, moldSetupMin, mhrRate));
  }

  // Phase 4 in-cycle steps — times from the thermal/rheology model, not constants.
  // LSR: cooling is replaced by lsr_curing (Arrhenius); packing is absent for LSR.
  // Each step gets its own process line so the breakdown stays auditable; cavityCount
  // amortizes machine time per part (multi-cavity: same cycle produces N parts).
  const inCycleSteps: Array<{ id: string; label: string; sec: number }> = [
    { id: 'injection',  label: 'Injection',              sec: cycleTime.fillSec  },
    { id: 'packing',    label: 'Packing/Holding',        sec: cycleTime.packSec  },
    { id: 'cooling',    label: 'Cooling',                sec: isLsr ? 0 : cycleTime.coolSec },
    { id: 'lsr_curing', label: 'LSR Curing (Thermoset)', sec: isLsr ? cycleTime.coolSec : 0 },
    { id: 'ejection',   label: 'Ejection',               sec: cycleTime.ejectSec },
  ];
  for (const step of inCycleSteps) {
    if (!routed.has(step.id)) continue;
    const stepMin = (step.sec / cavityCount) / 60;
    moldingMin += stepMin;
    processLines.push(makeLine(step.label, 0, r2((stepMin / 60) * mhrRate.rate), stepMin, mhrRate));
  }

  if (routed.has('gate_trimming')) {
    const trimSec = surfaceArea > 0
      ? Math.max(IM_TRIM_MIN_SEC, (surfaceArea / 100_000) * IM_TRIM_SEC_PER_10CM2)
      : IM_TRIM_MIN_SEC;
    const trimMin = trimSec / 60;
    secondaryMin += trimMin;
    processLines.push(makeLine('Gate Trimming', 0, r2((trimMin / 60) * deburrRate.rate), trimMin, deburrRate));
  }

  if (routed.has('deflashing')) {
    const deflashMin = IM_DEFLASH_SEC / 60;
    secondaryMin += deflashMin;
    processLines.push(makeLine('Deflashing', 0, r2((deflashMin / 60) * deburrRate.rate), deflashMin, deburrRate));
  }

  // Phase 3: side action — in-cycle machine time on the IMM, one actuation per
  // undercut per shot.
  if (routed.has('side_action')) {
    const undercuts = Math.max(signals.undercutCount ?? 1, 1);
    const slideMin = (undercuts * IM_SIDE_ACTION_SEC_PER_UNDERCUT / cavityCount) / 60;
    moldingMin += slideMin;
    processLines.push(
      makeLine('Side Action (Slide/Lifter)', 0, r2((slideMin / 60) * mhrRate.rate), slideMin, mhrRate),
    );
  }

  // Core unscrewing — in-cycle hydraulic/servo rotation, priced as IMM time.
  if (routed.has('core_unscrewing')) {
    const cores = Math.max((signals as any).unscrewingCoreCount ?? 1, 1);
    const coreMin = (cores * IM_UNSCREWING_CORE_SEC / cavityCount) / 60;
    moldingMin += coreMin;
    processLines.push(
      makeLine('Core Unscrewing', 0, r2((coreMin / 60) * mhrRate.rate), coreMin, mhrRate),
    );
  }

  // Insert loading — in-mold placement before shot (insert molding subtype).
  if (routed.has('insert_loading')) {
    const inserts = Math.max(signals.insertCount ?? 1, 1);
    const loadMin = (inserts * IM_INSERT_LOADING_SEC_PER_INSERT) / 60;
    secondaryMin += loadMin;
    processLines.push(
      makeLine('Insert Loading (In-Mold)', 0, r2((loadMin / 60) * deburrRate.rate), loadMin, deburrRate),
    );
  }

  // Insert inspection — pull test / torque check, sampled (batch-amortized).
  if (routed.has('insert_inspection')) {
    const amortizedInspMin = IM_INSERT_INSPECTION_SEC / 60 / Math.max(batch / 10, 1);
    inspectionMin += amortizedInspMin;
    processLines.push(
      makeLine('Insert Pull Test', r2((amortizedInspMin / 60) * inspectionRate.rate), 0, amortizedInspMin, inspectionRate),
    );
  }

  // Legacy post-mold insert installation (standard subtype with inserts).
  if (routed.has('insert_installation')) {
    const inserts = Math.max(signals.insertCount ?? 0, 1);
    const insertMin = (inserts * IM_INSERT_SEC_PER_INSERT) / 60;
    secondaryMin += insertMin;
    processLines.push(
      makeLine('Insert Installation', 0, r2((insertMin / 60) * deburrRate.rate), insertMin, deburrRate),
    );
  }

  // LSR secondary cure oven — post-mold batch oven, 4h at 200°C, batch-amortized.
  if (routed.has('secondary_cure_oven')) {
    const ovenMin = IM_LSR_SECONDARY_CURE_OVEN_MIN / batch;
    setupMin += ovenMin;
    processLines.push(
      makeLine('Secondary Cure Oven', r2((ovenMin / 60) * deburrRate.rate), 0, ovenMin, deburrRate),
    );
  }

  if (routed.has('ultrasonic_welding')) {
    const joints = Math.max(signals.assemblyFeatureCount ?? 0, 1);
    const weldMin = (joints * IM_WELD_SEC_PER_JOINT) / 60;
    secondaryMin += weldMin;
    processLines.push(
      makeLine('Ultrasonic Welding', 0, r2((weldMin / 60) * deburrRate.rate), weldMin, deburrRate),
    );
  }

  if (routed.has('visual_inspection')) {
    const vMin = IM_VISUAL_SEC / 60;
    inspectionMin += vMin;
    processLines.push(makeLine('Visual Inspection', 0, r2((vMin / 60) * inspectionRate.rate), vMin, inspectionRate));
  }

  if (routed.has('dimensional_inspection')) {
    // Dimensional inspection for injection-molded parts is a first-article check
    // (ISIR / PPAP-style measurement of the first shot), NOT per-part 100%
    // inspection. Per-part CMM-level checking is only applied for aerospace/
    // medical parts — that level is handled by the CMM operation in other routes.
    // Cost is batch-amortized: one 5-minute check covers the whole production run.
    const amortizedMin = IM_DIMENSIONAL_MIN / batch;
    inspectionMin += amortizedMin;
    processLines.push(
      makeLine(
        'Dimensional Inspection (First Article)',
        r2((amortizedMin / 60) * inspectionRate.rate),
        0,
        amortizedMin,
        inspectionRate,
      ),
    );
  }

  if (routed.has('weight_check')) {
    const wMin = IM_WEIGHT_CHECK_SEC / 60;
    inspectionMin += wMin;
    processLines.push(makeLine('Weight Check', 0, r2((wMin / 60) * inspectionRate.rate), wMin, inspectionRate));
  }

  // ── Totals ──────────────────────────────────────────────────────────────────
  const totalProcessCost = r2(processLines.reduce((s, l) => s + l.totalCost, 0));
  const totalCost        = r2(materialCost + totalProcessCost);
  const totalMin         = r2(processLines.reduce((s, l) => s + l.cycleTimeMin, 0));

  const sustainability = computeSustainability(
    materialGrade, materialCostPerKg, netWeightKg, shotWeightKg, batchSize, processLines,
  );

  // ── Runner volume ─────────────────────────────────────────────────────────
  const runnerVolumeScrapCm3 = estimateRunnerVolumeCm3(bboxMax, cavityCount, recommendedGate);
  const runnerScrapKg = r3((runnerVolumeScrapCm3 / 1000) * materialDensityKgM3);
  const runnerSystemType: 'hot' | 'cold' = SELF_DEGATE_TYPES.has(recommendedGate) ? 'hot' : 'cold';

  // ── Cost confidence ───────────────────────────────────────────────────────
  const hasSelectedMachine = mhrRate.source === 'mhr_database';
  const confidence = computeCostConfidence(
    { ...signals, wallThicknessNominalMm: wallThicknessNominalMm > 0 ? wallThicknessNominalMm : 0 },
    hasSelectedMachine,
    cavityConstrainedBy,
  );

  const imBreakdown: InjectionMoldingBreakdown = {
    moldingSubtype,
    cavityCount,
    cavityConstrainedBy,
    runnerSystemType,
    runnerScrapKg,
    gateType: recommendedGate,
    undercutCount: signals.undercutCount ?? null,
    partingComplexity: signals.partingComplexity ?? null,
    cycleTimeSec: r2(cycleTime.totalCycleSec),
    cavityCycleTimeSec: r2(cycleTime.totalCycleSec / cavityCount),
    costConfidence: confidence,
  };

  // ── Tooling cost (separate from piece cost, omitted when inputs absent) ────
  let toolingResult: ToolingCostDto | undefined;
  const annualVol = input.annualVolume;
  const prodLife = input.productionLifeYears;
  if (annualVol != null && prodLife != null && annualVol > 0 && prodLife > 0) {
    const annualShotsPerCavity = annualVol / cavityCount;
    const lifetimeShots = annualShotsPerCavity * prodLife;
    // Unscrewing cores add mold complexity beyond parting line — treat as additional undercut bump.
    const effectiveUndercutCount = (signals.undercutCount ?? 0) + ((signals as any).unscrewingCoreCount ?? 0);
    const moldClass = recommendMoldClass(lifetimeShots, signals.partingComplexity ?? null, effectiveUndercutCount);
    const moldCostUsd = r2(computeMoldCost(moldClass, cavityCount));
    const moldCostPerPartUsd = r2(moldCostUsd / (annualVol * prodLife));
    toolingResult = {
      moldClass,
      moldLifeShotRating: SPI_MOLD_CLASSES[moldClass].lifeShotRating,
      moldCostUsd,
      moldCostPerPartUsd,
      annualVolume: annualVol,
      productionLifeYears: prodLife,
    };
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
