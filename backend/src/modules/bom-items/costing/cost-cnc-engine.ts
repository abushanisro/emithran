import { TAP_CYCLE_SEC, TAPPING_MHR_INR, DEBURRING_MHR_INR, RATES_SOURCE_LABEL } from './default-rates';
import type { MHRRateInput } from './cost-engine';
import { computeSustainability } from './cost-engine';
import type { CostSummaryDto, ProcessLineCost } from '../dto/cost-breakdown.dto';

// ── Types ─────────────────────────────────────────────────────────────────────

export type MaterialClass =
  | 'aluminum' | 'mild_steel' | 'stainless'
  | 'titanium' | 'copper_alloy' | 'tool_steel' | 'plastic';

export type CNCMachineClass =
  | 'cnc_3ax_vmc' | 'cnc_4ax_vmc' | 'cnc_5ax_mc'
  | 'cnc_lathe' | 'cnc_lathe_live' | 'cnc_mill_turn';

export interface CNCCostInput {
  volume: number;          // mm³ (finish volume from CAD)
  surfaceArea: number;     // mm²
  maxLength: number;       // mm (bounding box)
  maxWidth: number;
  maxHeight: number;
  holeCount: number;
  holeGroups: Array<{ diameter_mm: number; count: number }>;
  pocketCount: number;
  materialGrade: string | null;
  materialCostPerKg: number;
  materialDensityKgM3: number;
  materialSource: 'db' | 'default';
  threads: Array<{ size: string; count: number }>;
  tightestToleranceMm: number | null;
  gdtFeatureCount: number;
  batchSize: number;
  family: string;
  finishedWeightKg: number;   // net part weight (BOMItem.weight)
  mhrRate: MHRRateInput;      // machine-specific rate for the selected class
  tappingRate: MHRRateInput;
  deburrRate: MHRRateInput;
}

export interface CNCCapabilityResult {
  overallCapable: boolean;
  machineCapabilityWarnings: string[];
}

// ── Material class detection ──────────────────────────────────────────────────

export function detectMaterialClass(grade: string | null): MaterialClass {
  if (!grade) return 'mild_steel';
  const g = grade.toUpperCase();
  if (/6061|7075|5052|2024|1100|AA\d|\bAL\b/.test(g)) return 'aluminum';
  if (/SS\b|304\b|316\b|17-4|17-7|INCONEL|DUPLEX/.test(g)) return 'stainless';
  if (/\bTI\b|TI-6|GRADE 5|GRADE 2/.test(g)) return 'titanium';
  if (/BRASS|BRONZE|C36|C26|COPPER/.test(g)) return 'copper_alloy';
  if (/P20|H13|D2\b|M2\b|TOOL STEEL/.test(g)) return 'tool_steel';
  if (/DELRIN|POM|ACETAL|\bPA6\b|\bPA66\b|\bPA\d|\bNYLON\b|\bABS\b|\bPEEK\b|\bPTFE\b|\bULTEM\b|POLYCARBONATE|\bPC\b|\bPP\b|\bPE\b|PLASTIC/.test(g)) return 'plastic';
  return 'mild_steel';
}

// ── MRR tables (mm³/min, carbide tooling) ────────────────────────────────────

const MILLING_MRR: Record<MaterialClass, number> = {
  aluminum:     60_000,
  mild_steel:   12_000,
  stainless:     5_000,
  titanium:      3_000,
  copper_alloy: 40_000,
  tool_steel:    3_000,
  plastic:      150_000,  // Engineering plastics (POM/Delrin) cut ~2.5× faster than aluminum
};

const TURNING_MRR: Record<MaterialClass, number> = {
  aluminum:     80_000,
  mild_steel:   20_000,
  stainless:     8_000,
  titanium:      4_000,
  copper_alloy: 60_000,
  tool_steel:    5_000,
  plastic:      200_000,  // High surface speed; limited by chip clearance, not cutting force
};

// ── Drill cycle times (sec per hole) ─────────────────────────────────────────

const DRILL_CYCLE_SEC: Record<'small' | 'medium' | 'large' | 'xlarge', number> = {
  small:  8,    // Ø < 6 mm
  medium: 14,   // 6–12 mm
  large:  22,   // 12–25 mm
  xlarge: 40,   // > 25 mm
};

function drillDiamClass(diam: number): 'small' | 'medium' | 'large' | 'xlarge' {
  if (diam < 6) return 'small';
  if (diam < 12) return 'medium';
  if (diam <= 25) return 'large';
  return 'xlarge';
}

// ── Per-machine constants ─────────────────────────────────────────────────────

const FIXTURE_COST_INR: Record<CNCMachineClass, number> = {
  cnc_3ax_vmc:     500,
  cnc_4ax_vmc:   1_000,
  cnc_5ax_mc:    2_000,
  cnc_lathe:       300,
  cnc_lathe_live:  500,
  cnc_mill_turn:   800,
};

const SETUP_COUNT: Record<CNCMachineClass, number> = {
  cnc_3ax_vmc: 3, cnc_4ax_vmc: 2, cnc_5ax_mc: 1,
  cnc_lathe: 2, cnc_lathe_live: 1, cnc_mill_turn: 1,
};

const BASE_SETUP_MIN: Record<CNCMachineClass, number> = {
  cnc_3ax_vmc:  20, cnc_4ax_vmc: 30, cnc_5ax_mc: 45,
  cnc_lathe:    15, cnc_lathe_live: 20, cnc_mill_turn: 35,
};

const INSPECTION_MHR_INR = 450;  // ₹/hr — quality technician + gauge / CMM

// ── Machine capability envelopes ──────────────────────────────────────────────

const MACHINE_ENVELOPE: Record<CNCMachineClass, { l: number; w: number; h: number; maxWeightKg: number }> = {
  cnc_3ax_vmc:    { l: 600, w: 400, h: 400, maxWeightKg: 500 },
  cnc_4ax_vmc:    { l: 500, w: 400, h: 400, maxWeightKg: 400 },
  cnc_5ax_mc:     { l: 400, w: 400, h: 400, maxWeightKg: 300 },
  cnc_lathe:      { l: 600, w: 300, h: 300, maxWeightKg: 200 },
  cnc_lathe_live: { l: 500, w: 250, h: 250, maxWeightKg: 150 },
  cnc_mill_turn:  { l: 600, w: 350, h: 350, maxWeightKg: 300 },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function r2(n: number): number { return Math.round(n * 100) / 100; }
function r3(n: number): number { return Math.round(n * 1000) / 1000; }

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

function computeTappingMin(threads: Array<{ size: string; count: number }>): number {
  return threads.reduce((sum, t) => sum + t.count * (TAP_CYCLE_SEC[t.size] ?? 10), 0) / 60;
}

function computeInspectionMin(
  holeCount: number,
  threadCount: number,
  tightestToleranceMm: number | null,
  gdtFeatureCount: number,
): number {
  // CMM setup + fixtured part positioning — fixed base regardless of feature count
  const base = 5;
  // Spot-check 1-in-5 holes, capped at 15 sampled holes. 0.5 min/hole (touch-probe cycle)
  const holeSample = Math.min(Math.ceil(holeCount / 5), 15) * 0.5;
  // Thread GO/NO-GO gauge check — cap at 6 unique thread sizes
  const threadCheck = Math.min(threadCount, 6) * 0.4;
  // Tight tolerance: adds CMM detailed measurement pass
  const tolAdder = (tightestToleranceMm != null && tightestToleranceMm <= 0.05) ? 8 : 0;
  // GD&T: each feature adds a CMM routine (cap at 5 features × 3 min)
  const gdtAdder = Math.min(gdtFeatureCount, 5) * 3;
  return base + holeSample + threadCheck + tolAdder + gdtAdder;
}

// ── Route complexity score (0–100) ───────────────────────────────────────────
// Inputs: raw feature counts + setup count per machine class.
// Used downstream for production scenario selection, AI recommendations, and
// quoting confidence bands. Each bucket contributes 0–20 points.

export function computeRouteComplexityScore(
  holeCount: number,
  pocketCount: number,
  threadCount: number,
  setupCount: number,
  gdtFeatureCount: number,
): number {
  const holeScore   = Math.min(holeCount   / 30, 1) * 20;
  const pocketScore = Math.min(pocketCount / 10, 1) * 20;
  const threadScore = Math.min(threadCount / 10, 1) * 20;
  const setupScore  = Math.min((setupCount - 1) / 2, 1) * 20;  // 1→0, 2→10, 3→20
  const gdtScore    = Math.min(gdtFeatureCount / 5, 1) * 20;
  return Math.round(holeScore + pocketScore + threadScore + setupScore + gdtScore);
}

// ── Machine capability check ──────────────────────────────────────────────────

export function checkCNCCapability(
  machineClass: CNCMachineClass,
  maxLength: number,
  maxWidth: number,
  maxHeight: number,
  weightKg: number,
): CNCCapabilityResult {
  const env = MACHINE_ENVELOPE[machineClass];
  const warnings: string[] = [];
  if (maxLength > env.l || maxWidth > env.w || maxHeight > env.h) {
    warnings.push(
      `Part envelope (${maxLength}×${maxWidth}×${maxHeight} mm) exceeds machine working volume ` +
      `(${env.l}×${env.w}×${env.h} mm).`,
    );
  }
  if (weightKg > 0 && weightKg > env.maxWeightKg) {
    warnings.push(
      `Part weight (${r2(weightKg)} kg) exceeds machine weight capacity (${env.maxWeightKg} kg).`,
    );
  }
  return { overallCapable: warnings.length === 0, machineCapabilityWarnings: warnings };
}

// ── CNC Milled cost summary ──────────────────────────────────────────────────

export function computeCNCMilledCostSummary(
  input: CNCCostInput,
  machineClass: CNCMachineClass,
): CostSummaryDto {
  const {
    volume, surfaceArea, maxLength, maxWidth, maxHeight,
    holeCount, holeGroups, materialGrade, materialCostPerKg,
    materialDensityKgM3, materialSource, threads, tightestToleranceMm,
    gdtFeatureCount, batchSize, family, finishedWeightKg, mhrRate, tappingRate, deburrRate,
  } = input;

  const warnings: string[] = [];
  const processLines: ProcessLineCost[] = [];
  const matClass = detectMaterialClass(materialGrade);

  // ── Billet ────────────────────────────────────────────────────────────────
  const billetVolMm3 = maxLength * maxWidth * maxHeight;
  const billetWeightKg = r3((billetVolMm3 / 1e9) * materialDensityKgM3);
  const materialCost = r2(billetWeightKg * materialCostPerKg * 1.05);

  if (!materialGrade) warnings.push('Material grade not set — default mild steel rates applied');
  if (billetVolMm3 === 0) warnings.push('Bounding box is zero — billet cost may be inaccurate');

  // ── Setup (amortised over batchSize) ─────────────────────────────────────
  const setupCount = SETUP_COUNT[machineClass];
  const setupMin = (setupCount * BASE_SETUP_MIN[machineClass]) / Math.max(batchSize, 1);
  const setupCostVal = r2((setupMin / 60) * mhrRate.rate);
  processLines.push(makeLine('Setup', setupCostVal, 0, setupMin, mhrRate));

  // ── Fixture (amortised) ──────────────────────────────────────────────────
  const fixtureCost = r2(FIXTURE_COST_INR[machineClass] / Math.max(batchSize, 1));
  processLines.push({
    process: 'Fixture',
    setupCost: fixtureCost,
    runCost: 0,
    totalCost: fixtureCost,
    cycleTimeMin: 0,
    hourlyRate: 0,
    rateSource: 'default_rate',
    machineClass,
    machineName: null,
    commodityCode: null,
  });

  // ── Roughing ─────────────────────────────────────────────────────────────
  const materialRemovalMm3 = Math.max(0, billetVolMm3 - volume);
  const mrr = MILLING_MRR[matClass];
  const roughingMin = materialRemovalMm3 > 0 ? (materialRemovalMm3 / mrr) * 1.3 : 0;
  if (roughingMin > 0) {
    processLines.push(makeLine('CNC Roughing', 0, r2((roughingMin / 60) * mhrRate.rate), roughingMin, mhrRate));
  } else {
    warnings.push('Volume data unavailable — roughing time estimated at 0');
  }

  // ── Drilling ──────────────────────────────────────────────────────────────
  let drillingMin = 0;
  if (holeGroups.length > 0) {
    drillingMin = holeGroups.reduce(
      (sum, g) => sum + g.count * DRILL_CYCLE_SEC[drillDiamClass(g.diameter_mm)] / 60, 0,
    );
  } else if (holeCount > 0) {
    drillingMin = (holeCount * DRILL_CYCLE_SEC.medium) / 60;
  }
  if (drillingMin > 0) {
    processLines.push(makeLine('Drilling', 0, r2((drillingMin / 60) * mhrRate.rate), drillingMin, mhrRate));
  }

  // ── Tapping ───────────────────────────────────────────────────────────────
  const threadCount = threads.reduce((s, t) => s + t.count, 0);
  const tappingMin = threads.length > 0 ? computeTappingMin(threads) : 0;
  if (tappingMin > 0) {
    const tapSetup = r2((10 / 60) * tappingRate.rate / Math.max(batchSize, 1));
    const tapRun = r2((tappingMin / 60) * tappingRate.rate);
    processLines.push(makeLine('Tapping', tapSetup, tapRun, tappingMin, tappingRate));
  }

  // ── Deburring ────────────────────────────────────────────────────────────
  const deburrMin = surfaceArea > 0 ? (surfaceArea / 10_000) * 0.5 : 0;
  if (deburrMin > 0) {
    processLines.push(makeLine('Deburring', 0, r2((deburrMin / 60) * deburrRate.rate), deburrMin, deburrRate));
  }

  // ── Inspection ────────────────────────────────────────────────────────────
  const inspectionMin = computeInspectionMin(holeCount, threadCount, tightestToleranceMm, gdtFeatureCount);
  if (inspectionMin > 0) {
    const inspRate: MHRRateInput = { rate: INSPECTION_MHR_INR, source: 'default_rate', machineClass: 'inspection', machineName: null, commodityCode: null };
    processLines.push(makeLine('Inspection', 0, r2((inspectionMin / 60) * INSPECTION_MHR_INR), inspectionMin, inspRate));
  }

  const totalProcessCost = r2(processLines.reduce((s, l) => s + l.totalCost, 0));
  const totalCost = r2(materialCost + totalProcessCost);
  const totalMin = r2(processLines.reduce((s, l) => s + l.cycleTimeMin, 0));

  const utilizationPct = r2(billetWeightKg > 0 ? (finishedWeightKg / billetWeightKg) * 100 : 0);

  const sustainability = computeSustainability(
    materialGrade, materialCostPerKg, finishedWeightKg, billetWeightKg, batchSize, processLines,
  );

  return {
    materialCost,
    materialGrade: materialGrade ?? 'Unknown',
    grossWeightKg: billetWeightKg,
    materialCostPerKg,
    materialSource,
    processLines,
    totalProcessCost,
    totalCost,
    cycleTimes: {
      laserMin:      r2(roughingMin),
      pressBrakeMin: r2(setupMin),
      tappingMin:    r2(tappingMin),
      deburrMin:     r2(deburrMin + inspectionMin),
      totalMin,
    },
    batchSize,
    family,
    warnings,
    ratesSource: RATES_SOURCE_LABEL,
    sustainability,
    setupCount,
    materialRemoval: {
      billetWeightKg,
      finishedWeightKg: r3(finishedWeightKg),
      utilizationPct,
      chipScrapPct: r2(100 - utilizationPct),
    },
  };
}

// ── CNC Turned cost summary ──────────────────────────────────────────────────

export function computeCNCTurnedCostSummary(
  input: CNCCostInput,
  machineClass: CNCMachineClass,
): CostSummaryDto {
  const {
    volume, maxLength, maxWidth, maxHeight, holeCount, holeGroups,
    materialGrade, materialCostPerKg, materialDensityKgM3, materialSource,
    threads, tightestToleranceMm, gdtFeatureCount, batchSize, family,
    finishedWeightKg, mhrRate, tappingRate, deburrRate,
  } = input;

  // Drilled hole count from grouped diameter data is accurate; raw holeCount includes
  // all cylindrical faces (OD steps, grooves, etc.) which inflates boring + inspection time.
  const drilledHoleCount = holeGroups.length > 0
    ? holeGroups.reduce((s, g) => s + g.count, 0)
    : holeCount;

  const warnings: string[] = [];
  const processLines: ProcessLineCost[] = [];
  const matClass = detectMaterialClass(materialGrade);

  // Detect stale sheet-metal material grade on a CNC part (auto-fill set it before
  // classification was corrected). Warn so the user knows to re-run auto-fill or
  // manually set the material — cost will be wrong until this is resolved.
  if (materialGrade && /sheet|plate/i.test(materialGrade)) {
    warnings.push(
      `Material "${materialGrade}" looks like a sheet/plate product form — this part is CNC machined. ` +
      'Re-run Auto-Fill or set the material grade to a bar/billet grade for accurate cost.',
    );
  }

  // ── Bar stock ────────────────────────────────────────────────────────────
  const barDiamMm = Math.max(maxWidth, maxHeight) * 1.1;
  const barLengthMm = maxLength * 1.1;
  const barVolMm3 = Math.PI * (barDiamMm / 2) ** 2 * barLengthMm;
  const barWeightKg = r3((barVolMm3 / 1e9) * materialDensityKgM3);
  const materialCost = r2(barWeightKg * materialCostPerKg * 1.05);

  if (!materialGrade) warnings.push('Material grade not set — default mild steel rates applied');

  // ── Setup (amortised) ────────────────────────────────────────────────────
  const setupCount = SETUP_COUNT[machineClass];
  const setupMin = (setupCount * BASE_SETUP_MIN[machineClass]) / Math.max(batchSize, 1);
  const setupCostVal = r2((setupMin / 60) * mhrRate.rate);
  processLines.push(makeLine('Setup', setupCostVal, 0, setupMin, mhrRate));

  // ── Fixture (amortised) ──────────────────────────────────────────────────
  const fixtureCost = r2(FIXTURE_COST_INR[machineClass] / Math.max(batchSize, 1));
  processLines.push({
    process: 'Fixture',
    setupCost: fixtureCost,
    runCost: 0,
    totalCost: fixtureCost,
    cycleTimeMin: 0,
    hourlyRate: 0,
    rateSource: 'default_rate',
    machineClass,
    machineName: null,
    commodityCode: null,
  });

  // ── OD Turning ───────────────────────────────────────────────────────────
  const materialRemovalMm3 = Math.max(0, barVolMm3 - volume);
  const turningMin = materialRemovalMm3 > 0 ? (materialRemovalMm3 / TURNING_MRR[matClass]) * 1.2 : 0;
  if (turningMin > 0) {
    processLines.push(makeLine('OD Turning', 0, r2((turningMin / 60) * mhrRate.rate), turningMin, mhrRate));
  }

  // ── Boring / Drilling ─────────────────────────────────────────────────────
  // Use diameter-classified cycle times (same as milled) — flat 20 sec/hole was sized
  // for steel; for small-diameter holes in plastic the actual time is 5-8 sec.
  const boringMin = holeGroups.length > 0
    ? holeGroups.reduce((total, g) => total + (g.count * DRILL_CYCLE_SEC[drillDiamClass(g.diameter_mm)]) / 60, 0)
    : drilledHoleCount > 0 ? (drilledHoleCount * 14) / 60 : 0;  // 14 sec/hole fallback (medium)
  if (boringMin > 0) {
    processLines.push(makeLine('Boring/Drilling', 0, r2((boringMin / 60) * mhrRate.rate), boringMin, mhrRate));
  }

  // ── Tapping ───────────────────────────────────────────────────────────────
  const threadCount = threads.reduce((s, t) => s + t.count, 0);
  const tappingMin = threads.length > 0 ? computeTappingMin(threads) : 0;
  if (tappingMin > 0) {
    const tapSetup = r2((10 / 60) * tappingRate.rate / Math.max(batchSize, 1));
    const tapRun = r2((tappingMin / 60) * tappingRate.rate);
    processLines.push(makeLine('Tapping', tapSetup, tapRun, tappingMin, tappingRate));
  }

  // ── Secondary setup / rechucking (2-axis lathe only) ─────────────────────
  // A 2-axis lathe cannot do cross holes or radial milling in one setup.
  // The part must be unloaded and transferred to a drill press or VMC —
  // this transfer + re-clamping adds ~15 min to EVERY PART's cycle (not amortised setup).
  // Live-tooling and mill-turn complete all features in a single chucking → 0 penalty.
  const rechuckMin = SETUP_COUNT[machineClass] > 1 ? 15 : 0;
  if (rechuckMin > 0) {
    processLines.push(makeLine('Secondary Setup (Rechuck)', 0, r2((rechuckMin / 60) * mhrRate.rate), rechuckMin, mhrRate));
  }

  // ── Facing + Parting (constant 2 min) ────────────────────────────────────
  const facingMin = 2;
  processLines.push(makeLine('Facing + Parting', 0, r2((facingMin / 60) * mhrRate.rate), facingMin, mhrRate));

  // ── Inspection ────────────────────────────────────────────────────────────
  const inspectionMin = computeInspectionMin(drilledHoleCount, threadCount, tightestToleranceMm, gdtFeatureCount);
  if (inspectionMin > 0) {
    const inspRate: MHRRateInput = { rate: INSPECTION_MHR_INR, source: 'default_rate', machineClass: 'inspection', machineName: null, commodityCode: null };
    processLines.push(makeLine('Inspection', 0, r2((inspectionMin / 60) * INSPECTION_MHR_INR), inspectionMin, inspRate));
  }

  const totalProcessCost = r2(processLines.reduce((s, l) => s + l.totalCost, 0));
  const totalCost = r2(materialCost + totalProcessCost);
  const totalMin = r2(processLines.reduce((s, l) => s + l.cycleTimeMin, 0));

  const utilizationPct = r2(barWeightKg > 0 ? (finishedWeightKg / barWeightKg) * 100 : 0);

  const sustainability = computeSustainability(
    materialGrade, materialCostPerKg, finishedWeightKg, barWeightKg, batchSize, processLines,
  );

  return {
    materialCost,
    materialGrade: materialGrade ?? 'Unknown',
    grossWeightKg: barWeightKg,
    materialCostPerKg,
    materialSource,
    processLines,
    totalProcessCost,
    totalCost,
    cycleTimes: {
      laserMin:      r2(turningMin),
      pressBrakeMin: r2(setupMin),
      tappingMin:    r2(tappingMin),
      deburrMin:     r2(boringMin + inspectionMin),
      totalMin,
    },
    batchSize,
    family,
    warnings,
    ratesSource: RATES_SOURCE_LABEL,
    sustainability,
    setupCount,
    materialRemoval: {
      billetWeightKg: barWeightKg,
      finishedWeightKg: r3(finishedWeightKg),
      utilizationPct,
      chipScrapPct: r2(100 - utilizationPct),
    },
  };
}

// ── Mill-Turn cost summary ────────────────────────────────────────────────────
// Separate entry point for mill_turn family.  Currently delegates to the turned
// engine using the cnc_mill_turn machine class (single-setup, live tooling, full
// bar removal).  When Y-axis milling, sub-spindle, and live-tool cycle times are
// modelled, the additional cost lines belong here — not in computeCNCTurnedCostSummary.

export function computeMillTurnCostSummary(
  input: CNCCostInput,
): CostSummaryDto {
  return computeCNCTurnedCostSummary(input, 'cnc_mill_turn');
}
