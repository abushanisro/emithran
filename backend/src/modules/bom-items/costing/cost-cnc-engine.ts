import {
  TAP_CYCLE_SEC,
  TAPPING_MHR_INR,
  DEBURRING_MHR_INR,
  RATES_SOURCE_LABEL,
  CNC_STOCK_ALLOWANCE_PER_SIDE_MM,
  DEFAULT_COSTING_LOCATION,
  LOCATION_MHR_DEFAULTS,
  CMM_SETUP_MIN,
  INSPECTION_SAMPLING_DEFAULT,
  SURFACE_TREATMENT_RATES,
  classifySurfaceTreatment,
  type InspectionStagePolicy,
  type MachineClass,
} from './default-rates';
import { deriveGdtSeverity } from './gdt-severity';
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
  inspectionRate: MHRRateInput; // CMM / inspection station — carries amortized MHR when a DB record exists
  // Surface treatment callout from the drawing / coating field ("Type III Hardcoat
  // Black Anodize"); null when the part has none.
  surfaceTreatment: string | null;
  // Resolved quality plan (DB quality_plans row or code default). When unset,
  // INSPECTION_SAMPLING_DEFAULT applies.
  samplingPolicy?: InspectionStagePolicy;
  // Legacy per-item in-process override (1 = full measurement on every part);
  // wins over samplingPolicy.inProcessPerN. FAI and final stages still apply.
  samplingPerN?: number;
  // GD&T callouts for per-feature inspection time. timeMin is pre-resolved from
  // the inspection_rules table when available; the code matrix is the fallback.
  gdtFeatures?: Array<{ symbol: string; tolerance: number; timeMin?: number }>;
  // Digital Factory location — localizes fixture/tooling cost. Defaults to the
  // shared costing default so a missing value never silently prices in the wrong country.
  location?: string;
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

// India-benchmark fixture cost (soft jaws / plate fixture / chuck jaws) per class.
// NOT a universal number — fixtures are toolroom work priced in local labour.
// localizeFixtureCost() scales it to the costing location before use.
const FIXTURE_COST_INR: Record<CNCMachineClass, number> = {
  cnc_3ax_vmc:     500,
  cnc_4ax_vmc:   1_000,
  cnc_5ax_mc:    2_000,
  cnc_lathe:       300,
  cnc_lathe_live:  500,
  cnc_mill_turn:   800,
};

// Fixture cost in the location's local currency. The India table above is
// expressed as "machine-hour equivalents" of toolroom work: dividing by India's
// class benchmark rate and multiplying by the location's converts both currency
// AND local toolroom labour cost in one step (a US-built fixture is not an
// India-built fixture at spot FX). Same digit in every currency — the bug this
// replaces — understated fixtures ~10× outside India.
export function localizeFixtureCost(machineClass: CNCMachineClass, location: string): number {
  const inrCost = FIXTURE_COST_INR[machineClass];
  const defaults = LOCATION_MHR_DEFAULTS as Record<string, Partial<Record<MachineClass, number>>>;
  const indiaRate = defaults[DEFAULT_COSTING_LOCATION]?.[machineClass];
  const localRate = defaults[location]?.[machineClass];
  if (!indiaRate || !localRate) return inrCost; // unknown location → India benchmark unchanged
  return (inrCost / indiaRate) * localRate;
}

const SETUP_COUNT: Record<CNCMachineClass, number> = {
  cnc_3ax_vmc: 3, cnc_4ax_vmc: 2, cnc_5ax_mc: 1,
  cnc_lathe: 2, cnc_lathe_live: 1, cnc_mill_turn: 1,
};

const BASE_SETUP_MIN: Record<CNCMachineClass, number> = {
  cnc_3ax_vmc:  20, cnc_4ax_vmc: 30, cnc_5ax_mc: 45,
  cnc_lathe:    15, cnc_lathe_live: 20, cnc_mill_turn: 35,
};

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

export function computeInspectionMin(
  holeCount: number,
  threadCount: number,
  tightestToleranceMm: number | null,
  gdtFeatureCount: number,
  gdtFeatures?: Array<{ symbol: string; tolerance: number; timeMin?: number }>,
): number {
  // Part positioning + datum pickup — fixed base regardless of feature count
  const base = 5;
  // Spot-check 1-in-5 holes, capped at 15 sampled holes. 0.5 min/hole (touch-probe cycle)
  const holeSample = Math.min(Math.ceil(holeCount / 5), 15) * 0.5;
  // Thread GO/NO-GO gauge check — cap at 6 unique thread sizes
  const threadCheck = Math.min(threadCount, 6) * 0.4;
  // Tight tolerance: adds CMM detailed measurement pass
  const tolAdder = (tightestToleranceMm != null && tightestToleranceMm > 0 && tightestToleranceMm <= 0.05) ? 8 : 0;
  // GD&T: per-callout time — pre-resolved from the inspection_rules table when
  // available (g.timeMin), else the shared code matrix (position/profile → CMM
  // 8 min, height gauge 4 min, ...), else the flat 3 min/feature estimate.
  // Cap at 5 features either way.
  const gdtAdder = gdtFeatures && gdtFeatures.length > 0
    ? gdtFeatures
        .slice(0, 5)
        .reduce((s, g) => s + (g.timeMin ?? deriveGdtSeverity(g.symbol, g.tolerance).inspectionTimeMin), 0)
    : Math.min(gdtFeatureCount, 5) * 3;
  return base + holeSample + threadCheck + tolAdder + gdtAdder;
}

// ── Inspection line (three-stage sampling, CMM-amortized) ────────────────────
// Cost per part = (setup + FAI + in-process samples + final checks) / batchSize.
//   FAI:        first article, full per-piece measurement, once per batch
//   in-process: 1 of every N parts (samplingPerN override), full measurement
//   final:      1 of every finalPerN parts, short visual/gauge check
// The rate carries CMM equipment amortization when an MHR record exists — the
// MHR engine already prices depreciation/interest/maintenance per effective hour.
function computeInspectionLine(
  perPieceMin: number,
  inspectionRate: MHRRateInput,
  batchSize: number,
  samplingPerN: number | undefined,
  samplingPolicy: InspectionStagePolicy | undefined,
): ProcessLineCost {
  const policy = samplingPolicy ?? INSPECTION_SAMPLING_DEFAULT;
  const batch = Math.max(batchSize, 1);
  const inProcessPerN = Math.max(samplingPerN ?? policy.inProcessPerN, 1);

  const faiQty = policy.fai ? 1 : 0;
  // In-process samples come from the parts after the first article
  const inProcessQty = Math.floor(Math.max(batch - faiQty, 0) / inProcessPerN);
  const finalQty = Math.ceil(batch / Math.max(policy.finalPerN, 1));

  const measuredMin = perPieceMin * (faiQty + inProcessQty) + policy.finalCheckMin * finalQty;
  const setupCost = r2((CMM_SETUP_MIN / 60) * inspectionRate.rate / batch);
  const runCost = r2((measuredMin / 60) * inspectionRate.rate / batch);
  // Amortized per-part time keeps totalMin per-part-honest
  const cycleMin = r2(measuredMin / batch);
  return makeLine('Inspection', setupCost, runCost, cycleMin, inspectionRate);
}

// ── Surface treatment line (anodize / plating / coating) ─────────────────────
// perPart = max(area × rate/m², min-lot charge / batch). Localized via the
// deburring-rate ratio (same reasoning as localizeFixtureCost: treatment is
// local labour + chemistry, not a spot-FX conversion).
export function computeSurfaceTreatmentLine(
  surfaceTreatment: string | null,
  surfaceAreaMm2: number,
  batchSize: number,
  location: string,
  warnings: string[],
): ProcessLineCost | null {
  const trimmed = surfaceTreatment?.trim() ?? '';
  const key = classifySurfaceTreatment(surfaceTreatment);
  if (!key) {
    if (trimmed && !/^(none|n\/a|na|nil|no|-|as.?required)$/i.test(trimmed)) {
      warnings.push(
        `Surface treatment callout "${trimmed}" not recognized — treatment cost NOT included; verify before quoting.`,
      );
    }
    return null;
  }
  if (surfaceAreaMm2 <= 0) {
    warnings.push(
      `Drawing calls out surface treatment "${trimmed}" but part surface area is unknown — treatment cost NOT included; re-run CAD analysis.`,
    );
    return null;
  }
  const rates = SURFACE_TREATMENT_RATES[key];
  const defaults = LOCATION_MHR_DEFAULTS as Record<string, Partial<Record<MachineClass, number>>>;
  const indiaDeburr = defaults[DEFAULT_COSTING_LOCATION]?.deburring;
  const localDeburr = defaults[location]?.deburring;
  const localRatio = indiaDeburr && localDeburr ? localDeburr / indiaDeburr : 1;

  const areaCost = (surfaceAreaMm2 / 1e6) * rates.ratePerM2Inr * localRatio;
  const minLotPerPart = (rates.minLotChargeInr * localRatio) / Math.max(batchSize, 1);
  const perPart = r2(Math.max(areaCost, minLotPerPart));
  return {
    process: `Surface Treatment (${rates.label})`,
    setupCost: 0,
    runCost: perPart,
    totalCost: perPart,
    cycleTimeMin: 0, // outside-process lead time, not machine cycle
    hourlyRate: 0,
    rateSource: 'default_rate',
    machineClass: 'surface_treatment',
    machineName: null,
    commodityCode: null,
  };
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
    inspectionRate, surfaceTreatment,
  } = input;

  const warnings: string[] = [];
  const processLines: ProcessLineCost[] = [];
  const matClass = detectMaterialClass(materialGrade);
  const location = input.location ?? DEFAULT_COSTING_LOCATION;

  // ── Billet ────────────────────────────────────────────────────────────────
  // Bounding box + saw/skim stock allowance per side. A billet exactly the size
  // of the finished part cannot be machined — the old bbox-only billet both
  // understated material and let inconsistent CAD data (weight > bbox volume)
  // produce silent >100% utilization.
  const allow = 2 * CNC_STOCK_ALLOWANCE_PER_SIDE_MM;
  const billetVolMm3 =
    maxLength > 0 && maxWidth > 0 && maxHeight > 0
      ? (maxLength + allow) * (maxWidth + allow) * (maxHeight + allow)
      : 0;
  const billetWeightKg = r3((billetVolMm3 / 1e9) * materialDensityKgM3);
  const materialCost = r2(billetWeightKg * materialCostPerKg * 1.05);

  if (!materialGrade) warnings.push('Material grade not set — default mild steel rates applied');
  if (billetVolMm3 === 0) warnings.push('Bounding box is zero — billet cost may be inaccurate');
  if (volume > 0 && billetVolMm3 > 0 && volume > billetVolMm3) {
    warnings.push(
      'CAD part volume exceeds the bounding-box billet — geometry or unit data is inconsistent; material cost and chip loss are unreliable until the model is re-analysed.',
    );
  }

  // ── Setup (amortised over batchSize) ─────────────────────────────────────
  const setupCount = SETUP_COUNT[machineClass];
  const setupMin = (setupCount * BASE_SETUP_MIN[machineClass]) / Math.max(batchSize, 1);
  const setupCostVal = r2((setupMin / 60) * mhrRate.rate);
  processLines.push(makeLine('Setup', setupCostVal, 0, setupMin, mhrRate));

  // ── Fixture (amortised, localized) ───────────────────────────────────────
  const fixtureCost = r2(localizeFixtureCost(machineClass, location) / Math.max(batchSize, 1));
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

  // ── CNC Milling (roughing + all hole operations on the same machine) ─────
  // Roughing: material removal × 1.3 (30% finish-pass buffer already included)
  // Drilling: holes drilled on the same VMC — no separate machine or setup
  const materialRemovalMm3 = Math.max(0, billetVolMm3 - volume);
  const mrr = MILLING_MRR[matClass];
  const roughingMin = materialRemovalMm3 > 0 ? (materialRemovalMm3 / mrr) * 1.3 : 0;

  let drillingMin = 0;
  if (holeGroups.length > 0) {
    drillingMin = holeGroups.reduce(
      (sum, g) => sum + g.count * DRILL_CYCLE_SEC[drillDiamClass(g.diameter_mm)] / 60, 0,
    );
  } else if (holeCount > 0) {
    drillingMin = (holeCount * DRILL_CYCLE_SEC.medium) / 60;
  }

  const cncMillingMin = roughingMin + drillingMin;
  if (cncMillingMin > 0) {
    processLines.push(makeLine('CNC Milling', 0, r2((cncMillingMin / 60) * mhrRate.rate), cncMillingMin, mhrRate));
  } else {
    warnings.push('Volume data unavailable — CNC milling time estimated at 0');
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

  // ── Surface Treatment (anodize / plating — drawing callout) ──────────────
  const surfaceLine = computeSurfaceTreatmentLine(surfaceTreatment, surfaceArea, batchSize, location, warnings);
  if (surfaceLine) processLines.push(surfaceLine);

  // ── Inspection (batch-sampled; CMM amortization rides on the MHR rate) ───
  const inspectionMin = computeInspectionMin(
    holeCount, threadCount, tightestToleranceMm, gdtFeatureCount, input.gdtFeatures,
  );
  processLines.push(
    computeInspectionLine(inspectionMin, inspectionRate, batchSize, input.samplingPerN, input.samplingPolicy),
  );

  const totalProcessCost = r2(processLines.reduce((s, l) => s + l.totalCost, 0));
  const totalCost = r2(materialCost + totalProcessCost);
  const totalMin = r2(processLines.reduce((s, l) => s + l.cycleTimeMin, 0));

  // Clamp to [0, 100]: >100% is physically impossible (billet smaller than part —
  // bad CAD data, warned above); a wrong 108% silently understates material.
  const utilizationPct = r2(
    billetWeightKg > 0 ? Math.min(100, Math.max(0, (finishedWeightKg / billetWeightKg) * 100)) : 0,
  );
  const chipScrapPct = r2(100 - utilizationPct);
  if (chipScrapPct > 65) {
    warnings.push(
      `Chip loss ${chipScrapPct.toFixed(0)}% — over 65% of the billet is machined away. ` +
      'Verify bounding box orientation and part weight; a near-net blank (extrusion/casting) may fit better.',
    );
  }

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
      laserMin:      r2(cncMillingMin),
      pressBrakeMin: r2(setupMin),
      tappingMin:    r2(tappingMin),
      deburrMin:     r2(deburrMin),
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
      chipScrapPct,
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
    inspectionRate, surfaceTreatment,
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

  const location = input.location ?? DEFAULT_COSTING_LOCATION;

  // ── Bar stock ────────────────────────────────────────────────────────────
  const barDiamMm = Math.max(maxWidth, maxHeight) * 1.1;
  const barLengthMm = maxLength * 1.1;
  const barVolMm3 = Math.PI * (barDiamMm / 2) ** 2 * barLengthMm;
  const barWeightKg = r3((barVolMm3 / 1e9) * materialDensityKgM3);
  const materialCost = r2(barWeightKg * materialCostPerKg * 1.05);

  if (!materialGrade) warnings.push('Material grade not set — default mild steel rates applied');
  if (volume > 0 && barVolMm3 > 0 && volume > barVolMm3) {
    warnings.push(
      'CAD part volume exceeds the bar-stock volume — geometry or unit data is inconsistent; material cost and chip loss are unreliable until the model is re-analysed.',
    );
  }

  // ── Setup (amortised) ────────────────────────────────────────────────────
  const setupCount = SETUP_COUNT[machineClass];
  const setupMin = (setupCount * BASE_SETUP_MIN[machineClass]) / Math.max(batchSize, 1);
  const setupCostVal = r2((setupMin / 60) * mhrRate.rate);
  processLines.push(makeLine('Setup', setupCostVal, 0, setupMin, mhrRate));

  // ── Fixture (amortised, localized) ───────────────────────────────────────
  const fixtureCost = r2(localizeFixtureCost(machineClass, location) / Math.max(batchSize, 1));
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

  // ── Surface Treatment (anodize / plating — drawing callout) ──────────────
  const surfaceLine = computeSurfaceTreatmentLine(
    surfaceTreatment, input.surfaceArea, batchSize, location, warnings,
  );
  if (surfaceLine) processLines.push(surfaceLine);

  // ── Inspection (batch-sampled; CMM amortization rides on the MHR rate) ───
  // drilledHoleCount, not raw holeCount — the raw count includes OD steps/grooves
  // and would inflate the hole-sampling time for turned parts.
  const inspectionMin = computeInspectionMin(
    drilledHoleCount, threadCount, tightestToleranceMm, gdtFeatureCount, input.gdtFeatures,
  );
  processLines.push(
    computeInspectionLine(inspectionMin, inspectionRate, batchSize, input.samplingPerN, input.samplingPolicy),
  );

  const totalProcessCost = r2(processLines.reduce((s, l) => s + l.totalCost, 0));
  const totalCost = r2(materialCost + totalProcessCost);
  const totalMin = r2(processLines.reduce((s, l) => s + l.cycleTimeMin, 0));

  // Clamped for the same reason as the milled engine: >100% = impossible data
  const utilizationPct = r2(
    barWeightKg > 0 ? Math.min(100, Math.max(0, (finishedWeightKg / barWeightKg) * 100)) : 0,
  );

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
      deburrMin:     r2(boringMin),
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

// ── Route recommendation (single source of truth) ─────────────────────────────
// Cost Summary and Route Comparison MUST agree on which machine class a part is
// quoted on. Both call these two functions; neither carries its own heuristic.
// Divergence here is a P0 — it reads as two different prices for the same part.

// Minimum milled machine class the part's features demand. Same thresholds the
// legacy cost-summary heuristic used, now shared with route comparison so a
// route below this class is marked not-capable rather than winning on price.
export function requiredMilledMachineClass(
  difficultyLevel: string | null | undefined,
  pocketCount: number,
): CNCMachineClass {
  if (difficultyLevel === 'very_hard' || pocketCount > 25) return 'cnc_5ax_mc';
  if (difficultyLevel === 'hard' || pocketCount > 12) return 'cnc_4ax_vmc';
  return 'cnc_3ax_vmc';
}

const MILLED_CLASS_RANK: Record<string, number> = {
  cnc_3ax_vmc: 0, cnc_4ax_vmc: 1, cnc_5ax_mc: 2,
};

export function meetsRequiredMilledClass(
  machineClass: CNCMachineClass,
  required: CNCMachineClass,
): boolean {
  const rank = MILLED_CLASS_RANK[machineClass];
  const requiredRank = MILLED_CLASS_RANK[required];
  if (rank == null || requiredRank == null) return true; // lathe classes — not gated here
  return rank >= requiredRank;
}

// Recommended route = lowest total cost among capable candidates; ties break to
// fewer setups (less repositioning error), then to the earlier (simpler) class.
// Falls back to the first candidate when nothing is capable — the caller is
// expected to surface capability warnings alongside.
export function pickRecommendedRoute<T extends { totalCost: number; capable: boolean; setupCount: number }>(
  candidates: T[],
): T {
  const pool = candidates.filter((c) => c.capable);
  const ranked = (pool.length > 0 ? pool : candidates).slice().sort(
    (a, b) => a.totalCost - b.totalCost || a.setupCount - b.setupCount,
  );
  return ranked[0];
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
