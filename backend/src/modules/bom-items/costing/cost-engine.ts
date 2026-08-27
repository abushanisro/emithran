import {
  TAPPING_SETUP_MIN, MATERIAL_OVERHEAD_PCT, UTILIZATION_ADVISORY_THRESHOLD_PCT,
  RATES_SOURCE_LABEL,
  COUNTERBORE_SETUP_MIN, COUNTERSINK_SETUP_MIN, PEM_INSERTION_SETUP_MIN,
  BURRING_SETUP_MIN,
  TIGHT_TOLERANCE_REAM_THRESHOLD_MM, REAM_SETUP_MIN,
} from './default-rates';
import type { InspectionResult } from './inspection-engine';
import {
  ENERGY_KWH_PER_HR, GRID_CO2_KG_PER_KWH,
  MATERIAL_CO2_KG_PER_KG, MATERIAL_RECYCLABILITY_PCT,
  SUSTAINABILITY_FACTORS_LABEL,
} from './sustainability-factors';
import type { NestingResult } from './sheet-metal-nesting.engine';
import type { CostSummaryDto, ProcessLineCost, ProcessCO2, SustainabilitySummaryDto, PhysicsGap, ConfidenceLevel } from '../dto/cost-breakdown.dto';
import { computeSurfaceTreatmentLine } from './cost-surface-treatment';
import type { SurfaceTreatmentDbRate } from './default-rates';

// P0.6 (Machine Economics, provenance-visibility phase) — mirrors MHRRateInput's
// own `source` tiering, but for the labor-rate side (resolveLHRRates' 4-pass
// resolution in bom-items.service.ts), which previously collapsed to a bare
// number with zero visibility into which pass actually won.
// 'mhr_machine_specific' — this exact machine's own usd_lhr_total
// (mhr_records, sourced from machine_library.json's labor_rate_usd_hr for
// benchmarked rows) — an explicit, approved override that takes precedence
// over the location+process_group lhr_records/lhr_benchmark_rates lookup for
// that specific machine's operations, per user decision 2026-08-27.
export type LhrRateSource = 'lhr_database' | 'lhr_benchmark' | 'lhr_cross_location' | 'no_lhr_rate' | 'mhr_machine_specific';

export interface MHRRateInput {
  rate: number;
  source: 'mhr_database' | 'default_rate' | 'no_db_rate' | 'tier_synthetic' | 'benchmark_override';
  machineClass: string;
  machineName: string | null;
  commodityCode: string | null;
  selection?: import('../dto/machine-selection.dto').MachineSelectionResult;
  labourRate?: number | null;
  labourRateSource?: LhrRateSource | null;
  // mhr_records.operators for the machine this rate resolved to (via
  // MachineCandidate.operators) — real per-machine operator headcount, used
  // as this operation's setupNDL/cycleNDL instead of a blanket assumption.
  // null when no real machine (class-default fallback) or the field was
  // never set; callers fall back to a generic default, never to 0.
  operators?: number | null;
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
  opSetupMinByOp?: Partial<Record<'tapping' | 'counterbore' | 'countersink' | 'pem_insertion' | 'burring' | 'ream', number>>;

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

// ── 5-term eMithran cost formula ────────────────────────────────────────────────
// Returns { machineCost, setupCost, laborCost, inspCost, yieldCost, total }
// All rates are per-hour in local currency; times are in minutes.
// Exported so both the automated cost engine and any manual-entry preview (e.g.
// ProcessCostDialog) compute cost from this exact same arithmetic — no second,
// independently-maintained implementation of "cost for this line" anywhere.
export function eMithranTerms(args: {
  mhrPerHr: number;
  dlrPerHr: number;
  qairPerHr: number;
  // Operators present during setup vs. during the run — distinct real-world counts
  // (e.g. one person tends setup, a different headcount runs the cycle). Every
  // current caller in this file passes the same value for both.
  setupNDL: number;
  cycleNDL: number;
  cycleTimeMin: number;
  setupTimeMin: number;
  inspTimeMin: number;
  samplingRate: number;
  yieldPct: number;
  netMatCost: number;
  netWeightKg: number;
  scrapPricePerKg: number;
}): { machineCost: number; setupCost: number; laborCost: number; inspCost: number; yieldCost: number; total: number } {
  const { mhrPerHr, dlrPerHr, qairPerHr, setupNDL, cycleNDL, cycleTimeMin, setupTimeMin,
          inspTimeMin, samplingRate, yieldPct, netMatCost, netWeightKg, scrapPricePerKg } = args;

  const mhrMin = mhrPerHr / 60;
  const dlrMin = dlrPerHr / 60;
  const qairMin = qairPerHr / 60;

  const machineCost = mhrMin * cycleTimeMin;
  // Setup: machine idle time + DL idle time (no SL in this deployment)
  const setupCost = (mhrMin + dlrMin * setupNDL) * setupTimeMin;
  const laborCost = dlrMin * cycleNDL * cycleTimeMin;
  const inspCost = qairMin * inspTimeMin * samplingRate;

  const scrapValue = netWeightKg * scrapPricePerKg;
  const yieldBase = Math.max(0, netMatCost - scrapValue + machineCost + setupCost + laborCost + inspCost);
  const yieldCost = (1 - yieldPct) * yieldBase;

  const total = machineCost + setupCost + laborCost + inspCost + yieldCost;
  return { machineCost, setupCost, laborCost, inspCost, yieldCost, total };
}

// ── Main export ───────────────────────────────────────────────────────────────

export function computeCostSummary(input: CostEngineInput): CostSummaryDto {
  const {
    sheetThicknessMm, cutLengthMm, pierceCount, bendCount,
    flatPatternAreaMm2, materialGrade, materialCostPerKg,
    materialDensityKgM3, materialSource, threads, batchSize, family,
    nestingResult,
    handlingTimeMin = 0.25,
    toolSetupBrakeMin = 10,
    samplingRate = 0.08,
    inspectionTimeMin = 0.5,
    opSetupMinByOp,
    directLaborRatePerHr,
    qaInspectorRatePerHr,
    yieldPct = 0.98,
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
  let laserMin = 0;
  if (cutLengthMm > 0 || pierceCount > 0) {
    if (typeof input.laserCycleTimeSecFromCalculator === 'number' && Number.isFinite(input.laserCycleTimeSecFromCalculator)) {
      laserMin = input.laserCycleTimeSecFromCalculator / 60;
    } else if (input.laserPhysicsGap) {
      const gap = input.laserPhysicsGap;
      warnings.push(gap.gapType === 'missing_lookup'
        ? `Laser cutting cycle time unavailable — ${gap.requiredAction}`
        : `Laser cutting cycle time unavailable — ${gap.reason}`);
    } else {
      // Defensive: resolvePhysicsQuantity always returns either a value or a
      // gap — reaching here means a bug in that resolver, not a data gap.
      warnings.push('Laser cutting cycle time unavailable — no calculator result and no reported gap (unexpected; check resolvePhysicsQuantity).');
    }

    // Setup: program recall time + sheet handling per lot
    // partsPerSheet from nesting; default 4 if nesting not run
    const partsPerSheet = nestingResult?.partsPerSheet ?? 4;
    const sheetsPerLot = Math.ceil(batchSize / partsPerSheet);
    const setupTimeMin = (handlingTimeMin * sheetsPerLot) / Math.max(batchSize, 1);

    const t = eMithranTerms({
      mhrPerHr: laserRate.rate,
      // Prefer this process's own resolved labour rate (e.g. a real
      // 'Sheet Metal' rate for laser) over the flat blanket rate — see
      // resolveLHRRates/buildOutput in bom-items.service.ts, which already
      // differentiates by process group (Deburr, Turret, ...); only the
      // flat rate was ever wired into this formula until now.
      dlrPerHr: laserRate.labourRate ?? dlrPerHr,
      qairPerHr,
      // Prefer this machine's own real operator count (mhr_records.operators)
      // over the blanket default — same precedence already established for
      // dlrPerHr above.
      setupNDL: laserRate.operators ?? machineOperators,
      cycleNDL: laserRate.operators ?? machineOperators,
      cycleTimeMin: laserMin,
      setupTimeMin,
      inspTimeMin: inspectionTimeMin,
      samplingRate,
      yieldPct,
      netMatCost,
      netWeightKg,
      scrapPricePerKg,
    });

    if (laserRate.source === 'no_db_rate') {
      warnings.push(`No fiber laser MHR rate in DB for ${location ?? 'this location'} — laser process cost is $0; add a row to mhr_records`);
    }
    const laserIdentity = input.processIdentityByMachineClass?.[laserRate.machineClass];
    processLines.push({
      process: 'Laser Cutting',
      ...(laserIdentity ? { processGroup: laserIdentity.processGroup, processRoute: laserIdentity.processRoute, operation: laserIdentity.operation } : {}),
      setupCost: t.setupCost,
      runCost: t.machineCost + t.laborCost,
      totalCost: t.total,
      cycleTimeMin: rTime(laserMin),
      hourlyRate: laserRate.rate,
      rateSource: laserRate.source,
      machineClass: laserRate.machineClass,
      machineName: laserRate.machineName,
      commodityCode: laserRate.commodityCode,
      labourRate: laserRate.labourRate ?? null,
      labourRateSource: laserRate.labourRateSource ?? null,
      ...(input.laserCalculatorId ? { calculatorId: input.laserCalculatorId } : {}),
      ...(input.laserCalculatorVersion != null ? { calculatorVersion: input.laserCalculatorVersion } : {}),
      ...(input.laserPhysicsGap ? { physicsGap: input.laserPhysicsGap } : {}),
      ...(input.laserConfidence ? { confidence: input.laserConfidence } : {}),
    });
  }

  // ── Hole Extrusion (Burring) — feature-driven, runs before Press Brake AND
  // Tapping ──────────────────────────────────────────────────────────────────
  // Forms the extruded hole flange/collar (e.g. drawing callout "2X M3 BURLING
  // BACK CONVEX") before the hole is threaded — physically required ordering.
  // Also moved ahead of Press Brake/Deburring: the thread sits in the
  // extruded collar, so the collar is formed and tapped while the part is
  // still flat — tapping into an already-bent flange risks tool access/
  // interference, and this sequencing also avoids handling an already-bent
  // part through tapping.
  //
  // Manufacturing Physics Calculator architecture: cycle time comes from the
  // real "Sheet Metal - Hole Extrusion (Burring)" DB calculator ONLY (real
  // forming-force physics + sm_lookup_manual_stroke stroke-time lookup), via
  // bom-items.service.ts's resolvePhysicsQuantity — `burringPhysicsGap`
  // carries the real, structured reason when it can't resolve a value.
  // Machine class is a generic 'hole_forming' (not hardcoded to a turret
  // punch) — resolved through the same real mhr_records/benchmark pipeline
  // as every other class, so it's driven by what a shop actually has on file.
  const extrudedFlangeCount = input.extrudedFlangeCount ?? 0;
  if (extrudedFlangeCount > 0) {
    let burringMin = 0;
    if (typeof input.burringCycleTimeSecFromCalculator === 'number' && Number.isFinite(input.burringCycleTimeSecFromCalculator)) {
      burringMin = input.burringCycleTimeSecFromCalculator / 60;
    } else if (input.burringPhysicsGap) {
      const gap = input.burringPhysicsGap;
      warnings.push(gap.gapType === 'missing_lookup'
        ? `Hole extrusion (burring) cycle time unavailable — ${gap.requiredAction}`
        : `Hole extrusion (burring) cycle time unavailable — ${gap.reason}`);
    } else {
      warnings.push('Hole extrusion (burring) cycle time unavailable — no calculator result and no reported gap (unexpected; check resolvePhysicsQuantity).');
    }
    if (opSetupMinByOp?.burring == null) {
      warnings.push(`Hole extrusion (burring) setup time not on file — generic default applied (${BURRING_SETUP_MIN} min)`);
    }
    const setupTimeMin = (opSetupMinByOp?.burring ?? BURRING_SETUP_MIN) / Math.max(batchSize, 1);
    const holeFormingRate = input.mhrRates?.holeForming
      ?? { rate: 0, source: 'no_db_rate' as const, machineClass: 'hole_forming', machineName: null, commodityCode: null };

    const t = eMithranTerms({
      mhrPerHr: holeFormingRate.rate, dlrPerHr: holeFormingRate.labourRate ?? dlrPerHr, qairPerHr,
      setupNDL: holeFormingRate.operators ?? machineOperators, cycleNDL: holeFormingRate.operators ?? machineOperators,
      cycleTimeMin: burringMin, setupTimeMin,
      inspTimeMin: inspectionTimeMin, samplingRate, yieldPct,
      netMatCost, netWeightKg, scrapPricePerKg,
    });

    if (holeFormingRate.source === 'no_db_rate') {
      warnings.push(`No hole-forming MHR rate in DB for ${location ?? 'this location'} — add a machine (e.g. a turret punch with a burring station, or a dedicated hole-flanging press) to mhr_records; hole extrusion process cost is $0`);
    }
    const burringIdentity = input.processIdentityByMachineClass?.[holeFormingRate.machineClass];
    processLines.push({
      process: 'Hole Extrusion (Burring)',
      ...(burringIdentity ? { processGroup: burringIdentity.processGroup, processRoute: burringIdentity.processRoute, operation: burringIdentity.operation } : {}),
      setupCost: t.setupCost,
      runCost: t.machineCost + t.laborCost,
      totalCost: t.total,
      cycleTimeMin: rTime(burringMin),
      hourlyRate: holeFormingRate.rate,
      rateSource: holeFormingRate.source,
      machineClass: holeFormingRate.machineClass,
      machineName: holeFormingRate.machineName,
      commodityCode: holeFormingRate.commodityCode,
      labourRate: holeFormingRate.labourRate ?? null,
      labourRateSource: holeFormingRate.labourRateSource ?? null,
      ...(input.burringCalculatorId ? { calculatorId: input.burringCalculatorId } : {}),
      ...(input.burringCalculatorVersion != null ? { calculatorVersion: input.burringCalculatorVersion } : {}),
      ...(input.burringPhysicsGap ? { physicsGap: input.burringPhysicsGap } : {}),
      ...(input.burringConfidence ? { confidence: input.burringConfidence } : {}),
    });
  }

  // ── Tapping ───────────────────────────────────────────────────────────────
  // Manufacturing Physics Calculator architecture: cycle time comes from the
  // real "Machining - Tapping" DB calculator ONLY (physics_key='tapping' —
  // dispatches to the exact same computeTapPhysics() rigid-tapping physics
  // the interactive popup uses), via bom-items.service.ts's
  // resolveTappingCycleTimeSec/resolvePhysicsQuantity. No second, independent
  // formula here anymore: when the calculator can't resolve a value (no
  // calculator registered for machine class 'tapping'), `tappingPhysicsGap`
  // carries the real, structured reason and this line is still emitted
  // (never silently omitted) with cycleTimeMin 0 and that gap attached.
  let tappingMin = 0;
  if (threads.length > 0) {
    if (typeof input.tappingCycleTimeSecFromCalculator === 'number' && Number.isFinite(input.tappingCycleTimeSecFromCalculator)) {
      tappingMin = input.tappingCycleTimeSecFromCalculator / 60;
    } else if (input.tappingPhysicsGap) {
      const gap = input.tappingPhysicsGap;
      warnings.push(gap.gapType === 'missing_lookup'
        ? `Tapping cycle time unavailable — ${gap.requiredAction}`
        : `Tapping cycle time unavailable — ${gap.reason}`);
    } else {
      // Defensive: resolveTappingCycleTimeSec always returns either a value
      // or a gap — reaching here means a bug in that resolver, not a data gap.
      warnings.push('Tapping cycle time unavailable — no calculator result and no reported gap (unexpected; check resolveTappingCycleTimeSec).');
    }
    const setupTimeMin = (opSetupMinByOp?.tapping ?? TAPPING_SETUP_MIN) / Math.max(batchSize, 1);

    const t = eMithranTerms({
      mhrPerHr: tappingRate.rate,
      dlrPerHr: tappingRate.labourRate ?? dlrPerHr,
      qairPerHr,
      // Was hardcoded to 1 ("single operator for tapping") before real
      // per-machine operator counts existed; now prefers the real value.
      setupNDL: tappingRate.operators ?? machineOperators,
      cycleNDL: tappingRate.operators ?? machineOperators,
      cycleTimeMin: tappingMin,
      setupTimeMin,
      inspTimeMin: inspectionTimeMin,
      samplingRate,
      yieldPct,
      netMatCost,
      netWeightKg,
      scrapPricePerKg,
    });

    if (tappingRate.source === 'no_db_rate') {
      warnings.push(`No tapping MHR rate in DB for ${location ?? 'this location'} — tapping process cost is $0; add a row to mhr_records`);
    }
    const tappingIdentity = input.processIdentityByMachineClass?.[tappingRate.machineClass];
    processLines.push({
      process: 'Tapping',
      ...(tappingIdentity ? { processGroup: tappingIdentity.processGroup, processRoute: tappingIdentity.processRoute, operation: tappingIdentity.operation } : {}),
      setupCost: t.setupCost,
      runCost: t.machineCost + t.laborCost,
      totalCost: t.total,
      cycleTimeMin: rTime(tappingMin),
      hourlyRate: tappingRate.rate,
      rateSource: tappingRate.source,
      machineClass: tappingRate.machineClass,
      machineName: tappingRate.machineName,
      commodityCode: tappingRate.commodityCode,
      labourRate: tappingRate.labourRate ?? null,
      labourRateSource: tappingRate.labourRateSource ?? null,
      ...(input.tappingCalculatorId ? { calculatorId: input.tappingCalculatorId } : {}),
      ...(input.tappingCalculatorVersion != null ? { calculatorVersion: input.tappingCalculatorVersion } : {}),
      ...(input.tappingPhysicsGap ? { physicsGap: input.tappingPhysicsGap } : {}),
      ...(input.tappingConfidence ? { confidence: input.tappingConfidence } : {}),
    });
  }

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
  let pressBrakeMin = 0;
  if (bendCount > 0) {
    if (typeof input.pressBrakeCycleTimeSecFromCalculator === 'number' && Number.isFinite(input.pressBrakeCycleTimeSecFromCalculator)) {
      pressBrakeMin = input.pressBrakeCycleTimeSecFromCalculator / 60;
    } else if (input.pressBrakePhysicsGap) {
      const gap = input.pressBrakePhysicsGap;
      warnings.push(gap.gapType === 'missing_lookup'
        ? `Press brake cycle time unavailable — ${gap.requiredAction}`
        : `Press brake cycle time unavailable — ${gap.reason}`);
    } else {
      // Defensive: resolvePhysicsQuantity always returns either a value or a
      // gap — reaching here means a bug in that resolver, not a data gap.
      warnings.push('Press brake cycle time unavailable — no calculator result and no reported gap (unexpected; check resolvePhysicsQuantity).');
    }

    // Setup: tool loading / lot size
    const setupTimeMin = (typeof input.pressBrakeSetupTimeMinFromCalculator === 'number' && Number.isFinite(input.pressBrakeSetupTimeMinFromCalculator))
      ? input.pressBrakeSetupTimeMinFromCalculator
      : toolSetupBrakeMin / Math.max(batchSize, 1);

    const t = eMithranTerms({
      mhrPerHr: pbRate.rate,
      dlrPerHr: pbRate.labourRate ?? dlrPerHr,
      qairPerHr,
      setupNDL: pbRate.operators ?? machineOperators,
      cycleNDL: pbRate.operators ?? machineOperators,
      cycleTimeMin: pressBrakeMin,
      setupTimeMin,
      inspTimeMin: inspectionTimeMin,
      samplingRate,
      yieldPct,
      netMatCost,
      netWeightKg,
      scrapPricePerKg,
    });

    if (pbRate.source === 'no_db_rate') {
      warnings.push(`No press brake MHR rate in DB for ${location ?? 'this location'} — bending process cost is $0; add a row to mhr_records`);
    }
    const pbIdentity = input.processIdentityByMachineClass?.[pbRate.machineClass];
    processLines.push({
      process: 'Press Brake',
      ...(pbIdentity ? { processGroup: pbIdentity.processGroup, processRoute: pbIdentity.processRoute, operation: pbIdentity.operation } : {}),
      setupCost: t.setupCost,
      runCost: t.machineCost + t.laborCost,
      totalCost: t.total,
      cycleTimeMin: rTime(pressBrakeMin),
      hourlyRate: pbRate.rate,
      rateSource: pbRate.source,
      machineClass: pbRate.machineClass,
      machineName: pbRate.machineName,
      commodityCode: pbRate.commodityCode,
      labourRate: pbRate.labourRate ?? null,
      labourRateSource: pbRate.labourRateSource ?? null,
      ...(input.pressBrakeCalculatorId ? { calculatorId: input.pressBrakeCalculatorId } : {}),
      ...(input.pressBrakeCalculatorVersion != null ? { calculatorVersion: input.pressBrakeCalculatorVersion } : {}),
      ...(input.pressBrakePhysicsGap ? { physicsGap: input.pressBrakePhysicsGap } : {}),
      ...(input.pressBrakeConfidence ? { confidence: input.pressBrakeConfidence } : {}),
    });
  }

  // ── Deburring ─────────────────────────────────────────────────────────────
  // Manufacturing Physics Calculator architecture: cycle time comes from the
  // real "Sheet Metal - Deburring" DB calculator ONLY (physics_key='deburring'
  // — dispatches to the exact same computeDeburrCycleSec() the interactive
  // popup uses), via bom-items.service.ts's resolvePhysicsQuantity. No
  // second, independent formula here anymore: when the calculator can't
  // resolve a value, `deburrPhysicsGap` carries the real, structured reason
  // and this line is still emitted with cycleTimeMin 0 and that gap attached.
  let deburrMin = 0;
  if (cutLengthMm > 0) {
    if (typeof input.deburrCycleTimeSecFromCalculator === 'number' && Number.isFinite(input.deburrCycleTimeSecFromCalculator)) {
      deburrMin = input.deburrCycleTimeSecFromCalculator / 60;
    } else if (input.deburrPhysicsGap) {
      const gap = input.deburrPhysicsGap;
      warnings.push(gap.gapType === 'missing_lookup'
        ? `Deburring cycle time unavailable — ${gap.requiredAction}`
        : `Deburring cycle time unavailable — ${gap.reason}`);
    } else {
      warnings.push('Deburring cycle time unavailable — no calculator result and no reported gap (unexpected; check resolvePhysicsQuantity).');
    }

    const t = eMithranTerms({
      mhrPerHr: deburrRate.rate,
      // Deburr has its own real, differentiated 'Deburr' process-group LHR
      // rate (lhr_benchmark_rates — e.g. a BLS-cited "Manual Deburr
      // Operator" figure), distinct from and typically lower than the
      // generic 'Sheet Metal' rate every other process used to fall back to.
      dlrPerHr: deburrRate.labourRate ?? dlrPerHr,
      qairPerHr,
      setupNDL: deburrRate.operators ?? machineOperators,
      cycleNDL: deburrRate.operators ?? machineOperators,
      cycleTimeMin: deburrMin,
      setupTimeMin: 0,
      inspTimeMin: inspectionTimeMin,
      samplingRate,
      yieldPct,
      netMatCost,
      netWeightKg,
      scrapPricePerKg,
    });

    if (deburrRate.source === 'no_db_rate') {
      warnings.push(`No deburring MHR rate in DB for ${location ?? 'this location'} — deburring process cost is $0; add a row to mhr_records`);
    }
    const deburrIdentity = input.processIdentityByMachineClass?.[deburrRate.machineClass];
    processLines.push({
      process: 'Deburring',
      ...(deburrIdentity ? { processGroup: deburrIdentity.processGroup, processRoute: deburrIdentity.processRoute, operation: deburrIdentity.operation } : {}),
      setupCost: 0,
      runCost: t.machineCost + t.laborCost,
      totalCost: t.total,
      cycleTimeMin: rTime(deburrMin),
      hourlyRate: deburrRate.rate,
      rateSource: deburrRate.source,
      machineClass: deburrRate.machineClass,
      machineName: deburrRate.machineName,
      commodityCode: deburrRate.commodityCode,
      labourRate: deburrRate.labourRate ?? null,
      labourRateSource: deburrRate.labourRateSource ?? null,
      ...(input.deburrCalculatorId ? { calculatorId: input.deburrCalculatorId } : {}),
      ...(input.deburrCalculatorVersion != null ? { calculatorVersion: input.deburrCalculatorVersion } : {}),
      ...(input.deburrPhysicsGap ? { physicsGap: input.deburrPhysicsGap } : {}),
      ...(input.deburrConfidence ? { confidence: input.deburrConfidence } : {}),
    });
  }

  // ── Counterboring (feature-driven: only present when the extractor found a
  // counterbore hole — see SheetMetalFeatureExtractorService) ────────────────
  const drillPressRate = input.mhrRates?.drillPress
    ?? { rate: 0, source: 'no_db_rate' as const, machineClass: 'drill_press', machineName: null, commodityCode: null };
  // Manufacturing Physics Calculator architecture: cycle time comes from the
  // real "Sheet Metal - Counterboring" DB calculator ONLY (real rigid-
  // drilling physics — RPM from cutting speed/diameter, machining time from
  // feed rate), via bom-items.service.ts's resolveHoleOperationCycleTimeSec.
  // No second, independent formula and no sm_lookup_counterbore dependency
  // here anymore — `counterborePhysicsGap` carries the real, structured
  // reason when the calculator can't resolve a value.
  const counterboreCount = input.counterboreCount ?? 0;
  if (counterboreCount > 0) {
    let counterboreMin = 0;
    if (typeof input.counterboreCycleTimeSecFromCalculator === 'number' && Number.isFinite(input.counterboreCycleTimeSecFromCalculator)) {
      counterboreMin = input.counterboreCycleTimeSecFromCalculator / 60;
    } else if (input.counterborePhysicsGap) {
      const gap = input.counterborePhysicsGap;
      warnings.push(gap.gapType === 'missing_lookup'
        ? `Counterboring cycle time unavailable — ${gap.requiredAction}`
        : `Counterboring cycle time unavailable — ${gap.reason}`);
    } else {
      warnings.push('Counterboring cycle time unavailable — no calculator result and no reported gap (unexpected; check resolvePhysicsQuantity).');
    }
    if (opSetupMinByOp?.counterbore == null) {
      warnings.push(`Counterboring setup time not on file — generic default applied (${COUNTERBORE_SETUP_MIN} min)`);
    }
    const setupTimeMin = (opSetupMinByOp?.counterbore ?? COUNTERBORE_SETUP_MIN) / Math.max(batchSize, 1);

    const t = eMithranTerms({
      mhrPerHr: drillPressRate.rate, dlrPerHr: drillPressRate.labourRate ?? dlrPerHr, qairPerHr,
      setupNDL: drillPressRate.operators ?? machineOperators, cycleNDL: drillPressRate.operators ?? machineOperators,
      cycleTimeMin: counterboreMin, setupTimeMin,
      inspTimeMin: inspectionTimeMin, samplingRate, yieldPct,
      netMatCost, netWeightKg, scrapPricePerKg,
    });

    if (drillPressRate.source === 'no_db_rate') {
      warnings.push(`No drill press MHR rate in DB for ${location ?? 'this location'} — counterboring process cost is $0; add a row to mhr_records`);
    }
    const cbIdentity = input.processIdentityByMachineClass?.[drillPressRate.machineClass];
    processLines.push({
      process: 'Counterboring',
      ...(cbIdentity ? { processGroup: cbIdentity.processGroup, processRoute: cbIdentity.processRoute, operation: cbIdentity.operation } : {}),
      setupCost: t.setupCost,
      runCost: t.machineCost + t.laborCost,
      totalCost: t.total,
      cycleTimeMin: rTime(counterboreMin),
      hourlyRate: drillPressRate.rate,
      rateSource: drillPressRate.source,
      machineClass: drillPressRate.machineClass,
      machineName: drillPressRate.machineName,
      commodityCode: drillPressRate.commodityCode,
      labourRate: drillPressRate.labourRate ?? null,
      labourRateSource: drillPressRate.labourRateSource ?? null,
      ...(input.counterboreCalculatorId ? { calculatorId: input.counterboreCalculatorId } : {}),
      ...(input.counterboreCalculatorVersion != null ? { calculatorVersion: input.counterboreCalculatorVersion } : {}),
      ...(input.counterborePhysicsGap ? { physicsGap: input.counterborePhysicsGap } : {}),
      ...(input.counterboreConfidence ? { confidence: input.counterboreConfidence } : {}),
    });
  }

  // ── Countersinking (feature-driven) ───────────────────────────────────────
  // Same architecture as Counterboring above — real "Sheet Metal -
  // Countersinking" DB calculator, 25%-of-drill-speed design rule baked into
  // the resolver, real cone geometry for depth. No sm_lookup_countersink
  // dependency here anymore.
  const countersinkCount = input.countersinkCount ?? 0;
  if (countersinkCount > 0) {
    let countersinkMin = 0;
    if (typeof input.countersinkCycleTimeSecFromCalculator === 'number' && Number.isFinite(input.countersinkCycleTimeSecFromCalculator)) {
      countersinkMin = input.countersinkCycleTimeSecFromCalculator / 60;
    } else if (input.countersinkPhysicsGap) {
      const gap = input.countersinkPhysicsGap;
      warnings.push(gap.gapType === 'missing_lookup'
        ? `Countersinking cycle time unavailable — ${gap.requiredAction}`
        : `Countersinking cycle time unavailable — ${gap.reason}`);
    } else {
      warnings.push('Countersinking cycle time unavailable — no calculator result and no reported gap (unexpected; check resolvePhysicsQuantity).');
    }
    if (opSetupMinByOp?.countersink == null) {
      warnings.push(`Countersinking setup time not on file — generic default applied (${COUNTERSINK_SETUP_MIN} min)`);
    }
    const setupTimeMin = (opSetupMinByOp?.countersink ?? COUNTERSINK_SETUP_MIN) / Math.max(batchSize, 1);

    const t = eMithranTerms({
      mhrPerHr: drillPressRate.rate, dlrPerHr: drillPressRate.labourRate ?? dlrPerHr, qairPerHr,
      setupNDL: drillPressRate.operators ?? machineOperators, cycleNDL: drillPressRate.operators ?? machineOperators,
      cycleTimeMin: countersinkMin, setupTimeMin,
      inspTimeMin: inspectionTimeMin, samplingRate, yieldPct,
      netMatCost, netWeightKg, scrapPricePerKg,
    });

    if (drillPressRate.source === 'no_db_rate') {
      warnings.push(`No drill press MHR rate in DB for ${location ?? 'this location'} — countersinking process cost is $0; add a row to mhr_records`);
    }
    const csIdentity = input.processIdentityByMachineClass?.[drillPressRate.machineClass];
    processLines.push({
      process: 'Countersinking',
      ...(csIdentity ? { processGroup: csIdentity.processGroup, processRoute: csIdentity.processRoute, operation: csIdentity.operation } : {}),
      setupCost: t.setupCost,
      runCost: t.machineCost + t.laborCost,
      totalCost: t.total,
      cycleTimeMin: rTime(countersinkMin),
      hourlyRate: drillPressRate.rate,
      rateSource: drillPressRate.source,
      machineClass: drillPressRate.machineClass,
      machineName: drillPressRate.machineName,
      commodityCode: drillPressRate.commodityCode,
      labourRate: drillPressRate.labourRate ?? null,
      labourRateSource: drillPressRate.labourRateSource ?? null,
      ...(input.countersinkCalculatorId ? { calculatorId: input.countersinkCalculatorId } : {}),
      ...(input.countersinkCalculatorVersion != null ? { calculatorVersion: input.countersinkCalculatorVersion } : {}),
      ...(input.countersinkPhysicsGap ? { physicsGap: input.countersinkPhysicsGap } : {}),
      ...(input.countersinkConfidence ? { confidence: input.countersinkConfidence } : {}),
    });
  }

  // ── PEM Insertion (feature-driven: hole diameter + sheet thickness matched
  // against sm_lookup_pem_hardware by the caller — recognition, not geometry) ──
  // Manufacturing Physics Calculator architecture: cycle time comes from the
  // real "Sheet Metal - PEM Insertion" DB calculator ONLY, via
  // resolvePhysicsQuantity — `pemPhysicsGap` carries the real, structured
  // reason when it can't resolve a value (never a missing-hardware-match,
  // which is a recognition result, not a gap — see the caller's own comment).
  const pemCount = input.pemCount ?? 0;
  if (pemCount > 0) {
    let pemMin = 0;
    if (typeof input.pemCycleTimeSecFromCalculator === 'number' && Number.isFinite(input.pemCycleTimeSecFromCalculator)) {
      pemMin = input.pemCycleTimeSecFromCalculator / 60;
    } else if (input.pemPhysicsGap) {
      const gap = input.pemPhysicsGap;
      warnings.push(gap.gapType === 'missing_lookup'
        ? `PEM insertion cycle time unavailable — ${gap.requiredAction}`
        : `PEM insertion cycle time unavailable — ${gap.reason}`);
    } else {
      warnings.push('PEM insertion cycle time unavailable — no calculator result and no reported gap (unexpected; check resolvePhysicsQuantity).');
    }
    if (opSetupMinByOp?.pem_insertion == null) {
      warnings.push(`PEM insertion setup time not on file — generic default applied (${PEM_INSERTION_SETUP_MIN} min)`);
    }
    const setupTimeMin = (opSetupMinByOp?.pem_insertion ?? PEM_INSERTION_SETUP_MIN) / Math.max(batchSize, 1);
    const pemRate = input.mhrRates?.pemPress
      ?? { rate: 0, source: 'no_db_rate' as const, machineClass: 'pem_press', machineName: null, commodityCode: null };

    const t = eMithranTerms({
      mhrPerHr: pemRate.rate, dlrPerHr: pemRate.labourRate ?? dlrPerHr, qairPerHr,
      setupNDL: pemRate.operators ?? machineOperators, cycleNDL: pemRate.operators ?? machineOperators,
      cycleTimeMin: pemMin, setupTimeMin,
      inspTimeMin: inspectionTimeMin, samplingRate, yieldPct,
      netMatCost, netWeightKg, scrapPricePerKg,
    });

    if (pemRate.source === 'no_db_rate') {
      warnings.push(`No PEM press MHR rate in DB for ${location ?? 'this location'} — PEM insertion process cost is $0; add a row to mhr_records`);
    }
    const pemIdentity = input.processIdentityByMachineClass?.[pemRate.machineClass];
    processLines.push({
      process: 'PEM Insertion',
      ...(pemIdentity ? { processGroup: pemIdentity.processGroup, processRoute: pemIdentity.processRoute, operation: pemIdentity.operation } : {}),
      setupCost: t.setupCost,
      runCost: t.machineCost + t.laborCost,
      totalCost: t.total,
      cycleTimeMin: rTime(pemMin),
      hourlyRate: pemRate.rate,
      rateSource: pemRate.source,
      machineClass: pemRate.machineClass,
      machineName: pemRate.machineName,
      commodityCode: pemRate.commodityCode,
      labourRate: pemRate.labourRate ?? null,
      labourRateSource: pemRate.labourRateSource ?? null,
      ...(input.pemCalculatorId ? { calculatorId: input.pemCalculatorId } : {}),
      ...(input.pemCalculatorVersion != null ? { calculatorVersion: input.pemCalculatorVersion } : {}),
      ...(input.pemPhysicsGap ? { physicsGap: input.pemPhysicsGap } : {}),
      ...(input.pemConfidence ? { confidence: input.pemConfidence } : {}),
    });
  }

  // ── Drill + Ream + CMM Inspection (tight-tolerance holes) ─────────────────
  // Additive secondary op: the laser/punch still pierces every hole (unchanged
  // above); reaming brings a pierced hole to final tolerance when the drawing's
  // tightest callout can't be held by piercing alone. Part-level approximation
  // (see CostEngineInput.tightestToleranceMm doc) — applies to all holes on the
  // part, not just the specific toleranced one, until per-feature GD&T linkage exists.
  //
  // Manufacturing Physics Calculator architecture: cycle time comes from the
  // real "Machining - Reaming" DB calculator ONLY (real rigid-reaming
  // physics — RPM from cutting speed/diameter, machining time from feed
  // rate, using real HSS reaming speed/feed data — see default-rates.ts's
  // REAM_SURFACE_SPEED_M_MIN_BY_MATERIAL for citations), via
  // bom-items.service.ts's resolvePhysicsQuantity. No flat per-hole
  // constant here anymore — `reamPhysicsGap` carries the real, structured
  // reason when the calculator can't resolve a value.
  const tightTolerance = input.tightestToleranceMm ?? null;
  const reamHoleCount = input.holeCount ?? 0;
  const reamTriggered = tightTolerance != null && tightTolerance > 0
    && tightTolerance < TIGHT_TOLERANCE_REAM_THRESHOLD_MM && reamHoleCount > 0;
  if (reamTriggered) {
    let reamMin = 0;
    if (typeof input.reamCycleTimeSecFromCalculator === 'number' && Number.isFinite(input.reamCycleTimeSecFromCalculator)) {
      reamMin = input.reamCycleTimeSecFromCalculator / 60;
    } else if (input.reamPhysicsGap) {
      const gap = input.reamPhysicsGap;
      warnings.push(gap.gapType === 'missing_lookup'
        ? `Reaming cycle time unavailable — ${gap.requiredAction}`
        : `Reaming cycle time unavailable — ${gap.reason}`);
    } else {
      warnings.push('Reaming cycle time unavailable — no calculator result and no reported gap (unexpected; check resolvePhysicsQuantity).');
    }
    if (opSetupMinByOp?.ream == null) {
      warnings.push(`Reaming setup time not on file — generic default applied (${REAM_SETUP_MIN} min)`);
    }
    const setupTimeMin = (opSetupMinByOp?.ream ?? REAM_SETUP_MIN) / Math.max(batchSize, 1);

    const t = eMithranTerms({
      mhrPerHr: drillPressRate.rate, dlrPerHr: drillPressRate.labourRate ?? dlrPerHr, qairPerHr,
      setupNDL: drillPressRate.operators ?? machineOperators, cycleNDL: drillPressRate.operators ?? machineOperators,
      cycleTimeMin: reamMin, setupTimeMin,
      inspTimeMin: inspectionTimeMin, samplingRate, yieldPct,
      netMatCost, netWeightKg, scrapPricePerKg,
    });

    if (drillPressRate.source === 'no_db_rate') {
      warnings.push(`No drill press MHR rate in DB for ${location ?? 'this location'} — reaming process cost is $0; add a row to mhr_records`);
    }
    warnings.push(`Tight tolerance (${tightTolerance}mm) detected on drawing — reaming added for all ${reamHoleCount} hole(s); per-feature GD&T linkage not yet available to scope this to specific holes`);
    const reamIdentity = input.processIdentityByMachineClass?.[drillPressRate.machineClass];
    processLines.push({
      process: 'Reaming',
      ...(reamIdentity ? { processGroup: reamIdentity.processGroup, processRoute: reamIdentity.processRoute, operation: reamIdentity.operation } : {}),
      setupCost: t.setupCost,
      runCost: t.machineCost + t.laborCost,
      totalCost: t.total,
      cycleTimeMin: rTime(reamMin),
      hourlyRate: drillPressRate.rate,
      rateSource: drillPressRate.source,
      machineClass: drillPressRate.machineClass,
      machineName: drillPressRate.machineName,
      commodityCode: drillPressRate.commodityCode,
      labourRate: drillPressRate.labourRate ?? null,
      labourRateSource: drillPressRate.labourRateSource ?? null,
      ...(input.reamCalculatorId ? { calculatorId: input.reamCalculatorId } : {}),
      ...(input.reamCalculatorVersion != null ? { calculatorVersion: input.reamCalculatorVersion } : {}),
      ...(input.reamPhysicsGap ? { physicsGap: input.reamPhysicsGap } : {}),
      ...(input.reamConfidence ? { confidence: input.reamConfidence } : {}),
    });
  }

  // ── Inspection (general-purpose, tiered — see costing/inspection-engine.ts) ─
  // Fully resolved by the caller before this function runs (see
  // CostEngineInput.inspectionResult's own doc comment) — this engine just
  // consumes the real processLines/warnings, never computes inspection
  // physics itself.
  if (input.inspectionResult) {
    processLines.push(...input.inspectionResult.processLines);
    warnings.push(...input.inspectionResult.warnings);
  }

  // ── Surface treatment ─────────────────────────────────────────────────────
  const stLine = computeSurfaceTreatmentLine(
    input.surfaceTreatment ?? null,
    input.surfaceAreaMm2 ?? 0,
    batchSize,
    location ?? '__default__',
    warnings,
    input.surfaceTreatmentDbRate,
  );
  if (stLine) processLines.push(stLine);

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
}

const APPLIED_CUTTING_CLASSES = ['fiber_laser', 'co2_laser', 'turret_punch', 'waterjet'];
const APPLIED_PROCESS_LABEL_FOR_CLASS: Record<string, string> = {
  fiber_laser: 'Laser Cutting',
  co2_laser: 'Laser Cutting',
  turret_punch: 'Turret Punching',
  waterjet: 'Waterjet Cutting',
  press_brake: 'Press Brake',
};
const APPLIED_CUTTING_LABELS = ['Laser Cutting', 'Turret Punching', 'Waterjet Cutting'];

function buildLineFromAppliedRecord(row: AppliedProcessCostRecord): ProcessLineCost {
  return {
    process: APPLIED_PROCESS_LABEL_FOR_CLASS[row.machine_class] ?? row.machine_class,
    processGroup: row.process_group ?? undefined,
    processRoute: row.process_route ?? undefined,
    operation: row.operation ?? undefined,
    setupCost: r2(Number(row.setup_cost_per_part ?? 0)),
    runCost: r2(Number(row.total_cycle_cost_per_part ?? 0)),
    totalCost: r2(Number(row.total_cost_per_part ?? 0)),
    cycleTimeMin: Number(row.cycle_time ?? 0) / 60,
    setupTimeMin: Number(row.setup_time ?? 0),
    hourlyRate: r2(Number(row.direct_rate ?? 0)),
    rateSource: row.mhr_id ? 'mhr_database' : 'default_rate',
    machineClass: row.machine_class,
    machineName: row.machine_name ?? null,
    commodityCode: null,
  };
}

export function applyPersistedRouteToSummary(
  summary: CostSummaryDto,
  appliedRows: AppliedProcessCostRecord[],
): CostSummaryDto {
  const cuttingRow = appliedRows.find((r) => APPLIED_CUTTING_CLASSES.includes(r.machine_class));
  const pbRow = appliedRows.find((r) => r.machine_class === 'press_brake');
  if (!cuttingRow && !pbRow) return summary;

  const processLines = [...summary.processLines];
  let laserMin = summary.cycleTimes.laserMin;
  let pressBrakeMin = summary.cycleTimes.pressBrakeMin;
  let extraCuttingMin = 0; // cycleTimes has no turret/waterjet slot — folded into totalMin only

  if (cuttingRow) {
    const appliedLine = buildLineFromAppliedRecord(cuttingRow);
    const idx = processLines.findIndex((l) => APPLIED_CUTTING_LABELS.includes(l.process));
    if (idx >= 0) processLines[idx] = appliedLine; else processLines.push(appliedLine);
    const isLaser = cuttingRow.machine_class === 'fiber_laser' || cuttingRow.machine_class === 'co2_laser';
    laserMin = isLaser ? appliedLine.cycleTimeMin : 0;
    extraCuttingMin = isLaser ? 0 : appliedLine.cycleTimeMin;
  }

  if (pbRow) {
    const appliedLine = buildLineFromAppliedRecord(pbRow);
    const idx = processLines.findIndex((l) => l.process === 'Press Brake');
    if (idx >= 0) processLines[idx] = appliedLine; else processLines.push(appliedLine);
    pressBrakeMin = appliedLine.cycleTimeMin;
  }

  const totalProcessCost = r2(processLines.reduce((s, l) => s + l.totalCost, 0));
  return {
    ...summary,
    processLines,
    totalProcessCost,
    totalCost: r2(summary.materialCost + totalProcessCost),
    cycleTimes: {
      ...summary.cycleTimes,
      laserMin,
      pressBrakeMin,
      totalMin: r2(laserMin + pressBrakeMin + summary.cycleTimes.tappingMin + summary.cycleTimes.deburrMin + extraCuttingMin),
    },
  };
}
