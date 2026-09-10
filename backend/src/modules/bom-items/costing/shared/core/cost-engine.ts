import {
  TAPPING_SETUP_MIN, MATERIAL_OVERHEAD_PCT, UTILIZATION_ADVISORY_THRESHOLD_PCT,
  RATES_SOURCE_LABEL, DEFAULT_YIELD_PCT,
  COUNTERBORE_SETUP_MIN, COUNTERSINK_SETUP_MIN, PEM_INSERTION_SETUP_MIN,
  BURRING_SETUP_MIN,
  TIGHT_TOLERANCE_REAM_THRESHOLD_MM, REAM_SETUP_MIN,
} from './default-rates.constants';
import type { InspectionResult } from '../process/inspection-engine';
import {
  ENERGY_KWH_PER_HR, GRID_CO2_KG_PER_KWH,
  MATERIAL_CO2_KG_PER_KG, MATERIAL_RECYCLABILITY_PCT,
  SUSTAINABILITY_FACTORS_LABEL,
} from '../physics/sustainability-factors.constants';
import type { NestingResult } from '../../sheet-metal/machine/sheet-metal-nesting.engine';
import type { CostSummaryDto, ProcessLineCost, ProcessCO2, SustainabilitySummaryDto, PhysicsGap, ConfidenceLevel } from '../../../dto/cost-breakdown.dto';
import { computeSurfaceTreatmentLine } from '../process/cost-surface-treatment';
import type { SurfaceTreatmentDbRate } from './default-rates.constants';
export { eMithranTerms } from './engine-kernel';
export type { EMithranTermsArgs, EMithranTermsResult } from './engine-kernel';
// Platform Architecture Remediation Phase 1 (engine registry unification,
// Rule 8) — these 8 secondary-op process lines are now registered,
// independently-tested engines (see manufacturing-process-registry.ts)
// instead of inline math; computeCostSummary() below composes them exactly
// as it composed the inline blocks before extraction.
import { computePressBrakeCost } from '../../sheet-metal/process/press-brake-engine';
import { shouldAddSeparatePressBrakeLine } from './engine-kernel';
import { composeFeatureDrivenOperations, composeOperationSequence } from '../../sheet-metal/operation/feature-driven-operations';
import { computeDeburringCost } from '../../sheet-metal/operation/deburring-engine';
import { computeTappingCost } from '../../sheet-metal/operation/tapping-engine';
import { computeHoleExtrusionCost } from '../../sheet-metal/operation/hole-extrusion-engine';
import { computeCounterboringCost } from '../../sheet-metal/operation/counterboring-engine';
import { computeCountersinkingCost } from '../../sheet-metal/operation/countersinking-engine';
import { computeReamingCost } from '../../sheet-metal/operation/reaming-engine';
import { computePemInsertionCost } from '../../sheet-metal/operation/pem-insertion-engine';
import { computeLaserCuttingCost } from '../../sheet-metal/process/laser-cutting-engine';
import { overlayRejectionReason, type PersistedCostCurrencyBasis } from './persisted-currency-contract';

// P0.6 (Machine Economics, provenance-visibility phase) — mirrors MHRRateInput's
// own `source` tiering, but for the labor-rate side (resolveLHRRates' 4-pass
// resolution in bom-items.service.ts), which previously collapsed to a bare
// number with zero visibility into which pass actually won.
// 'mhr_machine_specific' — this exact machine's own usd_lhr_total
// (mhr_records, sourced from machine_library.json's labor_rate_usd_hr for
// benchmarked rows) — an explicit, approved override that takes precedence
// over the location+process_group lhr_records/lhr_benchmark_rates lookup for
// that specific machine's operations, per user decision 2026-08-27.
// 'wage_grade_bucket' — resolveWageGradeBucketRates (2026-09-03): average
// real usd_lhr_total across all mhr_records rows (this location) sharing
// this class's real, sourced wage_grade value (Sheet Metal: migration 643;
// Injection Molding: migration 645). Used only when no specific machine
// rate exists; sits above the process_group fallback below it in
// precedence.
export type LhrRateSource = 'lhr_database' | 'lhr_benchmark' | 'lhr_cross_location' | 'no_lhr_rate' | 'mhr_machine_specific' | 'wage_grade_bucket';

/**
 * The 3-tier labour-rate precedence (bom-items.service.ts's buildOutput,
 * extracted for isolated unit testing): a specific machine's own real rate
 * always wins; failing that, a real wage-grade bucket average (Sheet
 * Metal/Injection Molding only, where real data exists); failing that, the
 * process_group fallback. Never fabricates a rate — every tier is either a
 * real resolved number or absent, and absence here means the caller has no
 * rate for this class at all (source stays 'no_lhr_rate').
 */
export function resolveLabourRate(
  perMachineLhr: number | null | undefined,
  wageGradeBucketRate: number | null | undefined,
  processGroupRate: { rate: number; source: LhrRateSource } | null | undefined,
): { rate: number | null; source: LhrRateSource } {
  if (perMachineLhr != null) return { rate: perMachineLhr, source: 'mhr_machine_specific' };
  if (wageGradeBucketRate != null) return { rate: wageGradeBucketRate, source: 'wage_grade_bucket' };
  if (processGroupRate != null) return { rate: processGroupRate.rate, source: processGroupRate.source };
  return { rate: null, source: 'no_lhr_rate' };
}

export interface MHRRateInput {
  rate: number;
  source: 'mhr_database' | 'default_rate' | 'no_db_rate' | 'tier_synthetic' | 'benchmark_override';
  machineClass: string;
  machineName: string | null;
  commodityCode: string | null;
  selection?: import('../../../dto/machine-selection.dto').MachineSelectionResult;
  labourRate?: number | null;
  labourRateSource?: LhrRateSource | null;
  // mhr_records.operators for the machine this rate resolved to (via
  // MachineCandidate.operators) — real per-machine operator headcount, used
  // as this operation's setupNDL/cycleNDL instead of a blanket assumption.
  // null when no real machine (class-default fallback) or the field was
  // never set; callers fall back to a generic default, never to 0.
  operators?: number | null;
  // The selected machine's own mhr_records.press_cycle_time_s /
  // handling_time_const_s / handling_time_mass_coeff_s_per_kg (via
  // MachineCandidate — see its own doc comment). Only Standard Press/Tandem
  // Press read these; every other machine class leaves them null.
  pressCycleTimeS?: number | null;
  handlingConstS?: number | null;
  handlingMassCoeffSPerKg?: number | null;
  // The selected machine's own mhr_records.cut_to_length_cycle_const_s /
  // cut_to_length_cycle_mass_coeff_s_per_kg / cut_to_length_cut_speed_s —
  // Cut To Length Line's real linear feed-to-length formula plus its fixed
  // real shear-stroke duration (memory/sheetmetal/machine/machine_library.json,
  // staged into mhr_records.specs by migration 538, promoted to real
  // dedicated columns by migration 724 — same "promote to a real column when
  // a real registered engine consumes it" precedent as migration 608's
  // press_cycle_time_s). Only cut_to_length reads these; every other class
  // leaves them null. handlingConstS/handlingMassCoeffSPerKg above are
  // reused as-is for CTL's own real handling-time formula — same physical
  // concept, same columns, not duplicated.
  cutToLengthCycleConstS?: number | null;
  cutToLengthCycleMassCoeffSPerKg?: number | null;
  cutToLengthCutSpeedS?: number | null;
  // The selected machine's own mhr_records.setup_time_hr (via
  // MachineCandidate — see its own doc comment). Generic across any class;
  // Compression Molding / Reaction Injection Molding are the first real
  // consumers (2026-09-02) since they have no per-operation setup-time
  // lookup table the way Sheet Metal classes do.
  setupTimeHr?: number | null;
  /**
   * The two components the canonical MHR is DEFINED as (migration 581:
   * MHR = Direct Overhead + Indirect Overhead). Present so the benchmark
   * override guard can recognise a rate that IS that canonical sum and
   * therefore cannot be a mis-scaled import — see
   * applyBenchmarkOverrideIfNeeded in bom-items.service.ts.
   */
  directOverheadRate?: number | null;
  indirectOverheadRate?: number | null;
  // The selected machine's own MachineCandidate.laborRateUsdHr (raw, before
  // buildOutput applies precedence against the process-group lhrRates map) —
  // never read directly by cost-engine.ts; buildOutput folds it into the
  // final labourRate/labourRateSource below.
  machineLaborRateUsdHr?: number | null;
  // Real mhr_records row id, when this rate came from the user's own imported
  // fleet (resolveCmmSpecificRate/resolveGenericInspectionRate's realCmm/
  // realBench branches) — lets a persisted process_cost_records row link back
  // to it as mhrId, same as every machineSelection-based class already can.
  mhrRecordId?: string | null;
  // 'bm-mhr-<id>' — mhr_benchmark_rates row id, prefixed exactly like
  // mhr.service.ts#getBenchmarkRates() already does, when this rate came from
  // the benchmark fallback instead of a real imported machine. Without either
  // id, an Inspection line resolved to a real, priced resource still had no
  // way to be saved as anything but "not linked to a machine".
  benchmarkMhrId?: string | null;
}

export interface CostEngineInput {
  // ── Geometry ─────────────────────────────────────────────────────────────
  sheetThicknessMm: number;
  cutLengthMm: number;
  pierceCount: number;
  bendCount: number;
  flatPatternAreaMm2: number;
  holeCount: number;

  // ── Flat-pattern dimensions (for nesting) ─────────────────────────────────
  flatPatternLengthMm?: number;
  flatPatternWidthMm?: number;

  // ── Bend geometry ─────────────────────────────────────────────────────────
  bendLengthMm?: number;          // total bending line length (default: bendCount × 200)
  shoulderWidthMm?: number;       // V-die opening (default: 8 × thickness)

  // ── Part complexity ────────────────────────────────────────────────────────
  partComplexity?: 'simple' | 'medium' | 'complex';

  // ── Material ───────────────────────────────────────────────────────────────
  materialGrade: string | null;
  materialCostPerKg: number;
  materialDensityKgM3: number;
  materialSource: 'db' | 'default';
  utsMpa?: number | null;         // from raw_materials (for tonnage calc); null when unavailable
  shearStrengthMpa?: number | null; // from raw_materials (for part allowance); null when unavailable
  scrapPricePerKg?: number;       // from raw_materials

  // ── Labor rates ────────────────────────────────────────────────────────────
  directLaborRatePerHr?: number;  // DLR — from lhr_records
  qaInspectorRatePerHr?: number;  // QAIR — from lhr_records

  // ── Yield ─────────────────────────────────────────────────────────────────
  yieldPct?: number;              // default 0.98

  // ── Machine attributes ─────────────────────────────────────────────────────
  laserPowerW?: number;           // from mhr_records specs
  machineOperators?: number;      // nDL from mhr_records (default 1)

  // ── Pre-resolved DB lookups ────────────────────────────────────────────────
  handlingTimeMin?: number;       // Table 2 for sheet weight
  toolSetupPressMin?: number;     // Table 3A for press tonnage
  toolSetupBrakeMin?: number;     // Table 3B for brake tool length
  samplingRate?: number;          // Table 6 fraction
  inspectionTimeMin?: number;     // Table 7 per-piece minutes, by complexity tier
  // Real per-batch setup time (min) from sm_lookup_op_setup_time (migration
  // 416), resolved by the caller via SheetMetalLookupService.getOpSetupTimes()
  // + resolveOpSetupMin() for each key present. A key absent from this map
  // falls back to that operation's own default-rates.ts constant — the
  // caller has already pushed a disclosed warning for any key it fell back
  // on (same convention as handlingTimeMin/toolSetupBrakeMin/samplingRate).
  /**
   * Real per-operation setup minutes from sm_lookup_op_setup_time, or `null`
   * for an operation with no row. Null, not 0 — resolveSetupMinutes treats 0 as
   * "never populated" and falls through, and encoding the absence as a real
   * quantity is what let a press line charge $0.00 setup.
   */
  opSetupMinByOp?: Partial<Record<'tapping' | 'counterbore' | 'countersink' | 'pem_insertion' | 'burring' | 'ream', number | null>>;

  // ── Calculator-evaluated cycle times (single source of truth) ─────────────
  // Manufacturing Physics Calculator architecture: resolved by the caller via
  // bom-items.service.ts's resolvePhysicsQuantity (the one shared entry point
  // every process's cycle time must go through — no second implementation).
  // Undefined (never a fallback number) when the calculator couldn't resolve
  // one — in that case `laserPhysicsGap`/`pressBrakePhysicsGap` carries the
  // real, structured reason (missing lookup row, or no calculator at all).
  // This engine no longer has its own inline "last resort" arithmetic for
  // these two processes — see the Laser Cutting / Press Brake blocks below.
  laserCycleTimeSecFromCalculator?: number;
  laserCalculatorId?: string | null;
  laserCalculatorVersion?: number | null;
  laserPhysicsGap?: PhysicsGap | null;
  laserConfidence?: ConfidenceLevel;
  pressBrakeCycleTimeSecFromCalculator?: number;
  pressBrakeSetupTimeMinFromCalculator?: number;
  pressBrakeCalculatorId?: string | null;
  pressBrakeCalculatorVersion?: number | null;
  pressBrakePhysicsGap?: PhysicsGap | null;
  pressBrakeConfidence?: ConfidenceLevel;
  tappingCycleTimeSecFromCalculator?: number;
  tappingCalculatorId?: string | null;
  tappingCalculatorVersion?: number | null;
  tappingPhysicsGap?: PhysicsGap | null;
  tappingConfidence?: ConfidenceLevel;
  deburrCycleTimeSecFromCalculator?: number;
  deburrCalculatorId?: string | null;
  deburrCalculatorVersion?: number | null;
  deburrPhysicsGap?: PhysicsGap | null;
  deburrConfidence?: ConfidenceLevel;
  counterboreCycleTimeSecFromCalculator?: number;
  counterboreCalculatorId?: string | null;
  counterboreCalculatorVersion?: number | null;
  counterborePhysicsGap?: PhysicsGap | null;
  counterboreConfidence?: ConfidenceLevel;
  countersinkCycleTimeSecFromCalculator?: number;
  countersinkCalculatorId?: string | null;
  countersinkCalculatorVersion?: number | null;
  countersinkPhysicsGap?: PhysicsGap | null;
  countersinkConfidence?: ConfidenceLevel;

  // ── Nesting result (pre-resolved) ─────────────────────────────────────────
  nestingResult?: NestingResult;

  // ── Threads & scenario ────────────────────────────────────────────────────
  // pitchMm/depthMm/isThrough are real when known (drawing OCR always gives
  // pitch; CAD-detected tapped holes always give depth+isThrough) — undefined
  // when genuinely not extracted, never fabricated. computeTapCycleSec()
  // falls back to a documented standard assumption only when missing.
  threads: Array<{ size: string; count: number; pitchMm?: number; depthMm?: number; isThrough?: boolean }>;
  batchSize: number;
  family: string;

  // ── Feature-driven secondary hole operations ──────────────────────────────
  // Pre-resolved (aggregated + DB-looked-up) by the caller — cost-engine.ts stays
  // a pure calculation module with no DB access. Each op is additive: it does NOT
  // remove time from the laser-cutting line, matching real shop routing (the
  // laser/punch still pierces every hole; these are secondary operations layered
  // on top). See backend/migrations/381_sheet_metal_feature_routing.sql and
  // SheetMetalFeatureExtractorService.buildHoleFeatures() for how subtype counts
  // are derived from the CAD engine's counterbore/countersink detection.
  counterboreCount?: number;
  countersinkCount?: number;
  pemCount?: number;
  pemCycleTimeSecFromCalculator?: number;
  pemCalculatorId?: string | null;
  pemCalculatorVersion?: number | null;
  pemPhysicsGap?: PhysicsGap | null;
  pemConfidence?: ConfidenceLevel;
  pemPartSpecs?: string[];
  // Hole extrusion (burring) — extruded hole flange formed before tapping (see
  // drawing callouts like "2X M3 BURLING BACK CONVEX"). Cycle time comes from
  // the real "Sheet Metal - Hole Extrusion (Burring)" DB calculator only, via
  // resolvePhysicsQuantity — cost-engine.ts stays DB-free.
  extrudedFlangeCount?: number;
  burringCycleTimeSecFromCalculator?: number;
  burringCalculatorId?: string | null;
  burringCalculatorVersion?: number | null;
  burringPhysicsGap?: PhysicsGap | null;
  burringConfidence?: ConfidenceLevel;
  // Tight-tolerance → Drill + Ream. Part-level approximation:
  // drawing_intelligence.tightestToleranceMm is a single part-wide value (no
  // per-hole GD&T linkage exists yet), so when it triggers, ALL holes on the part
  // are treated as ream candidates rather than just the toleranced one(s).
  tightestToleranceMm?: number | null;
  // Reaming cycle time — real "Machining - Reaming" DB calculator only, via
  // resolvePhysicsQuantity (real HSS reaming speed/feed data — see
  // default-rates.ts's REAM_SURFACE_SPEED_M_MIN_BY_MATERIAL for citations).
  reamCycleTimeSecFromCalculator?: number;
  reamCalculatorId?: string | null;
  reamCalculatorVersion?: number | null;
  reamPhysicsGap?: PhysicsGap | null;
  reamConfidence?: ConfidenceLevel;

  // General-purpose Inspection line (see costing/inspection-engine.ts) — fully
  // resolved by the caller: planInspection() (sampling/method/per-feature
  // time) + resolvePhysicsQuantity (the real "Sheet Metal - Inspection" DB
  // calculator's Total Time) + finalizeInspectionLine() (cost math + line
  // assembly), before computeCostSummary ever runs. This engine stays DB-free
  // and just consumes the resolved processLines/warnings — undefined skips
  // the Inspection line entirely (e.g. a non-sheet-metal family this engine
  // isn't used for).
  inspectionResult?: InspectionResult;

  // ── MHR rates ─────────────────────────────────────────────────────────────
  mhrRates?: {
    laser: MHRRateInput;
    pressBrake: MHRRateInput;
    deburring: MHRRateInput;
    tapping: MHRRateInput;
    drillPress?: MHRRateInput;
    pemPress?: MHRRateInput;
    holeForming?: MHRRateInput;
    inspection?: MHRRateInput;
  };

  // ── Costing location (for location-aware LHR fallback) ────────────────────
  location?: string;

  // ── Surface treatment (anodize / powder coat / plating) ──────────────────
  surfaceAreaMm2?: number;            // from bom_items.surface_area (OCC 3D surface area)
  surfaceTreatment?: string | null;   // callout from drawing / bom_items.coating
  surfaceTreatmentDbRate?: SurfaceTreatmentDbRate | null;

  // ── Process identity, resolved by the caller from process_calculator_mappings
  // (never hardcoded here) — keyed by machine_class so each process line can state
  // its real (processGroup, processRoute, operation) instead of leaving consumers
  // to reuse the cosmetic `process` display label as a fake operation. Caller
  // queries `SELECT process_group, process_route, operation FROM
  // process_calculator_mappings WHERE machine_class = $1 AND is_active` and picks
  // one representative row per class (e.g. lowest display_order) — see
  // BomItemsService.resolveProcessIdentities().
  processIdentityByMachineClass?: Record<string, { processGroup: string; processRoute: string; operation: string }>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function r2(n: number): number { return Math.round(n * 100) / 100; }
function r3(n: number): number { return Math.round(n * 1000) / 1000; }
// cycleTimeMin is rounded here in MINUTES, but every UI display converts it to
// SECONDS (formatCycleMin: min*60) for anything under a minute — the overwhelming
// majority of these part-level cycle times. r2's 0.01 min ≈ 0.6 sec resolution is
// coarser than the 0.1 sec resolution the seconds display itself rounds to, so it
// can flip the final displayed second (e.g. a true 1.8775 sec correctly rounds to
// "1.9 s", but pre-rounding to r2 → 0.03 min gives exactly 1.80 sec instead) —
// a real double-rounding bug, not a cosmetic one, since anything reading this raw
// cycleTimeMin (a standalone calculator re-deriving cycle time from the same
// physics, an export, etc.) silently disagrees with the UI by up to ~0.3 sec.
// r3's 0.001 min = 0.06 sec resolution is finer than the 0.1 sec display bucket,
// so it can no longer change which second the display rounds to.
function rTime(n: number): number { return r3(n); }

// ── Sustainability (unchanged logic) ──────────────────────────────────────────

export function computeSustainability(
  materialGrade: string | null,
  materialCostPerKg: number,
  netWeightKg: number,
  grossWeightKg: number,
  batchSize: number,
  processLines: ProcessLineCost[],
): SustainabilitySummaryDto {
  const grade = (materialGrade ?? '__default__').toUpperCase();

  const scrapKg = r3(grossWeightKg - netWeightKg);
  const wasteCostInr = r2(scrapKg * materialCostPerKg);
  const materialUtilizationPct = r2(grossWeightKg > 0 ? (netWeightKg / grossWeightKg) * 100 : 0);

  const embodiedCo2PerKg = MATERIAL_CO2_KG_PER_KG[grade] ?? MATERIAL_CO2_KG_PER_KG['__default__']!;
  const materialCo2Kg = r3(grossWeightKg * embodiedCo2PerKg);
  const materialCo2PerKg = r3(embodiedCo2PerKg);
  const materialCo2Source: 'lookup' | 'default' = MATERIAL_CO2_KG_PER_KG[grade] != null ? 'lookup' : 'default';

  const processCo2Breakdown: ProcessCO2[] = processLines.map((l) => {
    const kwhPerHr = ENERGY_KWH_PER_HR[l.machineClass] ?? 4.0;
    const energyKwh = r3((l.cycleTimeMin / 60) * kwhPerHr);
    const co2Kg = r3(energyKwh * GRID_CO2_KG_PER_KWH);
    return { process: l.process, machineClass: l.machineClass, energyKwh, co2Kg };
  });

  const totalProcessEnergyKwh = r3(processCo2Breakdown.reduce((s, p) => s + p.energyKwh, 0));
  const totalProcessCo2Kg = r3(processCo2Breakdown.reduce((s, p) => s + p.co2Kg, 0));
  const totalCo2Kg = r3(materialCo2Kg + totalProcessCo2Kg);
  const co2PerKgPart = r3(netWeightKg > 0 ? totalCo2Kg / netWeightKg : 0);
  const recyclabilityPct = MATERIAL_RECYCLABILITY_PCT[grade] ?? MATERIAL_RECYCLABILITY_PCT['__default__']!;

  const allContributors = [
    { label: 'Material Production', co2Kg: materialCo2Kg },
    ...processCo2Breakdown.map((p) => ({ label: p.process, co2Kg: p.co2Kg })),
  ];
  const co2Contributors = allContributors
    .sort((a, b) => b.co2Kg - a.co2Kg)
    .map((c) => ({
      label: c.label,
      co2Kg: r3(c.co2Kg),
      pct: r2(totalCo2Kg > 0 ? (c.co2Kg / totalCo2Kg) * 100 : 0),
    }));

  const matScore    = (materialUtilizationPct / 100) * 30;
  const co2Score    = Math.max(0, 30 - co2PerKgPart * 3);
  const recyclScore = (recyclabilityPct / 100) * 20;
  const energyScore = Math.max(0, 20 - totalProcessEnergyKwh * 4);
  const sustainabilityScore = Math.round(Math.min(100, matScore + co2Score + recyclScore + energyScore));
  const scoreBreakdown = {
    materialEfficiency: Math.round(matScore * 10) / 10,
    carbonIntensity:    Math.round(co2Score * 10) / 10,
    recyclability:      Math.round(recyclScore * 10) / 10,
    processEnergy:      Math.round(energyScore * 10) / 10,
  };

  const opportunities: string[] = [];
  if (materialUtilizationPct < 90) {
    opportunities.push(`Improve nesting layout — ${(100 - materialUtilizationPct).toFixed(0)}% scrap overhead currently`);
  }
  if (totalCo2Kg > 0 && materialCo2Kg / totalCo2Kg > 0.60) {
    opportunities.push(`Material production is ${Math.round((materialCo2Kg / totalCo2Kg) * 100)}% of total CO₂ — consider recycled-content steel`);
  }
  if (totalProcessEnergyKwh > 2.0) {
    opportunities.push(`High process energy (${totalProcessEnergyKwh.toFixed(2)} kWh) — review process sequence for consolidation`);
  }
  if (batchSize < 10) {
    opportunities.push(`Small batch (${batchSize} pcs) spreads setup energy across fewer parts — increase batch size`);
  }
  if (!opportunities.length) {
    opportunities.push('No significant improvement opportunities identified at current parameters');
  }

  return {
    netWeightKg: r3(netWeightKg),
    scrapKg,
    wasteCostInr,
    materialUtilizationPct,
    materialCo2Kg,
    materialCo2PerKg,
    materialCo2Source,
    processCo2Breakdown,
    totalProcessEnergyKwh,
    totalProcessCo2Kg,
    totalCo2Kg,
    co2PerKgPart,
    co2Contributors,
    recyclabilityPct,
    sustainabilityScore,
    scoreBreakdown,
    opportunities,
    factorsSource: SUSTAINABILITY_FACTORS_LABEL,
  };
}

// eMithranTerms() itself moved to engine-kernel.ts (Platform Architecture
// Remediation Phase 1) — imported above, so both this file's 9 inline blocks
// and every registered ManufacturingProcessEngine share one formula core.

// ── Main export ───────────────────────────────────────────────────────────────

export function computeCostSummary(input: CostEngineInput): CostSummaryDto {
  const {
    sheetThicknessMm, cutLengthMm, pierceCount, bendCount,
    flatPatternAreaMm2, materialGrade, materialCostPerKg,
    materialDensityKgM3, materialSource, threads, batchSize, family,
    nestingResult,
    handlingTimeMin = 0.25,
    toolSetupBrakeMin = 10,
    // 0, not a sampling percentage. This defaulted to 0.08, so a caller that
    // omitted it silently inspected 8% of every batch and multiplied that into
    // the QA term of every process line. Sampling comes from
    // sm_lookup_sampling_plan, which already returns { rate: 0, dataFound:
    // false } when it has no row for a batch size — a real gap, disclosed, and
    // costing nothing. Every operation engine already uses `?? 0` for the same
    // reason; this was the one place that guessed instead.
    samplingRate = 0,
    inspectionTimeMin = 0.5,
    opSetupMinByOp,
    directLaborRatePerHr,
    qaInspectorRatePerHr,
    yieldPct = DEFAULT_YIELD_PCT,
    machineOperators = 1,
    scrapPricePerKg = 0,
  } = input;

  const warnings: string[] = [];
  const processLines: ProcessLineCost[] = [];

  const location = input.location;
  if (!location) {
    warnings.push('No factory location set — rates cannot be location-adjusted; configure your digital factory location in Settings');
  }

  const dlrPerHr  = directLaborRatePerHr  ?? 0;
  const qairPerHr = qaInspectorRatePerHr  ?? 0;

  if (directLaborRatePerHr == null) {
    warnings.push(`No direct labor rate in DB for ${location ?? 'this location'} (Sheet Metal) — labor cost excluded from quote; add rows to lhr_records`);
  }
  if (qaInspectorRatePerHr == null) {
    warnings.push(`No QA inspector rate in DB for ${location ?? 'this location'} — inspection labor excluded from quote; add rows to lhr_records`);
  }

  // MHR: when no DB machine exists, rate is 0 and source is 'no_db_rate'.
  // Warnings are emitted at each usage point (only when that operation is actually present).
  const laserRate   = input.mhrRates?.laser      ?? { rate: 0, source: 'no_db_rate' as const, machineClass: 'fiber_laser',  machineName: null, commodityCode: null };
  const pbRate      = input.mhrRates?.pressBrake ?? { rate: 0, source: 'no_db_rate' as const, machineClass: 'press_brake',  machineName: null, commodityCode: null };
  const deburrRate  = input.mhrRates?.deburring  ?? { rate: 0, source: 'no_db_rate' as const, machineClass: 'deburring',    machineName: null, commodityCode: null };
  const tappingRate = input.mhrRates?.tapping    ?? { rate: 0, source: 'no_db_rate' as const, machineClass: 'tapping',      machineName: null, commodityCode: null };

  if (!materialGrade) warnings.push('Material grade not set — default mild steel rates applied');
  if (flatPatternAreaMm2 === 0) warnings.push('Flat pattern area is 0 — material cost may be inaccurate');
  if (sheetThicknessMm === 0) warnings.push('Sheet thickness is 0 — cycle time lookups may be inaccurate');

  // ── Material cost ─────────────────────────────────────────────────────────
  const volumeMm3 = flatPatternAreaMm2 * sheetThicknessMm;
  const netWeightKg = (volumeMm3 / 1e9) * materialDensityKgM3;

  let materialCost: number;
  let grossWeightKg: number;

  if (nestingResult) {
    // eMithran nesting path — use nesting-derived gross weight
    materialCost = nestingResult.netMaterialCost;
    grossWeightKg = nestingResult.grossWeightPerPartKg;
    if (nestingResult.utilisationPct < UTILIZATION_ADVISORY_THRESHOLD_PCT) {
      warnings.push(
        `Material utilisation ${nestingResult.utilisationPct}% (${nestingResult.partsPerSheet} parts/sheet on ` +
        `${nestingResult.sheetWidthMm}×${nestingResult.sheetLengthMm}mm, true-shape nest) -- below the ` +
        `${UTILIZATION_ADVISORY_THRESHOLD_PCT}% guideline. This can be normal for an irregular flat pattern ` +
        `and is already reflected in the material cost; panel nesting may improve yield if the geometry allows it.`,
      );
    }
  } else {
    // Fallback: volume-based gross weight
    grossWeightKg = netWeightKg * (1 + MATERIAL_OVERHEAD_PCT / 100);
    materialCost = grossWeightKg * materialCostPerKg;
  }

  // netMaterialCost for yield formula: what we paid for material for this part
  const netMatCost = materialCost;

  // ── Laser cutting ─────────────────────────────────────────────────────────
  // Manufacturing Physics Calculator architecture: cycle time comes from the
  // real "Sheet Metal - Laser Cutting Manufacturing" DB calculator ONLY, via
  // bom-items.service.ts's resolvePhysicsQuantity (`laserCycleTimeSecFromCalculator`)
  // — the same shared evaluator the interactive "Edit Process Cost" dialog
  // uses, so this engine and that dialog can never silently disagree. There
  // is no second, independent formula here anymore: when the calculator
  // can't resolve a value (no seeded sm_lookup_laser_cut row for this
  // material/thickness/power, or no calculator registered at all),
  // `laserPhysicsGap` carries the real, structured reason and this line is
  // still emitted (never silently omitted) with cycleTimeMin 0 and that gap
  // attached — never a guessed speed.
  // Setup: program recall time + sheet handling per lot. partsPerSheet from
  // nesting; default 4 if nesting not run. Raw (un-amortized) per-batch
  // minutes — computeLaserCuttingCost does its own /batchSize division
  // internally, same convention as its opSetupMin-driven callers.
  const partsPerSheet = nestingResult?.partsPerSheet ?? 4;
  const sheetsPerLot = Math.ceil(batchSize / partsPerSheet);
  const laserSetupMin = handlingTimeMin * sheetsPerLot;

  // Platform Architecture Remediation Phase 1 — this is the one directly
  // authorized fix: computeCostSummary() now calls the exact same registered
  // LaserCuttingEngine formula (computeLaserCuttingCost, laser-cutting-
  // engine.ts) that getRouteComparison() already uses, instead of
  // reimplementing the eMithranTerms composition inline. Two call paths, one
  // formula — closes the divergence where this line used to include
  // inspection-sampling/yield-loss cost in the primary quote but not in the
  // route-comparison/applied-route path (see engine-kernel.ts's doc comment).
  const laserResult = computeLaserCuttingCost({
    cutLengthMm, pierceCount, batchSize,
    grade: materialGrade,
    laserRate,
    sheetThicknessMm,
    cuttingSecFromCalculator: input.laserCycleTimeSecFromCalculator,
    calculatorId: input.laserCalculatorId,
    calculatorVersion: input.laserCalculatorVersion,
    physicsGap: input.laserPhysicsGap,
    confidence: input.laserConfidence,
    processIdentity: input.processIdentityByMachineClass?.[laserRate.machineClass],
    setupMin: laserSetupMin,
    dlrPerHr, qairPerHr, inspTimeMin: inspectionTimeMin, samplingRate, yieldPct,
    netMatCost, netWeightKg, scrapPricePerKg,
  });
  warnings.push(...laserResult.warnings);
  processLines.push(...laserResult.processLines);
  const laserMin = laserResult.cuttingMin;

  // ── Feature-driven operations — the canonical composer ────────────────────
  // Which secondary operations this part needs, and in what order, is decided
  // in exactly one place now: composeFeatureDrivenOperations(). This function
  // used to assemble all nine inline while getRouteComparison() independently
  // assembled four of them, so the same part had two different operation
  // sequences and two different totals depending on which path you looked at.
  // The engines, their gating on real feature counts, and every formula are
  // unchanged — only the ownership of the composition moved.
  const featureDriven = composeFeatureDrivenOperations(input, {
    dlrPerHr, qairPerHr, inspTimeMin: inspectionTimeMin, samplingRate, yieldPct,
    netMatCost, netWeightKg, scrapPricePerKg,
  });
  warnings.push(...featureDriven.warnings);
  const tappingMin = featureDriven.cycleMinutes.tappingMin;
  const deburrMin = featureDriven.cycleMinutes.deburrMin;

  // ── Press brake ───────────────────────────────────────────────────────────
  // Manufacturing Physics Calculator architecture: cycle time and setup time
  // come from the real "Sheet Metal - Bending Manufacturing" DB calculator
  // ONLY, via bom-items.service.ts's resolvePhysicsQuantity
  // (`pressBrakeCycleTimeSecFromCalculator`/`pressBrakeSetupTimeMinFromCalculator`)
  // — the same shared evaluator the interactive "Edit Process Cost" dialog
  // uses, so this engine and that dialog can never silently disagree. There
  // is no second, independent formula here anymore: when the calculator
  // can't resolve a value (no seeded sm_lookup_manual_stroke row for this
  // thickness/tonnage/complexity, or no calculator registered at all),
  // `pressBrakePhysicsGap` carries the real, structured reason and this line
  // is still emitted (never silently omitted) with cycleTimeMin 0 and that
  // gap attached — never a guessed per-bend constant.
  const pressBrakeResult = computePressBrakeCost({
    bendCount, batchSize,
    rate: pbRate,
    processIdentity: input.processIdentityByMachineClass?.[pbRate.machineClass],
    cycleTimeSecFromCalculator: input.pressBrakeCycleTimeSecFromCalculator,
    setupTimeMinFromCalculator: input.pressBrakeSetupTimeMinFromCalculator,
    fallbackSetupMin: toolSetupBrakeMin,
    calculatorId: input.pressBrakeCalculatorId,
    calculatorVersion: input.pressBrakeCalculatorVersion,
    physicsGap: input.pressBrakePhysicsGap,
    confidence: input.pressBrakeConfidence,
    dlrPerHr, qairPerHr, inspTimeMin: inspectionTimeMin, samplingRate, yieldPct,
    netMatCost, netWeightKg, scrapPricePerKg,
  });
  warnings.push(...pressBrakeResult.warnings);
  // NOT pushed here — it is the route's core forming step and is placed into
  // the sequence below, so pushing it here too would double-charge bending.
  const pressBrakeMin = pressBrakeResult.cycleTimeMin;

  // The route's core operations with the feature-driven ones placed around
  // them — the one canonical final operation sequence. Sheet metal's primary
  // quote path always bends on a press brake, so it is always the core forming
  // step here; a forming route (which bends in-process) passes none.
  processLines.push(...composeOperationSequence({
    coreCutting: [],
    coreForming: pressBrakeResult.processLines,
    featureDriven,
  }));


  const totalProcessCost = processLines.reduce((s, l) => s + l.totalCost, 0);
  const totalCost = materialCost + totalProcessCost;

  const roundedLines = processLines.map((l) => ({
    ...l,
    setupCost: r2(l.setupCost),
    runCost: r2(l.runCost),
    totalCost: r2(l.totalCost),
    hourlyRate: r2(l.hourlyRate),
    rateSource: l.rateSource,
  }));

  const sustainability = computeSustainability(
    materialGrade,
    materialCostPerKg,
    netWeightKg,
    grossWeightKg,
    batchSize,
    roundedLines,
  );

  return {
    materialCost: r2(materialCost),
    materialGrade: materialGrade ?? 'Unknown',
    grossWeightKg: r3(grossWeightKg),
    materialCostPerKg,
    materialSource,
    processLines: roundedLines,
    totalProcessCost: r2(totalProcessCost),
    totalCost: r2(totalCost),
    cycleTimes: {
      laserMin: rTime(laserMin),
      pressBrakeMin: rTime(pressBrakeMin),
      tappingMin: rTime(tappingMin),
      deburrMin: rTime(deburrMin),
      totalMin: rTime(laserMin + pressBrakeMin + tappingMin + deburrMin),
    },
    batchSize,
    family,
    warnings,
    ratesSource: RATES_SOURCE_LABEL,
    sustainability,
  };
}

// P0.2 — one authoritative applied-quote path. process_cost_records is
// already treated as the applied-quote authority everywhere else in this
// codebase (the Manufacturing Process section's own CRUD, Excel export Sheet
// 1, BOM/project cost rollups, the AI assistant's cost tool) — every one of
// them reads it back once a route has been applied, rather than trusting a
// fresh live recompute. computeCostSummary() above is the one exception: it
// unconditionally fabricates a Laser Cutting line for the sheet_metal
// family's cutting operation, with no awareness that Turret Punch, Waterjet,
// or a manually-edited Press Brake row might actually be what was applied
// and persisted. This function is the fix: given the summary
// computeCostSummary() just produced (the pre-apply preview) and whatever
// active process_cost_records rows exist for this part's cutting/bending
// operations, it overrides those specific lines with the real, persisted,
// already-authoritative values — the same computeCost() result
// getRouteComparison()/apply-route already wrote, read back rather than
// recomputed a second time. No new live calculation path is introduced.
//
// Scoped to exactly the two operation families where a live-vs-persisted
// divergence is possible: cutting (fiber_laser/co2_laser/turret_punch/
// waterjet — mutually exclusive alternatives for the same operation) and
// press_brake (independently overridable via the Edit Process Cost dialog).
// Every other resolvePhysicsQuantity-driven line (tapping, PEM, deburr, ...)
// already uses the identical calculator call in both computeCostSummary()
// and getRouteComparison(), so no divergence exists there and they're left
// untouched. When neither family has an active row (true pre-apply state,
// nothing has ever been applied), this function is a no-op and the live
// preview from computeCostSummary() is returned unchanged.
export interface AppliedProcessCostRecord {
  machine_class: string;
  machine_name: string | null;
  mhr_id: string | null;
  operation: string | null;
  process_group: string | null;
  process_route: string | null;
  cycle_time: number;   // seconds (process_cost_records.cycle_time convention)
  setup_time: number;   // minutes (process_cost_records.setup_time convention)
  direct_rate: number;
  setup_cost_per_part: number;
  total_cycle_cost_per_part: number;
  total_cost_per_part: number;
  // Added for complete-generation authority. Optional because
  // applyPersistedRouteToSummary itself never reads them -- only
  // selectAppliedGeneration does, and it treats a missing value as
  // "cannot establish", which fails closed.
  op_nbr?: number | null;
  currency?: string | null;
  cost_currency_basis?: PersistedCostCurrencyBasis | null;
  batch_size?: number | string | null;
  location?: string | null;
  notes?: string | null;
  /**
   * Costed-operation provenance (migration 718). Optional because every row
   * written before it is NULL here, and a reader must degrade to the legacy
   * interpretation rather than treat absence as a value.
   *
   * line_hourly_rate exists because direct_rate does not have one meaning in
   * this table: across live active rows it is variously machine + labour
   * (Face milling 2600 + 36.21 = 2636.21), the machine rate alone (Laser Cut
   * 19.227545 against a machine_rate of 19.00), or neither (Inspect, 0 beside a
   * real 46.67 labour rate). ProcessLineCost.hourlyRate is unambiguously the
   * MACHINE rate -- eMithranTerms takes mhrPerHr and dlrPerHr separately -- so
   * a column that means exactly that had to be added rather than elected.
   */
  line_hourly_rate?: number | string | null;
  line_labour_rate?: number | string | null;
  engine_version?: string | null;
  setup_time_source?: ProcessLineCost['setupTimeSource'] | null;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Applied-generation authority
 *
 * An applied route is a COMPLETE costing snapshot. Before this, the Cost Guide
 * overlaid only the operations whose machine_class appeared in
 * getRouteCoreProcessClasses() -- 17 cutting/forming classes plus press_brake --
 * and recomputed every secondary operation (deburring, PEM, inspection) live on
 * each request.
 *
 * Measured on a real applied route (item 83e8d472, sm-standard-press):
 *
 *   op10 standard_press  persisted 0.283693  live 0.283693   overlaid
 *   op20 deburring       persisted 0.300000  live 0.300000   recomputed
 *   op30 pem_press       persisted 0.240000  live 0.240000   recomputed
 *   op40 cmm             persisted 0.210000  live 0.390000   recomputed  <-- 0.18
 *                                            ----------------------------------
 *   persisted total 1.033693   Cost Guide total 1.213693   delta 0.180000
 *
 * The whole delta was one operation: the persisted CMM row captured
 * machine_rate = 0, while the engine later resolved an existing $40/hr USA
 * inspection-bench benchmark. Cycle time was identical in both (16.2 s), so
 * 16.2/3600 x 40 = 0.18 exactly.
 *
 * Two operations agreed by luck, which is what made the mixture dangerous: it
 * looked correct until any input behind a secondary operation moved. A quote
 * cannot be part snapshot and part live recompute.
 *
 * So the generation is now authoritative in full, and a rate that resolves
 * differently later does NOT change an applied quote. Re-apply is the explicit
 * refresh.
 * ──────────────────────────────────────────────────────────────────────────── */

export interface AppliedGenerationContext {
  /** Currency the summary was computed in -- the factory local currency. */
  summaryCurrency: string;
  /** Batch size the current request resolved. */
  resolvedBatchSize: number;
  /** Location the current request resolved. */
  resolvedLocation: string;
}

export type AppliedGenerationVerdict =
  | { usable: true; rows: AppliedProcessCostRecord[]; tag: string }
  | { usable: false; reason: string };

/**
 * The notes tag applyRoute / applyCustomRoute stamps on every row it writes.
 * A row without one was not produced by applying a route -- it is a manually
 * created record, and a set of those is not a route snapshot.
 */
const appliedRouteTag = (notes: string | null | undefined): string | null =>
  typeof notes === 'string' && /^auto_fill_from_(custom_)?route:/.test(notes) ? notes : null;

const numOrNull = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
};

/**
 * Decide whether the active rows form one applied-route generation that may be
 * treated as authoritative, or nothing at all.
 *
 * Deliberately all-or-nothing. Returning a partial set would reintroduce the
 * hybrid persisted/live cost model this exists to remove, so anything
 * unestablished makes the whole generation unusable and the caller keeps the
 * live summary -- one coherent answer either way, with a reason that can be
 * surfaced.
 */
export function selectAppliedGeneration(
  rows: readonly AppliedProcessCostRecord[],
  ctx: AppliedGenerationContext,
): AppliedGenerationVerdict {
  if (rows.length === 0) return { usable: false, reason: 'no active process cost records' };

  // 1. One applied-route generation, and nothing else mixed in. This is what
  //    stops an unrelated manually created row from being treated as a route
  //    snapshot -- and manual rows are the majority of this table.
  const tags = rows.map((r) => appliedRouteTag(r.notes));
  const manual = tags.filter((t) => t === null).length;
  if (manual > 0) {
    return {
      usable: false,
      reason: `${manual} of ${rows.length} active operations were not written by applying a route ` +
        `(no auto_fill_from_route tag) -- not a route snapshot`,
    };
  }
  const distinctTags = [...new Set(tags as string[])];
  if (distinctTags.length > 1) {
    return { usable: false, reason: `active rows span ${distinctTags.length} generations: ${distinctTags.join(', ')}` };
  }

  // 2. Complete: every operation must carry the cost the engine charged. A NULL
  //    means the operation was never costed (apply-custom-route persists those
  //    deliberately), and a snapshot missing a price is not a quote.
  const uncosted = rows.filter((r) => numOrNull(r.total_cost_per_part) === null);
  if (uncosted.length > 0) {
    return {
      usable: false,
      reason: `${uncosted.length} of ${rows.length} operations have no persisted cost ` +
        `(${uncosted.map((r) => r.machine_class).join(', ')})`,
    };
  }

  // 3. The snapshot must describe the scenario being asked about. Cost per part
  //    is a function of batch size, so a snapshot taken at another batch answers
  //    a different question -- showing it would be as wrong as recomputing it.
  const batches = [...new Set(rows.map((r) => numOrNull(r.batch_size)))];
  if (batches.length > 1) {
    return { usable: false, reason: `rows disagree on batch size (${batches.join(', ')})` };
  }
  if (batches[0] === null) {
    return { usable: false, reason: 'snapshot records no batch size' };
  }
  if (batches[0] !== ctx.resolvedBatchSize) {
    return {
      usable: false,
      reason: `snapshot was costed at batch ${batches[0]}, this request resolves batch ${ctx.resolvedBatchSize}`,
    };
  }

  const locations = [...new Set(rows.map((r) => r.location ?? null))];
  if (locations.length > 1) {
    return { usable: false, reason: `rows disagree on location (${locations.join(', ')})` };
  }
  if (locations[0] !== ctx.resolvedLocation) {
    return {
      usable: false,
      reason: `snapshot location ${locations[0] ?? 'null'} differs from the requested ${ctx.resolvedLocation}`,
    };
  }

  // 4. Currency, unchanged from the P1b-iv-a contract but now all-or-nothing:
  //    the summary is in one denomination and a snapshot in another cannot be
  //    mixed into it. Nothing is converted here.
  for (const r of rows) {
    const rejection = overlayRejectionReason(
      { currency: r.currency ?? null, cost_currency_basis: r.cost_currency_basis ?? null },
      ctx.summaryCurrency,
    );
    if (rejection) {
      return { usable: false, reason: `op${r.op_nbr ?? '?'} (${r.machine_class}): ${rejection}` };
    }
  }

  const ordered = [...rows].sort((a, b) => (numOrNull(a.op_nbr) ?? 0) - (numOrNull(b.op_nbr) ?? 0));
  return { usable: true, rows: ordered, tag: distinctTags[0] };
}

// Which machine class performs the route's core process is answered by the
// MANUFACTURING_PROCESS_REGISTRY, not by a list maintained here. This used to be
// a hardcoded allowlist of four classes —
//   ['fiber_laser', 'co2_laser', 'turret_punch', 'waterjet']
// — plus a parallel list of their display labels. Sixteen route classes are
// registered, so twelve of them (every press, every roll bending, plasma,
// oxyfuel, shear, laser punch, router) were silently excluded: applying one of
// those routes left this summary still describing the laser default it had
// replaced. Confirmed live: a part with Standard Press applied still reported
// Laser Cutting + Press Brake from this path.
//
// The caller passes the registry's own set, and lines are matched by
// machineClass — an exact key the engine already puts on every line — so a
// newly registered process is covered with no edit here.

function buildLineFromAppliedRecord(
  row: AppliedProcessCostRecord,
  processLabelForClass: Readonly<Record<string, string>>,
): ProcessLineCost {
  return {
    // The engine registered for this machine class names the process — the same
    // string that engine puts on its own line, so an applied row and a computed
    // one read identically. Replaces a hardcoded four-class label map. The
    // persisted catalog fields are the fallback only: process_route is the
    // route GROUP for some families ("Bending/Floating /Forming"), not a
    // process name, so it cannot be the primary source.
    process: processLabelForClass[row.machine_class] ?? row.process_route ?? row.operation ?? row.machine_class,
    processGroup: row.process_group ?? undefined,
    processRoute: row.process_route ?? undefined,
    operation: row.operation ?? undefined,
    // Read back at full precision, NOT r2. These are per-PART costs, and on a
    // high-volume part they are legitimately sub-cent: the real SECC part
    // measured here costs 0.00023952 for Laser Cutting and 0.00035928 for Press
    // Brake. r2 rounds both to 0.00, so the Cost Guide showed the two overlaid
    // operations as free even once the columns were being written — the second
    // half of the same defect, and invisible until the round trip was tested.
    //
    // The engine does not round these on its own lines (route comparison
    // reports 0.00023952383...), so rounding them here is what broke
    // persisted-equals-engine. Money is formatted for display by the UI, which
    // already applies the currency contract; this layer must not pre-round.
    setupCost: Number(row.setup_cost_per_part ?? 0),
    runCost: Number(row.total_cycle_cost_per_part ?? 0),
    totalCost: Number(row.total_cost_per_part ?? 0),
    cycleTimeMin: Number(row.cycle_time ?? 0) / 60,
    setupTimeMin: Number(row.setup_time ?? 0),
    // ProcessLineCost.hourlyRate is the MACHINE hour rate: eMithranTerms takes
    // mhrPerHr and dlrPerHr as two separate arguments, and every engine sets
    // hourlyRate from MHRRateInput.rate with labourRate carried beside it.
    //
    // This read direct_rate, which on a newly applied row is machine + labour.
    // Measured on live row fce24614 (3 Roll Bending, Faccin HCU 300 X 1): the
    // engine costed at the machine rate of 15.85/hr, and the applied line
    // reported direct_rate 62.52 -- the same operation showing a 3.9x higher
    // rate purely because a route had been applied.
    //
    // direct_rate cannot simply be swapped for machine_rate, because it holds
    // three different conventions across historical producers (see
    // AppliedProcessCostRecord.line_hourly_rate). So migration 718 added a
    // column that means one thing, and only rows that carry it are read the new
    // way. A legacy row reads exactly as it did before -- unchanged, not
    // silently reinterpreted with a meaning its producer never intended.
    hourlyRate: row.line_hourly_rate != null
      ? Number(row.line_hourly_rate)
      : r2(Number(row.direct_rate ?? 0)),
    labourRate: row.line_labour_rate != null ? Number(row.line_labour_rate) : undefined,
    setupTimeSource: row.setup_time_source ?? undefined,
    rateSource: row.mhr_id ? 'mhr_database' : 'default_rate',
    machineClass: row.machine_class,
    machineName: row.machine_name ?? null,
    commodityCode: null,
  };
}

/**
 * One operation whose persisted cost no longer matches what the engine would
 * charge for it now.
 */
export interface AppliedGenerationDrift {
  machineClass: string;
  process: string;
  persistedTotalCost: number;
  liveTotalCost: number;
}

/**
 * Compare an authoritative generation against what the engine currently
 * computes, so a stale snapshot can be DISCLOSED rather than silently trusted.
 *
 * WHY THIS IS NECESSARY, NOT DECORATION
 *
 * A persisted row records its inputs (batch, location, rates, machine linkage)
 * but nothing about the engine/rate state it was resolved under. Item 83e8d472
 * showed what that costs: its CMM row was written with machine_rate = 0 and no
 * machine link, because at that moment nothing resolved an inspection resource.
 * The engine now resolves an existing $40/hr bench (bm-mhr-251) that has been
 * on file since 2026-07-22, and a fresh apply persists it correctly -- verified
 * behaviourally. So the row is simply old.
 *
 * Both possible silent behaviours are wrong:
 *   recompute it live  -> an applied quote changes because a rate resolved
 *                         differently, which is not a quote.
 *   freeze it silently -> the quote keeps a number nobody can tell is stale.
 *
 * So the snapshot stays authoritative -- a rate change must never move an
 * applied quote -- and the divergence is surfaced instead, with re-apply as the
 * explicit refresh.
 *
 * Comparison is on totalCost, the only quantity that answers the question a
 * user cares about ("would re-applying change this number?"). Tolerance is
 * relative, because per-part costs are legitimately sub-cent.
 */
export function detectAppliedGenerationDrift(
  appliedRows: readonly AppliedProcessCostRecord[],
  liveLines: readonly ProcessLineCost[],
  processLabelForClass: Readonly<Record<string, string>>,
): AppliedGenerationDrift[] {
  const drift: AppliedGenerationDrift[] = [];
  for (const row of appliedRows) {
    const live = liveLines.find((l) => l.machineClass === row.machine_class);
    if (!live) continue; // the engine no longer composes this operation at all
    const persisted = Number(row.total_cost_per_part ?? 0);
    const current = Number(live.totalCost ?? 0);
    const tolerance = Math.max(1e-9, Math.abs(persisted) * 0.01);
    if (Math.abs(current - persisted) > tolerance) {
      drift.push({
        machineClass: row.machine_class,
        process: processLabelForClass[row.machine_class] ?? row.operation ?? row.machine_class,
        persistedTotalCost: persisted,
        liveTotalCost: current,
      });
    }
  }
  return drift;
}

export function applyPersistedRouteToSummary(
  summary: CostSummaryDto,
  /**
   * The authoritative applied generation, already validated by
   * selectAppliedGeneration. Every row becomes a process line; nothing is
   * merged with a live value.
   */
  appliedRows: AppliedProcessCostRecord[],
  /** Each registered engine's own process label, keyed by machine class. */
  processLabelForClass: Readonly<Record<string, string>>,
): CostSummaryDto {
  if (appliedRows.length === 0) return summary;

  // The generation IS the operation list. Previously this replaced at most two
  // lines -- the core cutting row and press_brake -- and left every other line
  // as the engine had just computed it, which is what produced a Cost Guide
  // total 0.18 above its own persisted generation. There is no allowlist here
  // any more and no class-based matching: whatever was persisted is what the
  // quote contains.
  //
  // Nothing is calculated. buildLineFromAppliedRecord maps stored columns onto
  // the line 1:1 -- no rate x time, no setup re-amortisation.
  const processLines = appliedRows.map((r) => buildLineFromAppliedRecord(r, processLabelForClass));

  // A forming route that bends in-process simply has no press_brake row in its
  // generation, so the rule that used to strip that line is now expressed by
  // the data instead of re-derived here.
  const minutesFor = (pred: (cls: string) => boolean): number =>
    processLines.filter((l) => pred(l.machineClass)).reduce((s, l) => s + l.cycleTimeMin, 0);

  // Unrounded, for the same reason the per-line costs are: these are per-PART
  // totals, and r2 turns a real sub-cent quote into 0.00. Display rounding is
  // the UI currency contract's job.
  //
  // cycleTimes.totalMin keeps its r2 — that is minutes, a different quantity
  // with its own documented rounding contract (see r2/r3 above).
  const totalProcessCost = processLines.reduce((s, l) => s + l.totalCost, 0);
  return {
    ...summary,
    processLines,
    totalProcessCost,
    totalCost: summary.materialCost + totalProcessCost,
    cycleTimes: {
      ...summary.cycleTimes,
      // Derived from the same authoritative rows, so the time summary can no
      // longer describe a different set of operations than the cost summary.
      laserMin: minutesFor((c) => c === 'fiber_laser' || c === 'co2_laser'),
      pressBrakeMin: minutesFor((c) => c === 'press_brake'),
      tappingMin: minutesFor((c) => c === 'tapping'),
      deburrMin: minutesFor((c) => c === 'deburring'),
      totalMin: r2(processLines.reduce((s, l) => s + l.cycleTimeMin, 0)),
    },
  };
}
