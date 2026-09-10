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
import { buildInjectionMoldingRoute } from './routing-engine';
import {
  computeCycleTime,
  lookupResinProps,
  type GateType,
  type RealResinInputs,
} from './cycle-time';

function r2(n: number): number { return Math.round(n * 100) / 100; }
function r3(n: number): number { return Math.round(n * 1000) / 1000; }

// ── Constants not replaced by Phase 4 cycle-time engine ───────────────────────

const IM_DEFAULT_WALL_MM = 2.0;        // Menges cooling fallback when wall not measured

// Material — exported: machine selection uses the same runner allowance to
// compute shot weight (one number, not two drifting copies).
export const IM_RUNNER_SCRAP_PCT = 8;  // runner/sprue material lost per shot (cold runner)

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
// lifeShotRating values confirmed against the real source table (migration
// 682, tblSpiType.json / "Num Annual Mold Cycles") — Class101 and Class105
// were wrong before this fix (Class101 was capped at 1,000,000 instead of
// the real ~unlimited production-tooling rating; Class105 was 10x too low
// at 500 instead of 5,000). Class102-104 already matched and are unchanged.
// The real table also carries a "Use Insert" flag per class (true for
// 101/102, false for 103-105) — whether the mold uses a replaceable
// hardened cavity insert — a real signal not modeled anywhere in this
// engine yet; disclosed here as a follow-up, not added in this pass.
//
// baseCostUsd was removed from this table (2026-09-10) — those 5 flat
// dollar figures had no DB/migration/literature citation anywhere (unlike
// lifeShotRating above). Mold cost is now computed from the real, itemized
// mold-tooling BOM (mold-tooling-engine.ts) instead of a per-class constant
// — mold class now drives only the life-rating check in recommendMoldClass.

export type MoldClass = 'Class101' | 'Class102' | 'Class103' | 'Class104' | 'Class105';

interface MoldClassSpec {
  lifeShotRating: number; // shots the mold is rated for
}

const SPI_MOLD_CLASSES: Record<MoldClass, MoldClassSpec> = {
  Class101: { lifeShotRating: 9_999_999_999 },
  Class102: { lifeShotRating:     1_000_000 },
  Class103: { lifeShotRating:       500_000 },
  Class104: { lifeShotRating:       100_000 },
  Class105: { lifeShotRating:         5_000 },
};

// Ordered from cheapest to most expensive — pick first class whose rated life
// covers the required lifetime shots.
const MOLD_CLASS_ORDER: MoldClass[] = ['Class105', 'Class104', 'Class103', 'Class102', 'Class101'];

// Multi-cavity scaling: real per-additional-cavity component-count data was
// not found in any sourced table (see mold-tooling-engine.ts's own doc
// comment) — this +35%-of-base-per-additional-cavity figure is retained as a
// disclosed engineering estimate, unchanged from before the BOM-cost fix,
// applied now to the real itemized BOM subtotal instead of a flat SPI
// per-class constant.
export function computeMoldCost(baseCostUsd: number, cavityCount: number): number {
  return baseCostUsd + Math.max(0, cavityCount - 1) * baseCostUsd * 0.35;
}

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
  // Local currency symbol (₹, $, €, …) for warning messages; defaults to '$'.
  currencySymbol?: string;
  // Real per-grade thermal properties (Phase 1 materials-data foundation,
  // 2026-09-02), resolved by the caller from raw_materials via
  // resolveMaterialForFamily — the SAME real row materialCostPerKg/
  // materialDensityKgM3 above came from. Optional; the Menges cooling
  // formula falls back to the cited generic resin-family table
  // (RESIN_THERMAL_TABLE) field-by-field when a specific property isn't on
  // file for this grade — never fabricated, never all-or-nothing.
  realResinInputs?: RealResinInputs | null;
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

  // ── Cavity count: 3-constraint recommendation ─────────────────────────────
  // Machine defaults: 80T class (conservative) when no machine data supplied.
  // 1 ton ≈ 10 kN; shot capacity ≈ 0.9 × tonnage (industry rule of thumb).
  // Computed BEFORE cycle time (moved ahead of its original position, migration
  // 663 wiring) — recommendCavityCount() has no dependency on the cycle-time
  // result (its gateType input is the caller/default value, not the
  // cycle-time-recommended gate), and cycleTime.fillSec needs the real
  // cavityCount to apply the real cavities-per-mold adjustment factor below.
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
    realResinInputs: input.realResinInputs,
    // Real fill-time adjustment factors (migration 663). No per-part
    // gate-count signal exists yet, so gatesPerCavity keeps its default
    // (1) — surfaced explicitly in warnings below rather than left silent.
    cavityCount,
  });
  if (input.realResinInputs?.meltingTempC != null || input.realResinInputs?.moldTempC != null) {
    warnings.push(
      `Cooling-time inputs: using real per-grade thermal properties on file for "${materialGrade ?? 'this material'}" ` +
      `(raw_materials) where available; generic resin-family literature defaults fill any remaining field.`,
    );
  }
  if (cavityCount > 1) {
    warnings.push(
      `Fill time uses real cavity-count/gate-count adjustment factors (migration 663): ${cavityCount} cavities × 1 gate/cavity assumed (no gate-count signal on file).`,
    );
  }

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
    // Same real-or-fallback resolution as the cooling model above — a
    // material's Tm can never disagree with itself between the two uses in
    // this function.
    const resinProps = lookupResinProps(materialGrade, input.realResinInputs);
    // Reuse physics.ts classifyResinFamily via pressure factor approximation.
    // Phase 5 will import clampTonnageRequired directly from the machine selector.
    const projAreaCm2 = (input.signals!.projectedAreaMm2 as number) / 100;
    // Conservative 0.65 ton/cm² default for mixed engineering plastics.
    const pressureFactor = resinProps.Tm > 300 ? 1.0 : resinProps.Tm > 240 ? 0.75 : 0.65;
    const clampTon = Math.ceil(projAreaCm2 * pressureFactor);
    warnings.push(`Estimated clamp force: ~${clampTon}T (${projAreaCm2.toFixed(0)} cm² × ${pressureFactor} tons/cm²)`);
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

  // Phase 4 in-cycle steps — times from the thermal/rheology model, not
  // constants. LSR: cooling is replaced by lsr_curing (Arrhenius); packing is
  // absent for LSR. cavityCount amortizes machine time per part (multi-
  // cavity: same cycle produces N parts).
  //
  // Combined into ONE real process line, not one line per internal phase.
  // Root cause (2026-09-11, user-reported): the previous one-line-per-phase
  // breakdown (Injection/Packing/Cooling/Ejection) had no catalog counterpart
  // of its own — this domain's real, database-driven process list is exactly
  // 4 named processes (migration 736), this one included, not a 5th-8th
  // phase-level entry — and, all sharing one machine_class, it broke
  // matchedEngineLine's machine_class-only lookup (stored-process-lines.ts):
  // every row matched whichever line came first, so Packing/Holding,
  // Cooling, and Ejection all rendered the identical duplicated machine/
  // tonnage/cycle-time block. Each phase's own physics-derived time is still
  // computed and summed here — nothing is discarded — it is just no longer
  // split into separate user-facing rows. The line's label is the real
  // catalog process name for whichever of the 2 real machine classes that
  // share this function actually costed it (injection_molding vs
  // structural_foam_molding — both real, both in the 4-process catalog).
  const MOLDING_PROCESS_LABEL: Record<string, string> = {
    injection_molding: 'Injection Molding',
    structural_foam_molding: 'Structural Foam Molding',
  };
  const inCycleSteps: Array<{ id: string; sec: number }> = [
    { id: 'injection',  sec: cycleTime.fillSec  },
    { id: 'packing',    sec: cycleTime.packSec  },
    { id: 'cooling',    sec: isLsr ? 0 : cycleTime.coolSec },
    { id: 'lsr_curing', sec: isLsr ? cycleTime.coolSec : 0 },
    { id: 'ejection',   sec: cycleTime.ejectSec },
  ];
  const inCycleSec = inCycleSteps.reduce((s, step) => s + (routed.has(step.id) ? step.sec : 0), 0);
  if (inCycleSec > 0) {
    const inCycleMin = (inCycleSec / cavityCount) / 60;
    moldingMin += inCycleMin;
    const processLabel = MOLDING_PROCESS_LABEL[mhrRate.machineClass] ?? 'Injection Molding';
    processLines.push(makeLine(processLabel, 0, r2((inCycleMin / 60) * mhrRate.rate), inCycleMin, mhrRate));
  }

  if (routed.has('gate_trimming')) {
    warnings.push(uncostedOpWarning(UNCOSTED_OPERATION_LABELS.gate_trimming));
  }

  if (routed.has('deflashing')) {
    warnings.push(uncostedOpWarning(UNCOSTED_OPERATION_LABELS.deflashing));
  }

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
    warnings.push(uncostedOpWarning(
      UNCOSTED_OPERATION_LABELS.insert_loading,
      `${signals.insertCount ?? '?'} insert(s)`,
    ));
  }

  if (routed.has('insert_inspection')) {
    warnings.push(uncostedOpWarning(UNCOSTED_OPERATION_LABELS.insert_inspection));
  }

  if (routed.has('insert_installation')) {
    warnings.push(uncostedOpWarning(
      UNCOSTED_OPERATION_LABELS.insert_installation,
      `${signals.insertCount ?? '?'} insert candidate(s)`,
    ));
  }

  if (routed.has('secondary_cure_oven')) {
    warnings.push(uncostedOpWarning(UNCOSTED_OPERATION_LABELS.secondary_cure_oven));
  }

  if (routed.has('ultrasonic_welding')) {
    warnings.push(uncostedOpWarning(
      UNCOSTED_OPERATION_LABELS.ultrasonic_welding,
      `${signals.assemblyFeatureCount ?? '?'} assembly/weld feature(s)`,
    ));
  }

  if (routed.has('visual_inspection')) {
    warnings.push(uncostedOpWarning(UNCOSTED_OPERATION_LABELS.visual_inspection));
  }

  if (routed.has('dimensional_inspection')) {
    warnings.push(uncostedOpWarning(UNCOSTED_OPERATION_LABELS.dimensional_inspection));
  }

  if (routed.has('weight_check')) {
    warnings.push(uncostedOpWarning(UNCOSTED_OPERATION_LABELS.weight_check));
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

    // Real required mold-window area (projected area x cavity count) — same
    // bbox-product fallback cycle-time.ts already uses when CAD hasn't
    // supplied a real projected area (see recommendGateType, cycle-time.ts:328).
    const projectedAreaMm2 = signals.projectedAreaMm2 ?? (bboxMax * bboxMid);
    const moldBaseAreaMm2 = Math.max(0, projectedAreaMm2) * cavityCount;
    const moldTooling = computeMoldToolingCost({
      moldBaseAreaMm2,
      cavityCount,
      undercutCount: effectiveUndercutCount,
    });
    const moldCostUsd = r2(computeMoldCost(moldTooling.bomSubtotalUsd, cavityCount));
    const moldCostPerPartUsd = r2(moldCostUsd / (annualVol * prodLife));
    toolingResult = {
      moldClass,
      moldLifeShotRating: SPI_MOLD_CLASSES[moldClass].lifeShotRating,
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
