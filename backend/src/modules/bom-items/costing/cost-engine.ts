import {
  TAPPING_SETUP_MIN, MATERIAL_OVERHEAD_PCT,
  TAP_CYCLE_SEC,
  DEBURR_SEC_PER_METRE, DEBURR_SEC_PER_PIERCE,
  RATES_SOURCE_LABEL,
} from './default-rates';
import {
  ENERGY_KWH_PER_HR, GRID_CO2_KG_PER_KWH,
  MATERIAL_CO2_KG_PER_KG, MATERIAL_RECYCLABILITY_PCT,
  SUSTAINABILITY_FACTORS_LABEL,
} from './sustainability-factors';
import type { LaserCutParams } from './sheet-metal-lookup.service';
import type { NestingResult } from './sheet-metal-nesting.engine';
import type { CostSummaryDto, ProcessLineCost, ProcessCO2, SustainabilitySummaryDto } from '../dto/cost-breakdown.dto';
import { computeSurfaceTreatmentLine } from './cost-surface-treatment';
import type { SurfaceTreatmentDbRate } from './default-rates';

export interface MHRRateInput {
  rate: number;
  source: 'mhr_database' | 'default_rate' | 'no_db_rate' | 'tier_synthetic' | 'benchmark_override';
  machineClass: string;
  machineName: string | null;
  commodityCode: string | null;
  selection?: import('../dto/machine-selection.dto').MachineSelectionResult;
  labourRate?: number | null;
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
  utsMpa?: number;                // from raw_materials (for tonnage calc)
  shearStrengthMpa?: number;      // from raw_materials (for part allowance)
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
  laserParams?: LaserCutParams;
  handlingTimeMin?: number;       // Table 2 for sheet weight
  toolSetupPressMin?: number;     // Table 3A for press tonnage
  toolSetupBrakeMin?: number;     // Table 3B for brake tool length
  manualStrokeTimeSec?: number;   // Table 4 per stroke (already scaled × bendCount by caller)
  samplingRate?: number;          // Table 6 fraction
  inspectionTimeMin?: number;     // per-piece (default 0.5)

  // ── Nesting result (pre-resolved) ─────────────────────────────────────────
  nestingResult?: NestingResult;

  // ── Threads & scenario ────────────────────────────────────────────────────
  threads: Array<{ size: string; count: number }>;
  batchSize: number;
  family: string;

  // ── MHR rates ─────────────────────────────────────────────────────────────
  mhrRates?: {
    laser: MHRRateInput;
    pressBrake: MHRRateInput;
    deburring: MHRRateInput;
    tapping: MHRRateInput;
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

// ── 5-term aPriori cost formula ────────────────────────────────────────────────
// Returns { machineCost, setupCost, laborCost, inspCost, yieldCost, total }
// All rates are per-hour in local currency; times are in minutes.
function aprioriTerms(args: {
  mhrPerHr: number;
  dlrPerHr: number;
  qairPerHr: number;
  nDL: number;
  cycleTimeMin: number;
  setupTimeMin: number;
  inspTimeMin: number;
  samplingRate: number;
  yieldPct: number;
  netMatCost: number;
  netWeightKg: number;
  scrapPricePerKg: number;
}): { machineCost: number; setupCost: number; laborCost: number; inspCost: number; yieldCost: number; total: number } {
  const { mhrPerHr, dlrPerHr, qairPerHr, nDL, cycleTimeMin, setupTimeMin,
          inspTimeMin, samplingRate, yieldPct, netMatCost, netWeightKg, scrapPricePerKg } = args;

  const mhrMin = mhrPerHr / 60;
  const dlrMin = dlrPerHr / 60;
  const qairMin = qairPerHr / 60;

  const machineCost = mhrMin * cycleTimeMin;
  // Setup: machine idle time + DL idle time (no SL in this deployment)
  const setupCost = (mhrMin + dlrMin * nDL) * setupTimeMin;
  const laborCost = dlrMin * nDL * cycleTimeMin;
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
    laserParams,
    handlingTimeMin = 0.25,
    toolSetupBrakeMin = 10,
    manualStrokeTimeSec,
    samplingRate = 0.08,
    inspectionTimeMin = 0.5,
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
    // aPriori nesting path — use nesting-derived gross weight
    materialCost = nestingResult.netMaterialCost;
    grossWeightKg = nestingResult.grossWeightPerPartKg;
    if (nestingResult.utilisationPct < 75) {
      warnings.push(
        `Material utilisation ${nestingResult.utilisationPct}% is low — ` +
        `consider panel nesting optimisation (${nestingResult.partsPerSheet} parts/sheet on ` +
        `${nestingResult.sheetWidthMm}×${nestingResult.sheetLengthMm}mm)`,
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
  let laserMin = 0;
  if (cutLengthMm > 0 || pierceCount > 0) {
    let speedMPerMin: number;
    let pierceTimeMin: number;

    if (laserParams) {
      speedMPerMin = laserParams.cuttingSpeedMPerMin;
      pierceTimeMin = laserParams.pierceTimeMin;
      if (!laserParams.dataFound) {
        warnings.push('Laser cut speed from fallback table — seed sm_lookup_laser_cut for accurate cycle times');
      }
    } else {
      // Absolute last resort — 3 m/min baseline
      speedMPerMin = 3;
      pierceTimeMin = 0.025;
      warnings.push('No laser params available — using conservative fallback speed');
    }

    const cutTimeMin = cutLengthMm > 0 && speedMPerMin > 0
      ? (cutLengthMm / (speedMPerMin * 1000))
      : 0;
    const pierceMin = pierceCount * pierceTimeMin;
    laserMin = cutTimeMin + pierceMin;

    // Setup: program recall time + sheet handling per lot
    // partsPerSheet from nesting; default 4 if nesting not run
    const partsPerSheet = nestingResult?.partsPerSheet ?? 4;
    const sheetsPerLot = Math.ceil(batchSize / partsPerSheet);
    const setupTimeMin = (handlingTimeMin * sheetsPerLot) / Math.max(batchSize, 1);

    const t = aprioriTerms({
      mhrPerHr: laserRate.rate,
      dlrPerHr,
      qairPerHr,
      nDL: machineOperators,
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
      cycleTimeMin: r2(laserMin),
      hourlyRate: laserRate.rate,
      rateSource: laserRate.source,
      machineClass: laserRate.machineClass,
      machineName: laserRate.machineName,
      commodityCode: laserRate.commodityCode,
      labourRate: laserRate.labourRate ?? null,
    });
  }

  // ── Press brake ───────────────────────────────────────────────────────────
  let pressBrakeMin = 0;
  if (bendCount > 0) {
    let cycleTimeSec: number;

    if (manualStrokeTimeSec != null) {
      // manualStrokeTimeSec from service is already per-bend; multiply by bendCount
      cycleTimeSec = manualStrokeTimeSec + handlingTimeMin * 60;
    } else {
      // Fallback: 15 sec/bend (old hardcoded baseline)
      cycleTimeSec = bendCount * 15 + handlingTimeMin * 60;
      warnings.push('Press brake stroke time from fallback — seed sm_lookup_manual_stroke for accurate cycle times');
    }
    pressBrakeMin = cycleTimeSec / 60;

    // Setup: tool loading / lot size
    const setupTimeMin = toolSetupBrakeMin / Math.max(batchSize, 1);

    const t = aprioriTerms({
      mhrPerHr: pbRate.rate,
      dlrPerHr,
      qairPerHr,
      nDL: machineOperators,
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
      cycleTimeMin: r2(pressBrakeMin),
      hourlyRate: pbRate.rate,
      rateSource: pbRate.source,
      machineClass: pbRate.machineClass,
      machineName: pbRate.machineName,
      commodityCode: pbRate.commodityCode,
      labourRate: pbRate.labourRate ?? null,
    });
  }

  // ── Deburring ─────────────────────────────────────────────────────────────
  let deburrMin = 0;
  if (cutLengthMm > 0) {
    const deburrSec = (cutLengthMm / 1000) * DEBURR_SEC_PER_METRE + pierceCount * DEBURR_SEC_PER_PIERCE;
    deburrMin = deburrSec / 60;

    const t = aprioriTerms({
      mhrPerHr: deburrRate.rate,
      dlrPerHr,
      qairPerHr,
      nDL: machineOperators,
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
      cycleTimeMin: r2(deburrMin),
      hourlyRate: deburrRate.rate,
      rateSource: deburrRate.source,
      machineClass: deburrRate.machineClass,
      machineName: deburrRate.machineName,
      commodityCode: deburrRate.commodityCode,
      labourRate: deburrRate.labourRate ?? null,
    });
  }

  // ── Tapping ───────────────────────────────────────────────────────────────
  let tappingMin = 0;
  if (threads.length > 0) {
    const totalSec = threads.reduce((sum, t) => sum + t.count * (TAP_CYCLE_SEC[t.size] ?? 10), 0);
    tappingMin = totalSec / 60;
    const setupTimeMin = TAPPING_SETUP_MIN / Math.max(batchSize, 1);

    const t = aprioriTerms({
      mhrPerHr: tappingRate.rate,
      dlrPerHr,
      qairPerHr,
      nDL: 1, // single operator for tapping
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
      cycleTimeMin: r2(tappingMin),
      hourlyRate: tappingRate.rate,
      rateSource: tappingRate.source,
      machineClass: tappingRate.machineClass,
      machineName: tappingRate.machineName,
      commodityCode: tappingRate.commodityCode,
      labourRate: tappingRate.labourRate ?? null,
    });
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
      laserMin: r2(laserMin),
      pressBrakeMin: r2(pressBrakeMin),
      tappingMin: r2(tappingMin),
      deburrMin: r2(deburrMin),
      totalMin: r2(laserMin + pressBrakeMin + tappingMin + deburrMin),
    },
    batchSize,
    family,
    warnings,
    ratesSource: RATES_SOURCE_LABEL,
    sustainability,
  };
}
