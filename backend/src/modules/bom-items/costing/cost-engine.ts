import {
  LASER_MHR_INR, PRESS_BRAKE_MHR_INR, DEBURRING_MHR_INR, TAPPING_MHR_INR,
  LASER_SETUP_MIN, PRESS_BRAKE_SETUP_MIN, TAPPING_SETUP_MIN,
  MATERIAL_OVERHEAD_PCT,
  LASER_SPEED_MM_PER_MIN, LASER_PIERCE_SEC, laserSpeedFactor,
  PRESS_BRAKE_SEC_PER_BEND,
  TAP_CYCLE_SEC,
  DEBURR_SEC_PER_METRE, DEBURR_SEC_PER_PIERCE,
  RATES_SOURCE_LABEL,
} from './default-rates';
import {
  ENERGY_KWH_PER_HR, GRID_CO2_KG_PER_KWH,
  MATERIAL_CO2_KG_PER_KG, MATERIAL_RECYCLABILITY_PCT,
  SUSTAINABILITY_FACTORS_LABEL,
} from './sustainability-factors';
import type { CostSummaryDto, ProcessLineCost, ProcessCO2, SustainabilitySummaryDto } from '../dto/cost-breakdown.dto';

export interface MHRRateInput {
  rate: number;
  source: 'mhr_database' | 'default_rate' | 'tier_synthetic';
  machineClass: string;
  machineName: string | null;
  commodityCode: string | null;
  // Full physics-based selection result; present when the capability selector ran
  selection?: import('../dto/machine-selection.dto').MachineSelectionResult;
}

export interface CostEngineInput {
  // Geometry — from FeatureGraphSummary or promoted BOM item columns
  sheetThicknessMm: number;
  cutLengthMm: number;
  pierceCount: number;
  bendCount: number;
  flatPatternAreaMm2: number;
  holeCount: number;

  // Material — resolved by caller before invoking engine
  materialGrade: string | null;
  materialCostPerKg: number;
  materialDensityKgM3: number;
  materialSource: 'db' | 'default';

  // Drawing-extracted threads (from drawing_intelligence.threads)
  threads: Array<{ size: string; count: number }>;

  // Scenario
  batchSize: number;
  family: string;

  // Optional: live MHR rates from mhr_records; fallback to default-rates when absent
  mhrRates?: {
    laser: MHRRateInput;
    pressBrake: MHRRateInput;
    deburring: MHRRateInput;
    tapping: MHRRateInput;
  };
}

// ── Find the nearest matching key in a numeric lookup table ──────────────────

function nearest(mm: number, table: Record<number, number>): number {
  const keys = Object.keys(table).map(Number).sort((a, b) => a - b);
  let best = keys[0];
  for (const k of keys) {
    if (Math.abs(k - mm) < Math.abs(best - mm)) best = k;
  }
  return best;
}

function r2(n: number): number { return Math.round(n * 100) / 100; }
function r3(n: number): number { return Math.round(n * 1000) / 1000; }

// ── Sustainability calculation ─────────────────────────────────────────────────

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

  // Contributor ranking — dominant driver immediately visible
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

  // Score (0–100): material efficiency 30 + CO₂ intensity 30 + recyclability 20 + process energy 20
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

// ── Main export ───────────────────────────────────────────────────────────────

export function computeCostSummary(input: CostEngineInput): CostSummaryDto {
  const {
    sheetThicknessMm, cutLengthMm, pierceCount, bendCount,
    flatPatternAreaMm2, materialGrade, materialCostPerKg,
    materialDensityKgM3, materialSource, threads, batchSize, family,
  } = input;

  const warnings: string[] = [];
  const processLines: ProcessLineCost[] = [];

  const laserRate   = input.mhrRates?.laser      ?? { rate: LASER_MHR_INR,       source: 'default_rate' as const, machineClass: 'fiber_laser',  machineName: null, commodityCode: null };
  const pbRate      = input.mhrRates?.pressBrake ?? { rate: PRESS_BRAKE_MHR_INR, source: 'default_rate' as const, machineClass: 'press_brake',  machineName: null, commodityCode: null };
  const deburrRate  = input.mhrRates?.deburring  ?? { rate: DEBURRING_MHR_INR,   source: 'default_rate' as const, machineClass: 'deburring',    machineName: null, commodityCode: null };
  const tappingRate = input.mhrRates?.tapping    ?? { rate: TAPPING_MHR_INR,     source: 'default_rate' as const, machineClass: 'tapping',      machineName: null, commodityCode: null };

  if (!materialGrade) warnings.push('Material grade not set — default mild steel rates applied');
  if (flatPatternAreaMm2 === 0) warnings.push('Flat pattern area is 0 — material cost may be inaccurate');
  if (sheetThicknessMm === 0) warnings.push('Sheet thickness is 0 — cutting speed lookup may be inaccurate');

  // ── Material cost ─────────────────────────────────────────────────────────
  const volumeMm3 = flatPatternAreaMm2 * sheetThicknessMm;
  const netWeightKg = (volumeMm3 / 1e9) * materialDensityKgM3;
  const grossWeightKg = netWeightKg * (1 + MATERIAL_OVERHEAD_PCT / 100);
  const materialCost = grossWeightKg * materialCostPerKg;

  // ── Laser cutting ─────────────────────────────────────────────────────────
  let laserMin = 0;
  if (cutLengthMm > 0 || pierceCount > 0) {
    const thk = sheetThicknessMm > 0 ? sheetThicknessMm : 2.0;
    const speedKey = nearest(thk, LASER_SPEED_MM_PER_MIN);
    const pierceKey = nearest(thk, LASER_PIERCE_SEC);
    // Speed table is mild-steel baseline — derate for stainless (N₂) / aluminium
    const speedMmPerMin = (LASER_SPEED_MM_PER_MIN[speedKey] ?? 3000) * laserSpeedFactor(materialGrade);
    const pierceSec = LASER_PIERCE_SEC[pierceKey] ?? 1.5;

    const cuttingSec = cutLengthMm > 0 ? (cutLengthMm / speedMmPerMin) * 60 : 0;
    const piercingTotalSec = pierceCount * pierceSec;
    const totalLaserSec = cuttingSec + piercingTotalSec;
    laserMin = totalLaserSec / 60;

    const setupCost = (LASER_SETUP_MIN / 60) * laserRate.rate / Math.max(batchSize, 1);
    const runCost = (totalLaserSec / 3600) * laserRate.rate;
    processLines.push({
      process: 'Laser Cutting',
      setupCost,
      runCost,
      totalCost: setupCost + runCost,
      cycleTimeMin: r2(laserMin),
      hourlyRate: laserRate.rate,
      rateSource: laserRate.source,
      machineClass: laserRate.machineClass,
      machineName: laserRate.machineName,
      commodityCode: laserRate.commodityCode,
    });
  }

  // ── Press brake ───────────────────────────────────────────────────────────
  let pressBrakeMin = 0;
  if (bendCount > 0) {
    const thk = sheetThicknessMm > 0 ? sheetThicknessMm : 2.0;
    const secPerBend = PRESS_BRAKE_SEC_PER_BEND[nearest(thk, PRESS_BRAKE_SEC_PER_BEND)] ?? 15;
    const totalPBSec = bendCount * secPerBend;
    pressBrakeMin = totalPBSec / 60;

    const setupCost = (PRESS_BRAKE_SETUP_MIN / 60) * pbRate.rate / Math.max(batchSize, 1);
    const runCost = (totalPBSec / 3600) * pbRate.rate;
    processLines.push({
      process: 'Press Brake',
      setupCost,
      runCost,
      totalCost: setupCost + runCost,
      cycleTimeMin: r2(pressBrakeMin),
      hourlyRate: pbRate.rate,
      rateSource: pbRate.source,
      machineClass: pbRate.machineClass,
      machineName: pbRate.machineName,
      commodityCode: pbRate.commodityCode,
    });
  }

  // ── Deburring ─────────────────────────────────────────────────────────────
  let deburrMin = 0;
  if (cutLengthMm > 0) {
    const deburrSec = (cutLengthMm / 1000) * DEBURR_SEC_PER_METRE + pierceCount * DEBURR_SEC_PER_PIERCE;
    deburrMin = deburrSec / 60;
    const runCost = (deburrSec / 3600) * deburrRate.rate;
    processLines.push({
      process: 'Deburring',
      setupCost: 0,
      runCost,
      totalCost: runCost,
      cycleTimeMin: r2(deburrMin),
      hourlyRate: deburrRate.rate,
      rateSource: deburrRate.source,
      machineClass: deburrRate.machineClass,
      machineName: deburrRate.machineName,
      commodityCode: deburrRate.commodityCode,
    });
  }

  // ── Tapping ───────────────────────────────────────────────────────────────
  let tappingMin = 0;
  if (threads.length > 0) {
    const totalSec = threads.reduce((sum, t) => sum + t.count * (TAP_CYCLE_SEC[t.size] ?? 10), 0);
    tappingMin = totalSec / 60;
    const setupCost = (TAPPING_SETUP_MIN / 60) * tappingRate.rate / Math.max(batchSize, 1);
    const runCost = (totalSec / 3600) * tappingRate.rate;
    processLines.push({
      process: 'Tapping',
      setupCost,
      runCost,
      totalCost: setupCost + runCost,
      cycleTimeMin: r2(tappingMin),
      hourlyRate: tappingRate.rate,
      rateSource: tappingRate.source,
      machineClass: tappingRate.machineClass,
      machineName: tappingRate.machineName,
      commodityCode: tappingRate.commodityCode,
    });
  }

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
