import {
  LASER_MHR_INR, PRESS_BRAKE_MHR_INR, DEBURRING_MHR_INR, TAPPING_MHR_INR,
  LASER_SETUP_MIN, PRESS_BRAKE_SETUP_MIN, TAPPING_SETUP_MIN,
  MATERIAL_OVERHEAD_PCT,
  LASER_SPEED_MM_PER_MIN, LASER_PIERCE_SEC,
  PRESS_BRAKE_SEC_PER_BEND,
  TAP_CYCLE_SEC,
  DEBURR_SEC_PER_METRE, DEBURR_SEC_PER_PIERCE,
  RATES_SOURCE_LABEL,
} from './default-rates';
import type { CostSummaryDto, ProcessLineCost } from '../dto/cost-breakdown.dto';

export interface MHRRateInput {
  rate: number;
  source: 'mhr_database' | 'default_rate';
  machineClass: string;
  machineName: string | null;
  commodityCode: string | null;
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
    const speedMmPerMin = LASER_SPEED_MM_PER_MIN[speedKey] ?? 3000;
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

  return {
    materialCost: r2(materialCost),
    materialGrade: materialGrade ?? 'Unknown',
    grossWeightKg: r3(grossWeightKg),
    materialCostPerKg,
    materialSource,
    processLines: processLines.map((l) => ({
      ...l,
      setupCost: r2(l.setupCost),
      runCost: r2(l.runCost),
      totalCost: r2(l.totalCost),
      hourlyRate: r2(l.hourlyRate),
      rateSource: l.rateSource,
    })),
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
  };
}
