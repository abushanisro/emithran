import type { MHRRateInput } from '../core/cost-engine';
import type { ProcessLineCost, FeatureOp, PhysicsGap, ConfidenceLevel } from '../../../dto/cost-breakdown.dto';
import {
  type InspectionMethod, type InspectionRuleRow,
  resolveInspectionRule,
} from '../physics/gdt-severity';

// ── Inspection — tiered (Level 1 CAD → Level 2 +drawing intelligence →
// Level 3 +GD&T), feature-driven, never a fixed guessed cycle time.
//
// Pipeline: Planning (candidates, built by the caller from real CAD/drawing
// data) → Sampling (how many candidates actually get inspected) → Equipment/
// Method (which gauge/instrument, escalating with real signal) → Cycle Time
// → Cost. Always produces exactly one 'Inspection' process line (or none, if
// inspectionStrategy is 'skip') — never a second, separately-triggered
// inspection line elsewhere in the route.
//
// Manufacturing Physics Calculator architecture: this module owns the real
// business/QC-strategy decisions (sampling, method escalation, per-feature
// time lookup via inspection_operation_defaults) — legitimate real-input
// resolution, the same role Press Brake's tonnage calc or Burring's force
// calc play elsewhere. It deliberately does NOT sum those resolved times
// into a final cycle time itself anymore: planInspection() (sync, DB-free,
// directly unit-testable) produces the plan; the caller (bom-items.service.ts)
// feeds that plan's fields into the real "Sheet Metal - Inspection" DB
// calculator via resolvePhysicsQuantity (the exact same additive formula
// this module used to compute inline); finalizeInspectionLine() (also sync)
// turns the calculator's resolved Total Time (or a real gap) into the
// costed ProcessLineCost. Two functions, not two implementations of the sum.
//
// Disclosed, not fabricated: per-hole tolerance/criticality/type and bend
// angle aren't extracted anywhere in the sheet-metal pipeline today (no
// per-feature GD&T linkage exists yet) — HoleInspectionCandidate/
// BendInspectionCandidate carry those fields as optional so this engine is
// ready for that data without an interface change, but never invents it.
// gdtCallouts is real today but always [] (the drawing parser's GD&T
// extraction, Module 3, isn't built yet) — Level 3 is reachable code, not a
// hardcoded escalation that fires regardless.

export interface HoleInspectionCandidate {
  diameterMm?: number;
  toleranceMm?: number;
  isThreaded?: boolean;
  isCritical?: boolean;
}

export interface BendInspectionCandidate {
  lengthMm?: number;
  radiusMm?: number;
  angleDeg?: number; // never populated today — see class-level comment
  isCritical?: boolean;
}

export type InspectionStrategy = '100pct' | 'first_article' | 'sampling' | 'skip';

export interface InspectionOperationDefaultRow {
  feature: 'hole' | 'bend' | 'thickness' | 'dimension' | 'thread' | 'visual_base';
  method: InspectionMethod;
  cycle_time_sec: number;
  sampling_default: InspectionStrategy | null;
  equipment: string | null;
}

export interface InspectionInput {
  holes: HoleInspectionCandidate[];
  bends: BendInspectionCandidate[];
  sheetThicknessMm: number;
  hasOverallDimensions: boolean;
  threads: Array<{ size: string; count: number }>;
  generalTolerances: string | null;
  toleranceConfidence: number;
  gdtCallouts: Array<{ type: string; toleranceMm: number }>;
  inspectionRules: InspectionRuleRow[];
  operationDefaults: InspectionOperationDefaultRow[];
  inspectionStrategy: InspectionStrategy;
  samplingRate: number; // pre-resolved via SheetMetalLookupService.getSamplingRate(batchSize) — real AQL fraction
  batchSize: number;
  // Generic rate (visual/caliper/height_gauge tiers — e.g. a manual
  // inspection bench). cmmRate is a SEPARATE, real CMM-specific rate (see
  // BOMItemsService.resolveCmmSpecificRate) — a CMM-tier escalation must not
  // silently charge bench rates for dedicated CMM equipment. Optional: when
  // absent, a cmm-tier escalation falls back to `rate` with a warning.
  rate: MHRRateInput;
  cmmRate?: MHRRateInput;
  qaInspectorRatePerHr: number | null;
  processIdentity?: { processGroup: string; processRoute: string; operation: string };
}

export interface InspectionResult {
  processLines: ProcessLineCost[];
  inspectionMethod: InspectionMethod | null;
  featuresInspected: { holes: number; bends: number; threads: number };
  warnings: string[];
}

// Everything planInspection() resolves BEFORE the final cycle-time sum —
// real per-feature counts, the escalated method, and each feature's real
// per-unit time (from inspection_operation_defaults, or FALLBACK_SEC when
// that table has no row yet). This is exactly the seed data the real
// "Sheet Metal - Inspection" DB calculator's fields expect — see this
// interface's fields against that calculator's own field names
// (calculator_fields.field_name), which match 1:1.
export interface InspectionPlan {
  skip: boolean;
  method: InspectionMethod;
  holesToInspect: number;
  bendsToInspect: number;
  threadsToInspect: number;
  visualPassBaseSec: number;
  holeCheckSec: number;
  bendCheckSec: number;
  threadGaugeSec: number;
  hasThicknessCheck: boolean;
  thicknessCheckSec: number;
  hasDimensionCheck: boolean;
  dimensionCheckSec: number;
  // First-article inspection is one full pass, amortized across the batch —
  // same amortization convention already used for setup costs elsewhere in
  // this codebase (setupCost = setupMin/60 * rate / batchSize).
  amortizeDivisor: number;
  featureBreakdown: FeatureOp[];
  rate: MHRRateInput;
  warnings: string[];
}

// What the caller resolved for this plan's cycle time — mirrors every other
// migrated process's *CycleTimeSecFromCalculator/*CalculatorId/
// *CalculatorVersion/*PhysicsGap convention (cost-engine.ts), just grouped
// into one object since Inspection's line-building lives in this module,
// not cost-engine.ts.
export interface InspectionResolvedTime {
  cycleTimeSec?: number;
  calculatorId?: string | null;
  calculatorVersion?: number | null;
  gap?: PhysicsGap | null;
  confidence?: ConfidenceLevel;
}

// General tolerance classes (ISO 2768-1) coarser than 'f' (fine) don't need
// more than a visual pass; 'f'/'m' with a tight-enough grade floor the method
// at caliper. This is a real, published standard's own tier boundary, not an
// invented threshold.
function toleranceClassImpliesCaliper(generalTolerances: string | null): boolean {
  if (!generalTolerances) return false;
  return /ISO\s*2768[\s\-]*[fm]/i.test(generalTolerances);
}

function r2(n: number): number { return Math.round(n * 100) / 100; }

function methodRank(m: InspectionMethod): number {
  return { visual: 0, caliper: 1, height_gauge: 2, cmm: 3 }[m];
}

/**
 * Stages 1-3 of the inspection pipeline: sampling, equipment/method
 * escalation, and per-feature time resolution. Pure, synchronous, DB-free —
 * directly unit-testable. Does NOT sum the resolved times into a cycle
 * time; that sum is the real "Sheet Metal - Inspection" calculator's job
 * (see finalizeInspectionLine's doc comment).
 */
export function planInspection(input: InspectionInput): InspectionPlan {
  const warnings: string[] = [];

  if (input.inspectionStrategy === 'skip') {
    warnings.push('Inspection explicitly skipped for this quote — no inspection line included');
    return {
      skip: true, method: 'visual',
      holesToInspect: 0, bendsToInspect: 0, threadsToInspect: 0,
      visualPassBaseSec: 0, holeCheckSec: 0, bendCheckSec: 0, threadGaugeSec: 0,
      hasThicknessCheck: false, thicknessCheckSec: 0, hasDimensionCheck: false, dimensionCheckSec: 0,
      amortizeDivisor: 1, featureBreakdown: [], rate: input.rate, warnings,
    };
  }

  // ── Stage 2: Sampling — how many candidates actually get inspected ────────
  // 'first_article' checks EVERY feature on the one unit being inspected (same
  // feature count as '100pct') — the distinction from '100pct' is that the
  // resulting cost is amortized across the whole batch (see amortizeDivisor
  // below), not that fewer features get checked on that one unit.
  const sampleCount = (candidates: unknown[]): number => {
    if (candidates.length === 0) return 0;
    switch (input.inspectionStrategy) {
      case '100pct':
      case 'first_article':
        return candidates.length;
      case 'sampling':
      default:
        return Math.max(1, Math.ceil(candidates.length * input.samplingRate));
    }
  };
  const holesToInspect = sampleCount(input.holes);
  const bendsToInspect = sampleCount(input.bends);
  const threadCount = input.threads.reduce((s, t) => s + (t.count ?? 0), 0);
  const threadsToInspect = (input.inspectionStrategy === '100pct' || input.inspectionStrategy === 'first_article')
    ? threadCount
    : Math.max(threadCount > 0 ? 1 : 0, Math.ceil(threadCount * input.samplingRate));

  const amortizeDivisor = input.inspectionStrategy === 'first_article' ? Math.max(input.batchSize, 1) : 1;

  // ── Stage 3: Equipment/Method selection ────────────────────────────────────
  const defaultsByKey = new Map<string, InspectionOperationDefaultRow>();
  for (const row of input.operationDefaults) defaultsByKey.set(`${row.feature}:${row.method}`, row);

  let method: InspectionMethod = 'visual';
  if (toleranceClassImpliesCaliper(input.generalTolerances) || input.toleranceConfidence >= 0.7) {
    method = 'caliper';
  }

  // Level 3 — real GD&T escalation. gdtCallouts is real today but always []
  // (drawing parser Module 3 not built) — this branch is reachable, not dormant-but-faked.
  for (const callout of input.gdtCallouts) {
    const rule = resolveInspectionRule(input.inspectionRules, callout.type, callout.toleranceMm);
    if (methodRank(rule.inspectionMethod) > methodRank(method)) method = rule.inspectionMethod;
  }
  // Fold-in of the old standalone tight-tolerance CMM trigger: any hole
  // candidate with a real per-feature tolerance this tight escalates the
  // whole line's method, rather than firing a second, separately-built line.
  for (const hole of input.holes) {
    if (hole.toleranceMm != null && hole.toleranceMm > 0 && hole.toleranceMm < 0.05) {
      method = methodRank('cmm') > methodRank(method) ? 'cmm' : method;
    }
  }

  const getSec = (feature: InspectionOperationDefaultRow['feature'], m: InspectionMethod): { sec: number; dataFound: boolean } => {
    const row = defaultsByKey.get(`${feature}:${m}`) ?? defaultsByKey.get(`${feature}:visual`);
    if (row) return { sec: row.cycle_time_sec, dataFound: true };
    return { sec: FALLBACK_SEC[feature] ?? 0, dataFound: false };
  };

  // Real, per-feature audit trail — same purpose as Laser Cutting/Press
  // Brake's own featureBreakdown (cost-breakdown.dto.ts). The leading entry
  // discloses WHICH method this line escalated to and why.
  const featureBreakdown: FeatureOp[] = [
    { name: `Method: ${method}`, timeSec: 0, featureType: 'inspection_method', count: 1 },
  ];

  let missingSeed = false;
  const resolveSec = (feature: InspectionOperationDefaultRow['feature'], count: number, label: string): number => {
    if (count <= 0) return 0;
    const { sec, dataFound } = getSec(feature, method);
    if (!dataFound) missingSeed = true;
    featureBreakdown.push({ name: `${label} (${method})`, timeSec: sec, featureType: feature, count });
    return sec;
  };

  const holeCheckSec = resolveSec('hole', holesToInspect, 'Hole check');
  const bendCheckSec = resolveSec('bend', bendsToInspect, 'Bend check');
  const threadGaugeSec = resolveSec('thread', threadsToInspect, 'Thread gauge check');
  const hasThicknessCheck = input.sheetThicknessMm > 0;
  const thicknessCheckSec = resolveSec('thickness', hasThicknessCheck ? 1 : 0, 'Thickness check');
  const hasDimensionCheck = input.hasOverallDimensions;
  const dimensionCheckSec = resolveSec('dimension', hasDimensionCheck ? 1 : 0, 'Overall dimension check');

  const visualBase = getSec('visual_base', 'visual');
  if (!visualBase.dataFound) missingSeed = true;
  featureBreakdown.push({ name: 'Visual pass (base)', timeSec: visualBase.sec, featureType: 'visual_base', count: 1 });

  if (missingSeed) {
    warnings.push('Inspection cycle-time from fallback estimate — seed inspection_operation_defaults for accurate times');
  }

  // Method and resource are two separate decisions — resolved independently,
  // never let one silently borrow the other's rate. `input.cmmRate` is this
  // app's real, dedicated CMM machine rate (see resolveCmmSpecificRate's own
  // doc comment) — it must ONLY be charged when the escalated method
  // actually is 'cmm'. `input.rate` is the mirror-image resolution (see
  // BOMItemsService.resolveGenericInspectionRate) — a real, distinct,
  // non-CMM-named bench/gauge resource (e.g. "Manual Inspection Bench")
  // that DOES exist per-location in mhr_records/mhr_benchmark_rates for
  // visual/caliper/height_gauge tiers; it carries source 'no_db_rate' only
  // when that location genuinely has none. Cycle time (below) is entirely
  // unaffected by this — the feature-driven calculator still produces a
  // real value regardless of whether a costing resource exists for the
  // method it escalated to.
  const rate: MHRRateInput = method === 'cmm'
    ? (input.cmmRate ?? { rate: 0, source: 'no_db_rate', machineClass: 'cmm', machineName: null, commodityCode: null })
    : input.rate;

  return {
    skip: false, method, holesToInspect, bendsToInspect, threadsToInspect,
    visualPassBaseSec: visualBase.sec, holeCheckSec, bendCheckSec, threadGaugeSec,
    hasThicknessCheck, thicknessCheckSec, hasDimensionCheck, dimensionCheckSec,
    amortizeDivisor, featureBreakdown, rate, warnings,
  };
}

/**
 * Stage 4 (cycle time) + cost math + line assembly. Takes the plan from
 * planInspection() and the caller's resolvePhysicsQuantity result for the
 * real "Sheet Metal - Inspection" calculator's 'Total Time' field — no
 * internal fallback sum: an unresolved cycle time means `resolved.gap`
 * carries the real, structured reason and the line still appears with
 * cycleTimeMin 0, never a guessed number.
 */
export function finalizeInspectionLine(input: InspectionInput, plan: InspectionPlan, resolved: InspectionResolvedTime): InspectionResult {
  const warnings = [...plan.warnings];

  if (plan.skip) {
    return { processLines: [], inspectionMethod: null, featuresInspected: { holes: 0, bends: 0, threads: 0 }, warnings };
  }

  let totalSec = 0;
  if (typeof resolved.cycleTimeSec === 'number' && Number.isFinite(resolved.cycleTimeSec)) {
    totalSec = resolved.cycleTimeSec;
  } else if (resolved.gap) {
    const gap = resolved.gap;
    warnings.push(gap.gapType === 'missing_lookup'
      ? `Inspection cycle time unavailable — ${gap.requiredAction}`
      : `Inspection cycle time unavailable — ${gap.reason}`);
  } else {
    warnings.push('Inspection cycle time unavailable — no calculator result and no reported gap (unexpected; check resolvePhysicsQuantity).');
  }

  const cycleTimeMin = (totalSec / 60) / plan.amortizeDivisor;
  const rate = plan.rate;
  if (rate.source === 'no_db_rate') {
    warnings.push(plan.method === 'cmm'
      ? 'No CMM MHR rate in DB — inspection process cost is $0 (machine) + labor only; add a row to mhr_records'
      : `${plan.method} inspection has no dedicated machine/resource rate on file — no such class is registered (visual/caliper/height_gauge inspection has no capital-equipment fleet in mhr_records) — costed at labor-only, machine cost is a genuine $0, not a guess`);
  }
  const runCost = r2((totalSec / 3600 / plan.amortizeDivisor) * rate.rate);
  const qairPerHr = input.qaInspectorRatePerHr ?? 0;
  const laborCost = r2((totalSec / 3600 / plan.amortizeDivisor) * qairPerHr);

  const processLines: ProcessLineCost[] = [{
    process: 'Inspection',
    ...(input.processIdentity ? {
      processGroup: input.processIdentity.processGroup,
      processRoute: input.processIdentity.processRoute,
      operation: input.processIdentity.operation,
    } : {}),
    setupCost: 0,
    runCost: r2(runCost + laborCost),
    totalCost: r2(runCost + laborCost),
    cycleTimeMin: Math.round(cycleTimeMin * 1000) / 1000,
    hourlyRate: rate.rate,
    rateSource: rate.source,
    machineClass: rate.machineClass,
    machineName: rate.machineName,
    commodityCode: rate.commodityCode,
    labourRate: qairPerHr || null,
    mhrId: rate.mhrRecordId ?? null,
    benchmarkMhrId: rate.benchmarkMhrId ?? null,
    featureBreakdown: plan.featureBreakdown,
    ...(resolved.calculatorId ? { calculatorId: resolved.calculatorId } : {}),
    ...(resolved.calculatorVersion != null ? { calculatorVersion: resolved.calculatorVersion } : {}),
    ...(resolved.gap ? { physicsGap: resolved.gap } : {}),
    ...(resolved.confidence ? { confidence: resolved.confidence } : {}),
  }];

  return {
    processLines,
    inspectionMethod: plan.method,
    featuresInspected: { holes: plan.holesToInspect, bends: plan.bendsToInspect, threads: plan.threadsToInspect },
    warnings,
  };
}

// Bootstrap defaults used ONLY when inspection_operation_defaults has no row
// yet for a feature — same disclosed-fallback convention as every other
// sm_lookup_*/lookup-table consumer in this codebase (never silent). Based on
// published general inspection-time ranges (3-12 sec/unit visual inspection
// across multiple industry sources; Ph. Eur. 2.9.20's 5-second visual-pass
// standard; thread go/no-go gauging described industry-wide as "a matter of
// seconds") — no single authoritative per-feature-type standard exists for
// sheet-metal QC specifically, so these are disclosed engineering estimates,
// not a claimed citation for an exact number.
const FALLBACK_SEC: Record<InspectionOperationDefaultRow['feature'], number> = {
  visual_base: 5,
  hole: 1.2,
  bend: 2.0,
  thickness: 3.0,
  dimension: 5.0,
  thread: 4.0,
};
