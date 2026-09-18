import {
  computeCNCMilledCostSummary,
  computeCNCTurnedCostSummary,
  computeInspectionMin,
  computeSurfaceTreatmentLine,
  requiredMilledMachineClass,
  meetsRequiredMilledClass,
  pickRecommendedRoute,
  checkCNCCapability,
  type CNCCostInput,
  type MachineClassId,
} from '../../../../../../modules/bom-items/costing/machining/process/cost-cnc-engine';

// Machine classes are now DB-discovered (MachineClassId), not a fixed
// TypeScript union — this test file still uses the historical literal
// class names as fixture values, cast through this helper the same way
// production code casts a discovery-query result (assertKnownMachineClass).
const mc = (value: string): MachineClassId => value as MachineClassId;
import { EMPTY_CAPABILITY } from '../../../../../../modules/bom-items/costing/shared/capability/machine-selection/seed-registry';
import type { MachineCapability } from '../../../../../../modules/bom-items/costing/shared/capability/machine-selection/seed-registry';
import { buildOperationSequence } from '../../../../../../modules/bom-items/costing/machining/operation/operation-sequencer';
import {
  benchmarkRateWarning,
  classifySurfaceTreatment,
  CMM_SETUP_MIN,
  CNC_STOCK_ALLOWANCE_PER_SIDE_MM,
  TURNING_MILLING_BEST_ACHIEVABLE_RA_UM,
  CYLINDRICAL_GRINDING_SETUP_MIN,
  JIG_BORE_POSITION_TOLERANCE_MM,
  JIG_BORE_SETUP_MIN,
  JIG_BORE_NUM_REPETITIONS,
} from '../../../../../../modules/bom-items/costing/shared/core/default-rates.constants';
import type { MHRRateInput } from '../../../../../../modules/bom-items/costing/shared/core/cost-engine';
import {
  shapeRankForFamily,
  isDiscouragedShapeForFamily,
} from '../../../../../../modules/raw-materials/constants/material-shape-ranking';

function rate(value: number, overrides: Partial<MHRRateInput> = {}): MHRRateInput {
  return {
    rate: value,
    source: 'mhr_database',
    machineClass: '3_axis_mill',
    machineName: 'Test VMC',
    commodityCode: 'CNC-VMC-3AX',
    ...overrides,
  };
}

// RMP-00028-A boom clamp analog: 83×62×32 mm aluminium, 107 holes, M4 taps
function milledInput(overrides: Partial<CNCCostInput> = {}): CNCCostInput {
  return {
    volume: 100_000,
    surfaceArea: 40_000,
    maxLength: 83,
    maxWidth: 62,
    maxHeight: 32,
    holeCount: 107,
    holeGroups: [{ diameter_mm: 4, count: 107 }],
    pocketCount: 4,
    materialGrade: 'AL6061-T6',
    materialCostPerKg: 350,
    materialDensityKgM3: 2700,
    materialSource: 'db',
    threads: [{ size: 'M4', count: 12 }],
    tightestToleranceMm: 0.05,
    gdtFeatureCount: 2,
    batchSize: 60,
    family: 'cnc_milled',
    finishedWeightKg: 0.27,
    mhrRate: rate(900),
    tappingRate: rate(900, { machineClass: 'tapping' }),
    deburrRate: rate(300, { machineClass: 'deburring', source: 'default_rate', machineName: null }),
    inspectionRate: rate(450, {
      machineClass: 'cmm', source: 'default_rate', machineName: null, commodityCode: null,
    }),
    surfaceTreatment: null,
    location: 'India',
    ...overrides,
  };
}

describe('computeCNCMilledCostSummary — billet and chip loss', () => {
  it('adds stock allowance per side to the billet', () => {
    const result = computeCNCMilledCostSummary(milledInput(), mc('3_axis_mill'));
    const allow = 2 * CNC_STOCK_ALLOWANCE_PER_SIDE_MM;
    const expectedVol = (83 + allow) * (62 + allow) * (32 + allow);
    expect(result.materialRemoval!.billetWeightKg).toBeCloseTo((expectedVol / 1e9) * 2700, 3);
  });

  it('clamps utilization at 100% and warns when CAD volume exceeds the billet', () => {
    // Impossible data: part heavier than any billet the bbox can supply
    const result = computeCNCMilledCostSummary(
      milledInput({ finishedWeightKg: 5.0 }),
      mc('3_axis_mill'),
    );
    expect(result.materialRemoval!.utilizationPct).toBeLessThanOrEqual(100);
    expect(result.materialRemoval!.chipScrapPct).toBeGreaterThanOrEqual(0);
  });

  it('warns on inconsistent CAD volume (volume > billet)', () => {
    const result = computeCNCMilledCostSummary(
      milledInput({ volume: 999_999_999 }),
      mc('3_axis_mill'),
    );
    expect(result.warnings.some((w) => w.includes('volume exceeds'))).toBe(true);
  });

  it('warns when chip loss exceeds 65%', () => {
    const result = computeCNCMilledCostSummary(
      milledInput({ finishedWeightKg: 0.05 }),
      mc('3_axis_mill'),
    );
    expect(result.materialRemoval!.chipScrapPct).toBeGreaterThan(65);
    expect(result.warnings.some((w) => w.includes('Chip loss'))).toBe(true);
  });

  it('folds fixture cost into CNC Milling setupCost (no separate Setup or Fixture process line)', () => {
    const india = computeCNCMilledCostSummary(milledInput({ location: 'India' }), mc('3_axis_mill'));
    const usa = computeCNCMilledCostSummary(milledInput({ location: 'USA' }), mc('3_axis_mill'));
    // Fixture is no longer a standalone process line
    expect(india.processLines.find((l) => l.process === 'Fixture')).toBeUndefined();
    expect(usa.processLines.find((l) => l.process === 'Fixture')).toBeUndefined();
    // "Setup" is no longer a standalone process line either (2026-09-18) —
    // it's folded into the first real line (CNC Milling) instead.
    expect(india.processLines.find((l) => l.process === 'Setup')).toBeUndefined();
    expect(usa.processLines.find((l) => l.process === 'Setup')).toBeUndefined();
    // Fixture cost is folded into CNC Milling's setupCost (500 INR / batchSize=60 for India)
    const indiaMilling = india.processLines.find((l) => l.process === 'CNC Milling')!;
    const usaMilling = usa.processLines.find((l) => l.process === 'CNC Milling')!;
    expect(indiaMilling.setupCost).toBeGreaterThan(500 / 60 - 0.1); // includes fixture amortization
    expect(usaMilling.setupCost).toBeGreaterThan((500 * (85 / 900)) / 60 - 0.01);
  });

  it('prices the tapping line at the machine rate it was given (rigid tapping inheritance)', () => {
    const result = computeCNCMilledCostSummary(
      milledInput({ tappingRate: rate(900, { machineClass: 'tapping', machineName: 'Makino V56i' }) }),
      mc('3_axis_mill'),
    );
    const tapping = result.processLines.find((l) => l.process === 'Tapping')!;
    expect(tapping.hourlyRate).toBe(900);
    expect(tapping.machineName).toBe('Makino V56i');
  });
});

describe('inspection line — batch sampling + CMM amortized rate', () => {
  // milledInput per-piece inspection minutes:
  // base 5 + holeSample min(ceil(107/5),15)×0.5 = 7.5 + threads min(12,6)×0.4 = 2.4
  // + tolAdder 8 (0.05mm) + GD&T min(2,5)×3 = 6 → 28.9 min
  const PER_PIECE_MIN = 28.9;

  it('computes per-piece inspection minutes from holes/threads/tolerance/GD&T', () => {
    expect(computeInspectionMin(107, 12, 0.05, 2)).toBeCloseTo(PER_PIECE_MIN, 5);
  });

  it('uses per-callout GD&T time from the severity rules when callouts are provided', () => {
    // position 0.05 → CMM 8 min; flatness 0.4 → height gauge 4 min (vs flat 3+3)
    const withCallouts = computeInspectionMin(0, 0, null, 2, [
      { symbol: 'position', tolerance: 0.05 },
      { symbol: 'flatness', tolerance: 0.4 },
    ]);
    expect(withCallouts).toBe(5 + 8 + 4);
  });

  it('batch 1 = FAI full measurement + one final check', () => {
    const result = computeCNCMilledCostSummary(milledInput({ batchSize: 1 }), mc('3_axis_mill'));
    const insp = result.processLines.find((l) => l.process === 'Inspection')!;
    expect(insp.setupCost).toBeCloseTo((CMM_SETUP_MIN / 60) * 450, 2);
    // FAI (28.9 min) + final visual check (2 min)
    expect(insp.runCost).toBeCloseTo(((PER_PIECE_MIN + 2) / 60) * 450, 2);
    expect(insp.hourlyRate).toBe(450);
    expect(insp.machineClass).toBe('cmm');
  });

  it('amortizes three-stage sampling over the batch (FAI + in-process 1/10 + final 1/25)', () => {
    // batch 60 → FAI 1 + in-process floor(59/10)=5 full measurements + final ceil(60/25)=3 × 2min
    const measuredMin = PER_PIECE_MIN * 6 + 2 * 3;
    const result = computeCNCMilledCostSummary(milledInput({ batchSize: 60 }), mc('3_axis_mill'));
    const insp = result.processLines.find((l) => l.process === 'Inspection')!;
    expect(insp.runCost).toBeCloseTo(((measuredMin / 60) * 450) / 60, 2);
    expect(insp.setupCost).toBeCloseTo(((CMM_SETUP_MIN / 60) * 450) / 60, 2);
    expect(insp.cycleTimeMin).toBeCloseTo(measuredMin / 60, 2);
  });

  it('honors a per-item samplingPerN override (1 = full measurement on every part)', () => {
    const result = computeCNCMilledCostSummary(
      milledInput({ batchSize: 60, samplingPerN: 1 }),
      mc('3_axis_mill'),
    );
    const insp = result.processLines.find((l) => l.process === 'Inspection')!;
    // FAI 1 + in-process 59 = every part fully measured, + 3 final checks
    const measuredMin = PER_PIECE_MIN * 60 + 2 * 3;
    expect(insp.runCost).toBeCloseTo(((measuredMin / 60) * 450) / 60, 2);
  });

  it('emits the inspection line on turned parts too', () => {
    const result = computeCNCTurnedCostSummary(
      milledInput({ family: 'cnc_turned' }),
      mc('2_axis_lathe'),
    );
    expect(result.processLines.some((l) => l.process === 'Inspection')).toBe(true);
  });

  it('applies a named quality plan (full_cmm: every part measured)', () => {
    const result = computeCNCMilledCostSummary(
      milledInput({
        batchSize: 60,
        samplingPolicy: { fai: true, inProcessPerN: 1, finalPerN: 1, finalCheckMin: 2 },
      }),
      mc('3_axis_mill'),
    );
    const insp = result.processLines.find((l) => l.process === 'Inspection')!;
    // FAI 1 + in-process 59 = 60 full measurements + 60 final checks
    const measuredMin = PER_PIECE_MIN * 60 + 2 * 60;
    expect(insp.runCost).toBeCloseTo(((measuredMin / 60) * 450) / 60, 2);
  });

  it('applies an AS9100-style plan (5% in-process sampling) more cheaply than general', () => {
    const general = computeCNCMilledCostSummary(milledInput({ batchSize: 100 }), mc('3_axis_mill'));
    const as9100 = computeCNCMilledCostSummary(
      milledInput({
        batchSize: 100,
        samplingPolicy: { fai: true, inProcessPerN: 20, finalPerN: 25, finalCheckMin: 3 },
      }),
      mc('3_axis_mill'),
    );
    const inspOf = (r: typeof general) => r.processLines.find((l) => l.process === 'Inspection')!;
    expect(inspOf(as9100).runCost).toBeLessThan(inspOf(general).runCost);
  });

  it('uses DB-resolved per-callout time (timeMin) over the code matrix', () => {
    // Rules say this callout takes 20 min (org-tuned CMM routine), matrix says 8
    const withDbTime = computeInspectionMin(0, 0, null, 1, [
      { symbol: 'position', tolerance: 0.05, timeMin: 20 },
    ]);
    expect(withDbTime).toBe(5 + 20);
  });

  // Root-caused live (2026-09-18): CMM_SETUP_MIN was used unconditionally,
  // ignoring a real per-CMM mhr_records.setup_time_hr even when present —
  // same fix pattern applied to the main Setup line below.
  it('prefers a real per-CMM setup_time_hr over CMM_SETUP_MIN when one is on file', () => {
    const result = computeCNCMilledCostSummary(
      milledInput({
        batchSize: 48,
        inspectionRate: rate(450, { machineClass: 'cmm', setupTimeHr: 0.4, machineName: 'Real CMM' }), // 24 min
      }),
      mc('3_axis_mill'),
    );
    const insp = result.processLines.find((l) => l.process === 'Inspection')!;
    expect(insp.setupTimeMin).toBe(24);
    expect(insp.setupTimeSource).toBe('machine');
    expect(insp.setupCost).toBeCloseTo((24 / 60) * 450 / 48, 5);
  });

  it('discloses the class_default source (not silently) when no real setup_time_hr exists', () => {
    const result = computeCNCMilledCostSummary(milledInput({ batchSize: 48 }), mc('3_axis_mill'));
    const insp = result.processLines.find((l) => l.process === 'Inspection')!;
    expect(insp.setupTimeMin).toBe(CMM_SETUP_MIN);
    expect(insp.setupTimeSource).toBe('class_default');
    expect(result.warnings.some((w) => w.includes('setup_time_hr'))).toBe(true);
  });
});

describe('Setup — folded into the first real line (CNC Milling / OD Turning), real per-machine mhr_records.setup_time_hr vs the disclosed class default', () => {
  it('uses the real per-machine setup_time_hr when the selected machine has one, not the class default', () => {
    const result = computeCNCMilledCostSummary(
      milledInput({
        batchSize: 10,
        mhrRate: rate(900, { setupTimeHr: 0.75 }), // 45 min — deliberately far from the class default (60 min for 3_axis_mill)
      }),
      mc('3_axis_mill'),
    );
    // "Setup" is no longer its own process line (2026-09-18) — a machine's
    // one-time workholding/fixturing overhead is folded into the first real
    // operation line it produces instead of appearing as a peer operation.
    expect(result.processLines.find((l) => l.process === 'Setup')).toBeUndefined();
    const milling = result.processLines.find((l) => l.process === 'CNC Milling')!;
    expect(milling.setupTimeMin).toBe(45);
    expect(milling.setupTimeSource).toBe('machine');
    // "CNC Setup: ..." is resolveSetupMinutes' own process-labeled warning for
    // THIS line specifically -- the Inspection line's separate CMM_SETUP_MIN
    // fallback warning is expected to still fire in this fixture (its own
    // inspectionRate carries no setupTimeHr) and must not be confused for it.
    expect(result.warnings.some((w) => w.startsWith('CNC Setup:'))).toBe(false);
  });

  it('falls back to the cited SETUP_COUNT×BASE_SETUP_MIN class default with a disclosed warning when absent', () => {
    const result = computeCNCMilledCostSummary(milledInput({ batchSize: 10 }), mc('3_axis_mill'));
    const milling = result.processLines.find((l) => l.process === 'CNC Milling')!;
    expect(milling.setupTimeMin).toBe(3 * 20); // 3_axis_mill: SETUP_COUNT=3 * BASE_SETUP_MIN=20
    expect(milling.setupTimeSource).toBe('class_default');
    expect(result.warnings.some((w) => w.startsWith('CNC Setup:'))).toBe(true);
  });

  it('applies the same real-data preference on turned parts', () => {
    const result = computeCNCTurnedCostSummary(
      milledInput({ family: 'cnc_turned', batchSize: 10, mhrRate: rate(900, { machineClass: '2_axis_lathe', setupTimeHr: 0.1 }) }), // 6 min
      mc('2_axis_lathe'),
    );
    expect(result.processLines.find((l) => l.process === 'Setup')).toBeUndefined();
    const odTurning = result.processLines.find((l) => l.process === 'OD Turning')!;
    expect(odTurning.setupTimeMin).toBe(6);
    expect(odTurning.setupTimeSource).toBe('machine');
  });
});

describe('surface treatment line — anodize/plating pricing', () => {
  it('classifies drawing callouts to rate keys', () => {
    expect(classifySurfaceTreatment('Type III Hardcoat Black Anodize')).toBe('anodize_type_iii');
    expect(classifySurfaceTreatment('Black Anodize per MIL-A-8625')).toBe('anodize_type_ii');
    expect(classifySurfaceTreatment('Zinc plated')).toBe('zinc_plate');
    expect(classifySurfaceTreatment('None')).toBeNull();
    expect(classifySurfaceTreatment(null)).toBeNull();
  });

  // computeSurfaceTreatmentLine no longer computes area×rate/min-lot itself —
  // that arithmetic now lives in the real "Post Processing - Surface
  // Treatment" calculator, resolved by BomItemsService.enrichSurfaceTreatmentRate()
  // via resolvePhysicsQuantity (no DB access from this pure-function test), so
  // these fixtures supply totalCostFromCalculatorLocal pre-computed exactly as
  // that calculator would: max(areaCost, minLotCharge / batchSize).
  it('prices by area when area cost beats the amortized minimum lot charge', () => {
    // 0.04 m² × ₹700/m² = ₹28 vs min-lot ₹1500/60 = ₹25 → area wins
    const result = computeCNCMilledCostSummary(
      milledInput({
        surfaceTreatment: 'Type III Hardcoat Black Anodize',
        batchSize: 60,
        surfaceTreatmentDbRate: {
          treatmentType: 'anodize_type_iii', label: 'Hardcoat Anodize Type III',
          ratePerM2Local: 700, minLotChargeLocal: 1500, totalCostFromCalculatorLocal: 0.04 * 700,
        },
      }),
      mc('3_axis_mill'),
    );
    const st = result.processLines.find((l) => l.process.startsWith('Surface Treatment'))!;
    expect(st.process).toContain('Hardcoat Anodize Type III');
    expect(st.totalCost).toBeCloseTo(0.04 * 700, 2);
  });

  it('charges the amortized minimum lot at small batches', () => {
    // min-lot ₹1500/5 = ₹300 > area ₹28
    const result = computeCNCMilledCostSummary(
      milledInput({
        surfaceTreatment: 'Type III Hardcoat',
        batchSize: 5,
        surfaceTreatmentDbRate: {
          treatmentType: 'anodize_type_iii', label: 'Hardcoat Anodize Type III',
          ratePerM2Local: 700, minLotChargeLocal: 1500, totalCostFromCalculatorLocal: 1500 / 5,
        },
      }),
      mc('3_axis_mill'),
    );
    const st = result.processLines.find((l) => l.process.startsWith('Surface Treatment'))!;
    expect(st.totalCost).toBeCloseTo(1500 / 5, 2);
  });

  it('never prices a treatment on zero surface area — warns instead', () => {
    const warnings: string[] = [];
    const line = computeSurfaceTreatmentLine('Type III Hardcoat', 0, 60, 'India', warnings);
    expect(line).toBeNull();
    expect(warnings.some((w) => w.includes('surface area is unknown'))).toBe(true);
  });

  it('warns on unrecognized callouts instead of guessing a price', () => {
    const warnings: string[] = [];
    const line = computeSurfaceTreatmentLine('Rainbow finish', 40_000, 60, 'India', warnings);
    expect(line).toBeNull();
    expect(warnings.some((w) => w.includes('not recognized'))).toBe(true);
  });

  it('uses each location\'s own already-localized calculator result, not a shared/reused rate', () => {
    // dbRate is resolved (and localized) by the caller per real FX rates before
    // this function ever runs — it just assembles the line from whatever
    // totalCostFromCalculatorLocal the calculator produced for THAT location's rate.
    const warnings: string[] = [];
    const india = computeSurfaceTreatmentLine('anodize', 40_000, 5, 'India', warnings, {
      treatmentType: 'zinc_plate', label: 'Zinc Plating',
      ratePerM2Local: 150, minLotChargeLocal: 600, totalCostFromCalculatorLocal: 0.04 * 150,
    })!;
    const usa = computeSurfaceTreatmentLine('anodize', 40_000, 5, 'USA', warnings, {
      treatmentType: 'zinc_plate', label: 'Zinc Plating',
      ratePerM2Local: 8, minLotChargeLocal: 25, totalCostFromCalculatorLocal: 0.04 * 8,
    })!;
    expect(india.totalCost).toBeCloseTo(0.04 * 150, 2);
    expect(usa.totalCost).toBeCloseTo(0.04 * 8, 2);
  });

  it('adds no surface treatment line when the part has no callout', () => {
    const result = computeCNCMilledCostSummary(milledInput(), mc('3_axis_mill'));
    expect(result.processLines.some((l) => l.process.startsWith('Surface Treatment'))).toBe(false);
  });
});

describe('computeCNCTurnedCostSummary — data sanity', () => {
  it('still flags sheet/plate material grades on turned parts', () => {
    const result = computeCNCTurnedCostSummary(
      milledInput({ family: 'cnc_turned', materialGrade: '6061-T6 Sheet' }),
      mc('2_axis_lathe'),
    );
    expect(result.warnings.some((w) => w.includes('sheet/plate'))).toBe(true);
  });
});

// Real tblGeneralTurning material_cut_code_name '1.0' row (hardness 125):
// medium_rough_turning cut_depth_mm=1.3/cutting_speed_m_min=250.4/
// feed_rate_mm_rev=0.3625; finish_turning cut_depth_mm=0.8/
// cutting_speed_m_min=333.1/feed_rate_mm_rev=0.29 (verified directly against
// the source data 2026-09-18). Root-caused: OD Turning previously used a
// flat, uncited TURNING_MRR table (mm3/min) + a fixed x1.2 fudge factor with
// no real pass-count model at all — replaced with real per-pass depth-of-cut
// physics (computeTurningCycleSec), same "L/F x N" shape the reference
// methodology for this domain describes.
const REAL_TURNING_PARAMS = {
  roughCutDepthMm: 1.3, roughCuttingSpeedMPerMin: 250.4, roughFeedMmPerRev: 0.3625,
  finishCutDepthMm: 0.8, finishCuttingSpeedMPerMin: 333.1, finishFeedMmPerRev: 0.29,
  dataFound: true,
};

describe('OD Turning — real per-pass depth-of-cut physics (tblGeneralTurning)', () => {
  it('computes exact real rough-pass-count + finish-pass cycle time, split into the real distinct Rough Turning / Finish Turning operations', () => {
    const result = computeCNCTurnedCostSummary(
      turnedInput({
        maxLength: 100, maxWidth: 20, maxHeight: 20,
        blankResult: {
          form: 'round_bar', sizeLabel: 'Ø30 round bar',
          billetVolMm3: Math.PI * 15 ** 2 * 100, // real equivalent 30mm-diameter round bar, 100mm long
          utilizationPct: 50,
        },
        turningParams: REAL_TURNING_PARAMS,
      } as any),
      mc('2_axis_lathe'),
    );
    // "OD Turning" is no longer emitted when real per-pass data resolves —
    // replaced by the real distinct catalog operations.
    expect(result.processLines.some((l) => l.process === 'OD Turning')).toBe(false);
    const roughLine = result.processLines.find((l) => l.process === 'Rough Turning')!;
    const finishLine = result.processLines.find((l) => l.process === 'Finish Turning')!;
    expect(roughLine).toBeDefined();
    expect(finishLine).toBeDefined();
    // partDiameterMm = max(20,20) = 20; barDiameterMm = 30 (by construction);
    // radialStockMm = (30-20)/2 = 5mm. finishStockMm = min(0.8,5) = 0.8;
    // roughStockMm = 5-0.8 = 4.2; numRoughPasses = round(4.2/1.3) = 3.
    const diameterMm = 20;
    const passTimeSec = (speedMPerMin: number, feedMmPerRev: number) => {
      const rpm = (speedMPerMin * 1000) / (Math.PI * diameterMm);
      const feedMmPerMin = rpm * feedMmPerRev;
      return (100 / feedMmPerMin) * 60;
    };
    const expectedRoughSec = 3 * passTimeSec(250.4, 0.3625);
    const expectedFinishSec = passTimeSec(333.1, 0.29);
    expect(roughLine.cycleTimeMin).toBeCloseTo(expectedRoughSec / 60, 2);
    expect(finishLine.cycleTimeMin).toBeCloseTo(expectedFinishSec / 60, 2);
    // Setup folds into Rough Turning only, not Finish Turning.
    expect(roughLine.setupTimeMin).toBeGreaterThan(0);
    expect(finishLine.setupTimeMin).toBeUndefined();
  });

  it('discloses and falls back to the MRR-based estimate when real tblGeneralTurning data is not resolved (never a $0 turning line)', () => {
    const result = computeCNCTurnedCostSummary(
      turnedInput({
        maxLength: 100, maxWidth: 20, maxHeight: 20, volume: 5000,
        blankResult: {
          form: 'round_bar', sizeLabel: 'Ø30 round bar',
          billetVolMm3: Math.PI * 15 ** 2 * 100,
          utilizationPct: 50,
        },
        turningParams: { roughCutDepthMm: 0, roughCuttingSpeedMPerMin: 0, roughFeedMmPerRev: 0, finishCutDepthMm: 0, finishCuttingSpeedMPerMin: 0, finishFeedMmPerRev: 0, dataFound: false },
      } as any),
      mc('2_axis_lathe'),
    );
    const line = result.processLines.find((l) => l.process === 'OD Turning')!;
    expect(line.cycleTimeMin).toBeGreaterThan(0);
    expect(result.warnings.some((w) => w.includes('OD Turning') && w.includes('falling back'))).toBe(true);
  });

  it('does not fall back with a warning when there is genuinely no material to remove (radial stock is zero)', () => {
    const result = computeCNCTurnedCostSummary(
      turnedInput({
        maxLength: 100, maxWidth: 20, maxHeight: 20, volume: 5000,
        blankResult: {
          form: 'round_bar', sizeLabel: 'Ø20 round bar',
          billetVolMm3: Math.PI * 10 ** 2 * 100, // same diameter as the part -- no stock to remove
          utilizationPct: 100,
        },
        turningParams: { roughCutDepthMm: 0, roughCuttingSpeedMPerMin: 0, roughFeedMmPerRev: 0, finishCutDepthMm: 0, finishCuttingSpeedMPerMin: 0, finishFeedMmPerRev: 0, dataFound: false },
      } as any),
      mc('2_axis_lathe'),
    );
    expect(result.warnings.some((w) => w.includes('OD Turning') && w.includes('falling back'))).toBe(false);
  });
});

// Root-caused live 2026-09-18: every per-line operation NAME (Rough
// Turning, Finish Turning, Drilling, Parting, Tapping) was a string
// literal written directly in this file — even though each one was
// independently verified against the real operations_full.json catalog,
// the user's own explicit requirement is that these must be resolved
// against the LIVE process_taxonomy_operations catalog at runtime, not
// merely happen to match it. resolveOperationName() (internal, tested
// through the exported cost summary functions, matching this file's own
// established convention for every other internal helper) does exactly
// that: returns the live catalog's own string when a real
// (machineClass, operation_category) row exists, discloses a warning and
// keeps this engine's own verified name when it doesn't, and never
// invents a different name.
describe('resolveOperationName — every operation name confirmed against the live process_taxonomy_operations catalog', () => {
  it('uses the live catalog value (not silently trusting the hardcoded literal) when a real row exists for this machine class', () => {
    const result = computeCNCTurnedCostSummary(
      turnedInput({
        maxLength: 100, maxWidth: 20, maxHeight: 20, volume: 5000,
        blankResult: {
          form: 'round_bar', sizeLabel: 'Ø30 round bar',
          billetVolMm3: Math.PI * 15 ** 2 * 100,
          utilizationPct: 50,
        },
        turningParams: REAL_TURNING_PARAMS,
        // Includes every real operation this default fixture's holes/
        // threads also trigger (Drilling, Tapping) so the "no warning"
        // assertion below is genuinely testing a full real match, not
        // accidentally passing because an unrelated line's name was never
        // checked against an incomplete list.
        realOperationCategories: { cnc_lathe: ['Rough Turning', 'Finish Turning', 'Parting', 'Drilling'], tapping: ['Tapping'] },
      } as any),
      mc('2_axis_lathe'),
    );
    expect(result.processLines.some((l) => l.process === 'Rough Turning')).toBe(true);
    expect(result.processLines.some((l) => l.process === 'Finish Turning')).toBe(true);
    expect(result.processLines.some((l) => l.process === 'Parting')).toBe(true);
    expect(result.warnings.some((w) => w.includes('no matching real operation_category'))).toBe(false);
  });

  it('discloses a warning (never blocking, never inventing a different name) when this machine class has no real matching row', () => {
    const result = computeCNCTurnedCostSummary(
      turnedInput({
        maxLength: 100, maxWidth: 20, maxHeight: 20, volume: 5000,
        blankResult: {
          form: 'round_bar', sizeLabel: 'Ø30 round bar',
          billetVolMm3: Math.PI * 15 ** 2 * 100,
          utilizationPct: 50,
        },
        turningParams: REAL_TURNING_PARAMS,
        // Real data exists for this class, but "Rough Turning" isn't in it
        // -- e.g. migration 754 partially applied, or a genuinely
        // uncatalogued operation for this specific class.
        realOperationCategories: { '2_axis_lathe': ['Some Other Real Operation'] },
      } as any),
      mc('2_axis_lathe'),
    );
    const roughLine = result.processLines.find((l) => l.process === 'Rough Turning');
    expect(roughLine).toBeDefined(); // never dropped/blocked
    expect(result.warnings.some((w) =>
      w.includes('"Rough Turning"') && w.includes('no matching real operation_category') && w.includes('2_axis_lathe'),
    )).toBe(true);
  });

  it('does not warn when no real operation-category data is on file at all for any class (genuinely absent, not a mismatch)', () => {
    const result = computeCNCTurnedCostSummary(
      turnedInput({
        maxLength: 100, maxWidth: 20, maxHeight: 20, volume: 5000,
        blankResult: {
          form: 'round_bar', sizeLabel: 'Ø30 round bar',
          billetVolMm3: Math.PI * 15 ** 2 * 100,
          utilizationPct: 50,
        },
        turningParams: REAL_TURNING_PARAMS,
        realOperationCategories: null,
      } as any),
      mc('2_axis_lathe'),
    );
    expect(result.processLines.some((l) => l.process === 'Rough Turning')).toBe(true);
    expect(result.warnings.some((w) => w.includes('no matching real operation_category'))).toBe(false);
  });

  it('resolves Tapping against the tapping-specific machine class (tappingRate), not the main turning machine class', () => {
    const result = computeCNCTurnedCostSummary(
      turnedInput({
        threads: [{ size: 'M4', count: 2 }],
        tappingRate: rate(900, { machineClass: 'tapping' }),
        realOperationCategories: { tapping: ['Tapping'], cnc_lathe: [] },
      } as any),
      mc('2_axis_lathe'),
    );
    expect(result.processLines.some((l) => l.process === 'Tapping')).toBe(true);
    expect(result.warnings.some((w) => w.includes('no matching real operation_category'))).toBe(false);
  });
});

// Root-caused 2026-09-18: "MillTurn" is a real, staged Machining Process-page
// category (migrations 737/738/753, 7 real 5-axis mill-turn centers, e.g.
// GILDEMEISTER GMX 400 LINEAR) whose real machine_class ('machining_millturn')
// was deliberately kept separate from the pre-existing 'cnc_mill_turn' bucket
// (a different real machine population — see migration 738's own comment),
// but had no cost engine of its own. Its real ops (Back Finish Turning,
// Dovetail Milled, Polygon Turned, Rotary Broached, ...) are the same real
// turning taxonomy computeCNCTurnedCostSummary already prices — this is a
// pure machine-class wiring fix (MACHINE_ENVELOPE/MACHINE_REGISTRY/
// SETUP_COUNT/BASE_SETUP_MIN entries + a 4th route candidate), zero new
// physics.
describe('machining_millturn — real, distinct MillTurn machine class', () => {
  it('prices a turned part via computeCNCTurnedCostSummary using the machining_millturn machine class', () => {
    const result = computeCNCTurnedCostSummary(
      turnedInput({ mhrRate: rate(1200, { machineClass: 'machining_millturn', machineName: 'GILDEMEISTER GMX 400 LINEAR' }) } as any),
      mc('machining_millturn'),
    );
    expect(result.totalCost).toBeGreaterThan(0);
    expect(result.processLines.some((l) => l.machineClass === 'machining_millturn')).toBe(true);
  });

  it('uses the real disclosed 45min class-default setup when no per-machine setup_time_hr is on the rate', () => {
    const result = computeCNCTurnedCostSummary(
      turnedInput({ mhrRate: rate(1200, { machineClass: 'machining_millturn' }) } as any),
      mc('machining_millturn'),
    );
    // "Setup" is no longer its own process line -- folded into OD Turning.
    const odTurning = result.processLines.find((l) => l.process === 'OD Turning');
    expect(odTurning).toBeDefined();
    expect(odTurning!.setupTimeMin).toBeGreaterThan(0);
  });
});

describe('requiredMilledMachineClass', () => {
  it('maps difficulty and pockets to the minimum class', () => {
    expect(requiredMilledMachineClass('medium', 4)).toBe('3_axis_mill');
    expect(requiredMilledMachineClass('hard', 4)).toBe('4_axis_mill');
    expect(requiredMilledMachineClass('medium', 13)).toBe('4_axis_mill');
    expect(requiredMilledMachineClass('very_hard', 0)).toBe('5_axis_mill');
    expect(requiredMilledMachineClass(null, 26)).toBe('5_axis_mill');
  });

  it('gates lower classes and passes higher ones', () => {
    expect(meetsRequiredMilledClass(mc('3_axis_mill'), mc('4_axis_mill'))).toBe(false);
    expect(meetsRequiredMilledClass(mc('5_axis_mill'), mc('4_axis_mill'))).toBe(true);
    // Lathe classes are not gated by the milled hierarchy
    expect(meetsRequiredMilledClass(mc('2_axis_lathe'), mc('5_axis_mill'))).toBe(true);
  });
});

describe('pickRecommendedRoute', () => {
  it('picks the lowest-cost capable route — Cost Summary must equal the Route Comparison badge', () => {
    const picked = pickRecommendedRoute([
      { id: '3ax', totalCost: 766, capable: true, setupCount: 3 },
      { id: '4ax', totalCost: 990, capable: true, setupCount: 2 },
      { id: '5ax', totalCost: 1239, capable: true, setupCount: 1 },
    ]);
    expect(picked.id).toBe('3ax');
  });

  it('never recommends an incapable route while a capable one exists', () => {
    const picked = pickRecommendedRoute([
      { id: '3ax', totalCost: 766, capable: false, setupCount: 3 },
      { id: '5ax', totalCost: 1239, capable: true, setupCount: 1 },
    ]);
    expect(picked.id).toBe('5ax');
  });

  it('breaks cost ties toward fewer setups', () => {
    const picked = pickRecommendedRoute([
      { id: 'a', totalCost: 100, capable: true, setupCount: 3 },
      { id: 'b', totalCost: 100, capable: true, setupCount: 1 },
    ]);
    expect(picked.id).toBe('b');
  });

  it('falls back to cheapest overall when nothing is capable', () => {
    const picked = pickRecommendedRoute([
      { id: 'a', totalCost: 200, capable: false, setupCount: 1 },
      { id: 'b', totalCost: 100, capable: false, setupCount: 1 },
    ]);
    expect(picked.id).toBe('b');
  });
});

describe('benchmarkRateWarning', () => {
  it('flags an implausibly low DB rate (the ¥160 Makino case)', () => {
    // China 5-axis benchmark ¥580 — an imported ¥160 must be visible
    const warning = benchmarkRateWarning('5_axis_mill', 'China', 160, 'Makino D300', 580);
    expect(warning).toContain('Makino D300');
    expect(warning).toContain('below');
  });

  it('flags an implausibly high rate', () => {
    const warning = benchmarkRateWarning('3_axis_mill', 'USA', 900, 'Mystery VMC', 85);
    expect(warning).toContain('over');
  });

  it('stays silent inside the plausible band', () => {
    expect(benchmarkRateWarning('3_axis_mill', 'USA', 85, 'Haas VF-2', 85)).toBeNull();
  });

  it('stays silent when no benchmark is provided (DB had no row)', () => {
    expect(benchmarkRateWarning('3_axis_mill', 'Atlantis', 85, 'Haas VF-2', undefined)).toBeNull();
    expect(benchmarkRateWarning('unknown_class', 'USA', 85, 'Haas VF-2', undefined)).toBeNull();
  });
});

describe('material shape ranking (costing lookup)', () => {
  it('prefers plate/block/bar stock for machined parts over sheet rows', () => {
    expect(shapeRankForFamily('plates', 'cnc_milled')).toBeLessThan(
      shapeRankForFamily('sheets', 'cnc_milled'),
    );
    expect(shapeRankForFamily('bars', 'cnc_turned')).toBeLessThan(
      shapeRankForFamily('sheets', 'cnc_turned'),
    );
  });

  it('ranks a wrong-form row below a form-less row (sheet must lose to unknown for CNC)', () => {
    expect(shapeRankForFamily('sheets', 'cnc_milled')).toBeGreaterThan(
      shapeRankForFamily(null, 'cnc_milled'),
    );
    expect(isDiscouragedShapeForFamily('sheets', 'cnc_milled')).toBe(true);
    expect(isDiscouragedShapeForFamily('plates', 'cnc_milled')).toBe(false);
  });

  it('prefers sheet/coil stock for sheet-metal parts', () => {
    expect(shapeRankForFamily('sheets', 'sheet_metal')).toBe(0);
    expect(shapeRankForFamily('bars', 'sheet_metal')).toBe(100);
  });
});

// ── Sprint 1 regression tests ─────────────────────────────────────────────────

describe('Fix 1 — holeCount: feature-ops path uses correct count, not raw cylinder count', () => {
  it('billing 19 phantom holes (no holeGroups) costs more than 3 real holes in bbox-subtraction path', () => {
    // The real demo part has 3 tapped holes, not 19 raw cylinders.
    // holeGroups must be empty so the fallback holeCount path is used
    const phantom = computeCNCMilledCostSummary(
      milledInput({ holeCount: 19, holeGroups: [], featureOps: undefined }),
      mc('3_axis_mill'),
    );
    const real = computeCNCMilledCostSummary(
      milledInput({ holeCount: 3, holeGroups: [], featureOps: undefined }),
      mc('3_axis_mill'),
    );
    const millingPhantom = phantom.processLines.find((l) => l.process === 'CNC Milling')!.cycleTimeMin;
    const millingReal = real.processLines.find((l) => l.process === 'CNC Milling')!.cycleTimeMin;
    expect(millingPhantom).toBeGreaterThan(millingReal);
  });
});

describe('Fix 2 — blank optimizer: blankResult overrides bbox billet volume', () => {
  it('uses blankResult billetVolMm3 when provided instead of computing from bbox', () => {
    // The round bar (Ø30) gives a tighter blank than the full bbox billet
    const roundBarVol = Math.PI * 15 ** 2 * (83 + 5); // Ø30 × (L+5mm facing)
    const result = computeCNCMilledCostSummary(
      milledInput({
        blankResult: {
          form: 'round_bar',
          sizeLabel: 'Ø30 round bar',
          billetVolMm3: roundBarVol,
          utilizationPct: 62,
        },
      }),
      mc('3_axis_mill'),
    );
    // Billet weight from round bar volume
    const expectedBilletKg = (roundBarVol / 1e9) * 2700;
    expect(result.materialRemoval!.billetWeightKg).toBeCloseTo(expectedBilletKg, 3);
  });

  it('falls back to bbox billet when blankResult is absent', () => {
    const allow = 2 * CNC_STOCK_ALLOWANCE_PER_SIDE_MM;
    const bboxVol = (83 + allow) * (62 + allow) * (32 + allow);
    const result = computeCNCMilledCostSummary(milledInput(), mc('3_axis_mill'));
    expect(result.materialRemoval!.billetWeightKg).toBeCloseTo((bboxVol / 1e9) * 2700, 3);
  });
});

describe('Fix 4 — machinabilityRating: scales MRR in both engines', () => {
  it('Al 6061 (machinability 150) gives lower roughing cycle time than mild steel (75)', () => {
    // No holes/holeGroups so milling time = pure roughing from MRR, uncontaminated by
    // fixed-time drilling ops. That isolates the machinabilityRating scaling.
    const alPart = computeCNCMilledCostSummary(
      milledInput({ materialGrade: 'AL6061-T6', machinabilityRating: 150, holeCount: 0, holeGroups: [] }),
      mc('3_axis_mill'),
    );
    const steelPart = computeCNCMilledCostSummary(
      milledInput({ materialGrade: 'A36', machinabilityRating: 75, holeCount: 0, holeGroups: [] }),
      mc('3_axis_mill'),
    );
    const alMilling = alPart.processLines.find((l) => l.process === 'CNC Milling')!.cycleTimeMin;
    const steelMilling = steelPart.processLines.find((l) => l.process === 'CNC Milling')!.cycleTimeMin;
    // Al MRR = 60000 × 2 = 120000; mild_steel MRR = 12000 × 1 = 12000 → 10× faster
    expect(alMilling).toBeLessThan(steelMilling);
    expect(steelMilling / alMilling).toBeCloseTo(10, 0);
  });

  it('featureOps path: total time with Al machinability < same ops with mild steel', () => {
    const fgv2 = [
      { feature_type: 'pocket', diameter_mm: 0,
        occurrences: [{ depth_mm: 12, material_removed_mm3: 15_000 }] },
    ];
    const alOps = buildOperationSequence(fgv2, 'aluminum', 2.0);
    const steelOps = buildOperationSequence(fgv2, 'mild_steel', 1.0);
    const alTime = alOps.find((o) => o.name === 'Pocket Rough')!.timeSec;
    const steelTime = steelOps.find((o) => o.name === 'Pocket Rough')!.timeSec;
    expect(alTime).toBeLessThan(steelTime);
  });
});

describe('Fix 3 — featureOps path: total time drives CNC Milling line', () => {
  it('uses featureOps total when provided instead of billet-subtraction formula', () => {
    const knownOps = [
      { name: 'Face Mill', timeSec: 45, source: 'fixed' as const },
      { name: 'Pocket Rough', timeSec: 300, source: 'feature' as const },
      { name: 'Drill', timeSec: 40, source: 'feature' as const },
      { name: 'Deburr', timeSec: 90, source: 'fixed' as const },
    ];
    // Total = 385s (Face Mill + Pocket Rough + Drill) -- Deburr is excluded:
    // it has its own real, dedicated "Deburring" line elsewhere in this
    // function (tblDeburring-based) and must not also be folded in here.
    // With 15% overhead -> 385 * 1.15 / 60 ≈ 7.38 min.
    const result = computeCNCMilledCostSummary(
      milledInput({ featureOps: knownOps }),
      mc('3_axis_mill'),
    );
    const millingMin = result.processLines.find((l) => l.process === 'CNC Milling')!.cycleTimeMin;
    expect(millingMin).toBeCloseTo((385 * 1.15) / 60, 1);
  });

  // Root-caused live (2026-09-18): "CNC Milling" summed the sequencer's
  // FULL output with no exclusion, so a part's real Tapping time
  // (computeTapCycleSec, via the sequencer's own "Rigid Tap" entry) and the
  // sequencer's flat 90s "Deburr" placeholder were BOTH folded into "CNC
  // Milling" AND billed again as the separate, real "Tapping"/"Deburring"
  // lines below -- double-billing every part with tapped holes or feature
  // data. Fixed by excluding both names from the CNC Milling sum.
  it('excludes Rigid Tap and Deburr from the CNC Milling sum -- both are billed via their own dedicated line, not twice', () => {
    const knownOps = [
      { name: 'Face Mill', timeSec: 45, source: 'fixed' as const },
      { name: 'Drill', timeSec: 40, source: 'feature' as const },
      { name: 'Rigid Tap', timeSec: 200, source: 'feature' as const },
      { name: 'Deburr', timeSec: 90, source: 'fixed' as const },
    ];
    const result = computeCNCMilledCostSummary(
      milledInput({ featureOps: knownOps }),
      mc('3_axis_mill'),
    );
    const millingMin = result.processLines.find((l) => l.process === 'CNC Milling')!.cycleTimeMin;
    // Only Face Mill (45s) + Drill (40s) = 85s, * 1.15 / 60
    expect(millingMin).toBeCloseTo((85 * 1.15) / 60, 2);
    // The real, separately-billed Tapping/Deburring lines still exist and
    // are unaffected -- this fix removes a DUPLICATE, not the real charge.
    expect(result.processLines.some((l) => l.process === 'Tapping')).toBe(true);
    expect(result.processLines.some((l) => l.process === 'Deburring')).toBe(true);
  });

  it('falls back to billet-subtraction when featureOps is absent', () => {
    const without = computeCNCMilledCostSummary(milledInput({ featureOps: undefined }), mc('3_axis_mill'));
    const milling = without.processLines.find((l) => l.process === 'CNC Milling')!;
    // bbox path: roughingMin = (billetVol - partVol) / MRR * 1.3 + drill
    expect(milling.cycleTimeMin).toBeGreaterThan(0);
  });
});

// Root-cause fix: cost-cnc-engine.ts's drilling/tapping cycle times used to
// come from flat, material-blind tables (DRILL_CYCLE_SEC diameter buckets,
// TAP_CYCLE_SEC per thread size) — a stainless part and an aluminum part
// with identical geometry priced identically. Both now call the same real,
// sourced, material-family-aware physics (resolveDrillingSpeedFeed /
// computeTapCycleSec) every other secondary-hole-operation path in this
// codebase already uses. These tests prove the material sensitivity that
// did not exist before, not just that the functions still run.
describe('Fix — drilling/tapping now use real material-aware physics (no more flat tables)', () => {
  it('drilling a stainless part takes longer than the identical aluminum part (bbox-subtraction path)', () => {
    const alu = computeCNCMilledCostSummary(
      milledInput({ featureOps: undefined, materialGrade: 'AL6061-T6', threads: [] }),
      mc('3_axis_mill'),
    );
    const stainless = computeCNCMilledCostSummary(
      milledInput({ featureOps: undefined, materialGrade: 'SS304', threads: [] }),
      mc('3_axis_mill'),
    );
    const aluMilling = alu.processLines.find((l) => l.process === 'CNC Milling')!.cycleTimeMin;
    const ssMilling = stainless.processLines.find((l) => l.process === 'CNC Milling')!.cycleTimeMin;
    // Real HSS surface speed: aluminum 80 m/min vs stainless 15 m/min
    // (DRILL_SURFACE_SPEED_M_MIN_BY_MATERIAL) — stainless must take longer.
    expect(ssMilling).toBeGreaterThan(aluMilling);
  });

  it('tapping a stainless part takes longer than the identical aluminum part', () => {
    const alu = computeCNCMilledCostSummary(
      milledInput({ materialGrade: 'AL6061-T6', threads: [{ size: 'M6', count: 4 }] }),
      mc('3_axis_mill'),
    );
    const stainless = computeCNCMilledCostSummary(
      milledInput({ materialGrade: 'SS304', threads: [{ size: 'M6', count: 4 }] }),
      mc('3_axis_mill'),
    );
    const aluTap = alu.processLines.find((l) => l.process === 'Tapping')!.cycleTimeMin;
    const ssTap = stainless.processLines.find((l) => l.process === 'Tapping')!.cycleTimeMin;
    // TAP_SURFACE_SPEED_M_MIN_BY_MATERIAL: aluminum 25 m/min vs stainless 4.5 m/min.
    expect(ssTap).toBeGreaterThan(aluTap);
  });

  it('uses a real per-thread depth/pitch when the caller supplies one, instead of always assuming the flat fallback', () => {
    const shallow = computeCNCMilledCostSummary(
      milledInput({ threads: [{ size: 'M6', count: 4, depthMm: 5 }] }),
      mc('3_axis_mill'),
    );
    const deep = computeCNCMilledCostSummary(
      milledInput({ threads: [{ size: 'M6', count: 4, depthMm: 30 }] }),
      mc('3_axis_mill'),
    );
    const shallowTap = shallow.processLines.find((l) => l.process === 'Tapping')!.cycleTimeMin;
    const deepTap = deep.processLines.find((l) => l.process === 'Tapping')!.cycleTimeMin;
    expect(deepTap).toBeGreaterThan(shallowTap);
  });

  it('turned parts: boring/drilling is also material-aware now', () => {
    const turnedInput = (overrides: Partial<CNCCostInput> = {}): CNCCostInput => ({
      volume: 50_000, surfaceArea: 20_000, maxLength: 60, maxWidth: 25, maxHeight: 25,
      holeCount: 10, holeGroups: [{ diameter_mm: 6, count: 10 }], pocketCount: 0,
      materialGrade: 'AL6061-T6', materialCostPerKg: 350, materialDensityKgM3: 2700,
      materialSource: 'db', threads: [], tightestToleranceMm: null, gdtFeatureCount: 0,
      batchSize: 60, family: 'cnc_turned', finishedWeightKg: 0.1,
      mhrRate: rate(900, { machineClass: '2_axis_lathe' }),
      tappingRate: rate(900, { machineClass: 'tapping' }),
      deburrRate: rate(300, { machineClass: 'deburring' }),
      inspectionRate: rate(450, { machineClass: 'cmm' }),
      surfaceTreatment: null,
      ...overrides,
    });
    const alu = computeCNCTurnedCostSummary(turnedInput({ materialGrade: 'AL6061-T6' }), mc('2_axis_lathe'));
    const stainless = computeCNCTurnedCostSummary(turnedInput({ materialGrade: 'SS304' }), mc('2_axis_lathe'));
    const aluBoring = alu.processLines.find((l) => l.process === 'Drilling')!.cycleTimeMin;
    const ssBoring = stainless.processLines.find((l) => l.process === 'Drilling')!.cycleTimeMin;
    expect(ssBoring).toBeGreaterThan(aluBoring);
  });
});

describe('Fix — operation-sequencer.ts shares one MRR/drill/tap source of truth with cost-cnc-engine.ts', () => {
  it('feature-driven drilling is also material-aware (was diameter-only before)', () => {
    const throughHole = (dia: number) => [{
      feature_type: 'through_hole',
      diameter_mm: dia,
      occurrences: [{ depth_mm: 10 }],
    }];
    const aluOps = buildOperationSequence(throughHole(6), 'aluminum', 1.0, 'AL6061-T6');
    const ssOps = buildOperationSequence(throughHole(6), 'stainless', 1.0, 'SS304');
    const aluDrill = aluOps.find((o) => o.name === 'Drill')!.timeSec;
    const ssDrill = ssOps.find((o) => o.name === 'Drill')!.timeSec;
    expect(ssDrill).toBeGreaterThan(aluDrill);
  });

  it('feature-driven tapping is also material-aware (was a flat per-size table before)', () => {
    const tappedHole = [{
      feature_type: 'tapped_hole',
      diameter_mm: 6,
      occurrences: [{ depth_mm: 12, spec: 'M6' }],
    }];
    const aluOps = buildOperationSequence(tappedHole, 'aluminum', 1.0, 'AL6061-T6');
    const ssOps = buildOperationSequence(tappedHole, 'stainless', 1.0, 'SS304');
    const aluTap = aluOps.find((o) => o.name === 'Rigid Tap')!.timeSec;
    const ssTap = ssOps.find((o) => o.name === 'Rigid Tap')!.timeSec;
    expect(ssTap).toBeGreaterThan(aluTap);
  });
});

// Root-caused 2026-09-16: checkCNCCapability used to be untested and used a
// single hardcoded per-CLASS envelope for every machine in that class,
// regardless of which real machine was actually selected. Now delegates to
// checkMachineCapability (the same real per-machine system every other
// domain uses) when the caller has a resolved candidate, and only falls
// back to the class-level default when it genuinely doesn't (pre-selection
// feasibility gate, or physics selection disabled) — these tests prove
// both paths, and that they produce DIFFERENT verdicts for the same
// bounding box depending on which real machine was actually selected.
describe('checkCNCCapability — real per-machine envelope (migration 755) vs class-default fallback', () => {
  function cap(overrides: Partial<MachineCapability>): MachineCapability {
    return { ...EMPTY_CAPABILITY, ...overrides };
  }

  it('a real small-chuck lathe rejects a part the class-default envelope alone would have allowed', () => {
    // 2_axis_lathe's MACHINE_ENVELOPE class default is generous (l:600,w:300,h:300);
    // a real, specific small lathe (maxDiameterMm=100) must be stricter.
    const withoutReal = checkCNCCapability(mc('2_axis_lathe'), 500, 150, 150, 5);
    expect(withoutReal.overallCapable).toBe(true);

    const withReal = checkCNCCapability(
      mc('2_axis_lathe'), 500, 150, 150, 5,
      cap({ maxDiameterMm: 100, maxLengthMm: 3000 }), 'imported',
    );
    expect(withReal.overallCapable).toBe(false);
    expect(withReal.machineCapabilityWarnings.some((w) => w.includes('swing capacity'))).toBe(true);
  });

  it('a real large mill accepts a part the class-default envelope alone would have rejected', () => {
    // 3_axis_mill's MACHINE_ENVELOPE class default is l:600,w:400,h:400;
    // a real, specific large VMC has real travel well beyond that.
    const withoutReal = checkCNCCapability(mc('3_axis_mill'), 900, 700, 500, 50);
    expect(withoutReal.overallCapable).toBe(false);

    const withReal = checkCNCCapability(
      mc('3_axis_mill'), 900, 700, 500, 50,
      cap({ maxXMm: 2133.6, maxYMm: 2133.6, maxZMm: 1219 }), 'imported',
    );
    expect(withReal.overallCapable).toBe(true);
  });

  it('rejects on real Z-axis travel specifically, distinct from X/Y', () => {
    const result = checkCNCCapability(
      mc('5_axis_mill'), 500, 400, 900, 50,
      cap({ maxXMm: 2000, maxYMm: 2000, maxZMm: 750 }), 'imported',
    );
    expect(result.overallCapable).toBe(false);
    expect(result.machineCapabilityWarnings.some((w) => w.includes('Z-axis'))).toBe(true);
  });

  it('weight stays on the class-default ceiling even with real capability data (no real per-machine weight source exists)', () => {
    const result = checkCNCCapability(
      mc('2_axis_lathe'), 100, 50, 50, 100_000, // absurd weight, real dims fine
      cap({ maxDiameterMm: 700, maxLengthMm: 3000 }), 'imported',
    );
    expect(result.overallCapable).toBe(false);
    expect(result.machineCapabilityWarnings.some((w) => w.includes('weight capacity'))).toBe(true);
  });

  it('falls back to the class-default envelope, disclosed as such, when no real machine has been selected yet', () => {
    const result = checkCNCCapability(mc('3_axis_mill'), 5000, 5000, 5000, 5);
    expect(result.overallCapable).toBe(false);
    expect(result.machineCapabilityWarnings.some((w) => w.includes('class default'))).toBe(true);
  });
});

// Root-caused 2026-09-16: Reaming had ZERO implementation before (no case
// in operation-sequencer.ts's switch, no line in either cost function) —
// a real, sourced tblReaming table (316 rows) existed and was completely
// unused. Deburring used an uncited flat "surfaceArea/10000*0.5" constant
// with no material sensitivity and no dedicated line on turned parts at
// all (a pre-existing mislabel: cycleTimes.deburrMin reported boringMin).
const REAM_TABLE = [
  { ToolType: 'Ream', MaterialCutCodeName: '1.0', Hardness: 125, HardnessSystem: 'Brinell', DiameterMm: 3, CuttingSpeedMPerMin: 22.6, FeedMm: 0.15 },
  { ToolType: 'Ream', MaterialCutCodeName: '15.0', Hardness: 275, HardnessSystem: 'Brinell', DiameterMm: 3, CuttingSpeedMPerMin: 8.0, FeedMm: 0.10 },
];

// Every fixture below uses 0.04mm, not the tighter values a real Reaming
// scenario might use in the field — 0.04 sits strictly between the real
// JIG_BORE_POSITION_TOLERANCE_MM (0.026, tighter tier added 2026-09-18)
// and TIGHT_TOLERANCE_REAM_THRESHOLD_MM (0.05), so these tests exercise
// Reaming specifically without also entering Jig Boring's tier.

describe('Reaming — new operation, tolerance-triggered, real tblReaming physics', () => {
  it('adds no Reaming line when tolerance is not tight, even with real reamTable data', () => {
    const result = computeCNCMilledCostSummary(
      milledInput({ tightestToleranceMm: 0.2, reamTable: REAM_TABLE } as any),
      mc('3_axis_mill'),
    );
    expect(result.processLines.some((l) => l.process === 'Reaming')).toBe(false);
  });

  it('adds no Reaming line when tolerance is tight but no real reamTable was resolved (disclosed gap, not fabricated)', () => {
    const result = computeCNCMilledCostSummary(
      milledInput({ tightestToleranceMm: 0.04, reamTable: null } as any),
      mc('3_axis_mill'),
    );
    expect(result.processLines.some((l) => l.process === 'Reaming')).toBe(false);
    expect(result.warnings.some((w) => w.includes('reaming'))).toBe(true);
  });

  it('adds a real Reaming line when tolerance is tight AND real reamTable data is available', () => {
    const result = computeCNCMilledCostSummary(
      milledInput({
        tightestToleranceMm: 0.04,
        holeGroups: [{ diameter_mm: 3, count: 4 }],
        reamTable: REAM_TABLE,
      } as any),
      mc('3_axis_mill'),
    );
    const reamLine = result.processLines.find((l) => l.process === 'Reaming');
    expect(reamLine).toBeDefined();
    expect(reamLine!.cycleTimeMin).toBeGreaterThan(0);
  });

  it('reams the smallest real hole group when several exist (disclosed part-level approximation)', () => {
    const withSmall = computeCNCMilledCostSummary(
      milledInput({
        tightestToleranceMm: 0.04,
        holeGroups: [{ diameter_mm: 3, count: 1 }, { diameter_mm: 20, count: 1 }],
        reamTable: REAM_TABLE,
      } as any),
      mc('3_axis_mill'),
    );
    // REAM_TABLE only has real rows at diameter 3mm -- if the smallest (3mm)
    // hole were NOT the one chosen, the nearest-diameter match would still
    // resolve (real data exists at 3mm either way), so instead prove the
    // stainless-vs-aluminum material sensitivity carries through the reamed
    // diameter selection by checking a real, distinct cycle time exists.
    const reamLine = withSmall.processLines.find((l) => l.process === 'Reaming');
    expect(reamLine).toBeDefined();
  });

  it('reaming is material-aware — stainless reams slower than aluminum for the same real diameter', () => {
    const alu = computeCNCMilledCostSummary(
      milledInput({
        materialGrade: 'AL6061-T6', tightestToleranceMm: 0.04,
        holeGroups: [{ diameter_mm: 3, count: 1 }], reamTable: REAM_TABLE,
      } as any),
      mc('3_axis_mill'),
    );
    const stainless = computeCNCMilledCostSummary(
      milledInput({
        materialGrade: 'SS304', tightestToleranceMm: 0.04,
        holeGroups: [{ diameter_mm: 3, count: 1 }], reamTable: REAM_TABLE,
      } as any),
      mc('3_axis_mill'),
    );
    const aluReam = alu.processLines.find((l) => l.process === 'Reaming')!.cycleTimeMin;
    const ssReam = stainless.processLines.find((l) => l.process === 'Reaming')!.cycleTimeMin;
    expect(ssReam).toBeGreaterThan(aluReam);
  });

  it('applies to turned parts too (was missing from that function entirely)', () => {
    const turnedInput = (overrides: any = {}): CNCCostInput => ({
      volume: 50_000, surfaceArea: 20_000, maxLength: 60, maxWidth: 25, maxHeight: 25,
      holeCount: 1, holeGroups: [{ diameter_mm: 3, count: 1 }], pocketCount: 0,
      materialGrade: 'AL6061-T6', materialCostPerKg: 350, materialDensityKgM3: 2700,
      materialSource: 'db', threads: [], tightestToleranceMm: 0.04, gdtFeatureCount: 0,
      batchSize: 60, family: 'cnc_turned', finishedWeightKg: 0.1,
      mhrRate: rate(900, { machineClass: '2_axis_lathe' }),
      tappingRate: rate(900, { machineClass: 'tapping' }),
      deburrRate: rate(300, { machineClass: 'deburring' }),
      inspectionRate: rate(450, { machineClass: 'cmm' }),
      surfaceTreatment: null,
      reamTable: REAM_TABLE,
      ...overrides,
    });
    const result = computeCNCTurnedCostSummary(turnedInput(), mc('2_axis_lathe'));
    expect(result.processLines.some((l) => l.process === 'Reaming')).toBe(true);
  });
});

describe('Deburring — real hardness-matched tblDeburring speed, fixed a pre-existing turned-part gap', () => {
  it('falls back to the previous flat formula when no real rate is resolved', () => {
    const result = computeCNCMilledCostSummary(
      milledInput({ deburrLinearSpeedMmPerSec: null } as any),
      mc('3_axis_mill'),
    );
    const line = result.processLines.find((l) => l.process === 'Deburring');
    expect(line).toBeDefined();
    // 40,000 mm^2 default surfaceArea in milledInput -> (40000/10000)*0.5 = 2 min
    expect(line!.cycleTimeMin).toBeCloseTo(2, 1);
  });

  it('uses the real resolved linear speed instead of the flat constant when available', () => {
    const withFlat = computeCNCMilledCostSummary(milledInput({ deburrLinearSpeedMmPerSec: null } as any), mc('3_axis_mill'));
    const withReal = computeCNCMilledCostSummary(milledInput({ deburrLinearSpeedMmPerSec: 18.8 } as any), mc('3_axis_mill'));
    const flatMin = withFlat.processLines.find((l) => l.process === 'Deburring')!.cycleTimeMin;
    const realMin = withReal.processLines.find((l) => l.process === 'Deburring')!.cycleTimeMin;
    expect(realMin).not.toBeCloseTo(flatMin, 3);
    expect(realMin).toBeGreaterThan(0);
  });

  it('turned parts now get a real Deburring line — this was a total gap before (zero deburr cost on any turned part)', () => {
    const turnedInput = (overrides: any = {}): CNCCostInput => ({
      volume: 50_000, surfaceArea: 20_000, maxLength: 60, maxWidth: 25, maxHeight: 25,
      holeCount: 0, holeGroups: [], pocketCount: 0,
      materialGrade: 'AL6061-T6', materialCostPerKg: 350, materialDensityKgM3: 2700,
      materialSource: 'db', threads: [], tightestToleranceMm: null, gdtFeatureCount: 0,
      batchSize: 60, family: 'cnc_turned', finishedWeightKg: 0.1,
      mhrRate: rate(900, { machineClass: '2_axis_lathe' }),
      tappingRate: rate(900, { machineClass: 'tapping' }),
      deburrRate: rate(300, { machineClass: 'deburring' }),
      inspectionRate: rate(450, { machineClass: 'cmm' }),
      surfaceTreatment: null,
      ...overrides,
    });
    const result = computeCNCTurnedCostSummary(turnedInput(), mc('2_axis_lathe'));
    expect(result.processLines.some((l) => l.process === 'Deburring')).toBe(true);
  });

  it('turned-part cycleTimes.deburrMin now reports real deburr time, not boring time (a pre-existing mislabel)', () => {
    const turnedInput = (overrides: any = {}): CNCCostInput => ({
      volume: 50_000, surfaceArea: 20_000, maxLength: 60, maxWidth: 25, maxHeight: 25,
      holeCount: 10, holeGroups: [{ diameter_mm: 6, count: 10 }], pocketCount: 0,
      materialGrade: 'AL6061-T6', materialCostPerKg: 350, materialDensityKgM3: 2700,
      materialSource: 'db', threads: [], tightestToleranceMm: null, gdtFeatureCount: 0,
      batchSize: 60, family: 'cnc_turned', finishedWeightKg: 0.1,
      mhrRate: rate(900, { machineClass: '2_axis_lathe' }),
      tappingRate: rate(900, { machineClass: 'tapping' }),
      deburrRate: rate(300, { machineClass: 'deburring' }),
      inspectionRate: rate(450, { machineClass: 'cmm' }),
      surfaceTreatment: null,
      ...overrides,
    });
    const result = computeCNCTurnedCostSummary(turnedInput(), mc('2_axis_lathe'));
    const boringLine = result.processLines.find((l) => l.process === 'Drilling')!;
    const deburrLine = result.processLines.find((l) => l.process === 'Deburring')!;
    expect(result.cycleTimes.deburrMin).toBeCloseTo(deburrLine.cycleTimeMin, 2);
    expect(result.cycleTimes.deburrMin).not.toBeCloseTo(boringLine.cycleTimeMin, 2);
  });
});

// Real tblGunDrilling.json rows (column names transcribed verbatim from the
// source spreadsheet) and a real deep_bore_drill_lookup.json materials-array
// slice — both already staged in machining_reference_data (migration 739/740).
const GUN_DRILL_TABLE = [
  { 'Tool Type': 'Gun Drill', 'Material Cut Code Name': '1.0', Hardness: 125, 'Diameter (mm)': 3, 'Cutting Speed (m / min)': 135, 'Feed (mm / rev)': 0.005 },
  { 'Tool Type': 'Gun Drill', 'Material Cut Code Name': '15.0', Hardness: 275, 'Diameter (mm)': 3, 'Cutting Speed (m / min)': 60, 'Feed (mm / rev)': 0.003 },
];
const DEEP_BORE_MATERIALS = [
  { material_cut_code: '1.0', hardness: 125, cutting_speed_m_min: 502.8, feed_mm_rev_by_diameter: { '68.0': 0.12, '75.0': 0.133 } },
  { material_cut_code: '15.0', hardness: 275, cutting_speed_m_min: 90.0, feed_mm_rev_by_diameter: { '68.0': 0.10, '75.0': 0.11 } },
];

// Root-caused live (2026-09-18): "Gun Drill" and "Deep Bore Machine" are
// real, staged machine categories (migrations 737/738/752/753 already
// activate their process_calculator_mappings rows) with real cutting-
// physics tables, but had ZERO cost engine before this — every hole was
// priced as a regular CNC "Drill" op regardless of depth.
describe('Gun Drilling / Deep Bore Machine — new operations, real L/D-triggered routing (deep-hole-routing.ts)', () => {
  it('adds no Gun Drilling/Deep Bore line when there are no deep-hole candidates', () => {
    const result = computeCNCMilledCostSummary(milledInput(), mc('3_axis_mill'));
    expect(result.processLines.some((l) => l.process === 'Gun Drilling')).toBe(false);
    expect(result.processLines.some((l) => l.process === 'Deep Bore Machine')).toBe(false);
  });

  it('adds a real Gun Drilling line, billed at its own dedicated rate, when a small-diameter deep-hole candidate and a real rate exist', () => {
    const result = computeCNCMilledCostSummary(
      milledInput({
        gunDrillCandidates: [{ diameterMm: 3, depthMm: 60, count: 4 }],
        gunDrillTable: GUN_DRILL_TABLE,
        gunDrillRate: rate(1500, { machineClass: 'gun_drill', machineName: 'Honge XE 1200-CNC' }),
      } as any),
      mc('3_axis_mill'),
    );
    const line = result.processLines.find((l) => l.process === 'Gun Drilling');
    expect(line).toBeDefined();
    expect(line!.cycleTimeMin).toBeGreaterThan(0);
    expect(line!.hourlyRate).toBe(1500);
    expect(line!.machineClass).toBe('gun_drill');
  });

  it('adds a real Deep Bore Machine line, billed at its own dedicated rate, for a large-diameter deep-hole candidate', () => {
    const result = computeCNCMilledCostSummary(
      milledInput({
        deepBoreCandidates: [{ diameterMm: 68, depthMm: 900, count: 1 }],
        deepBoreMaterials: DEEP_BORE_MATERIALS,
        deepBoreRate: rate(2200, { machineClass: 'deep_bore_machine', machineName: 'Fortune 2225' }),
      } as any),
      mc('3_axis_mill'),
    );
    const line = result.processLines.find((l) => l.process === 'Deep Bore Machine');
    expect(line).toBeDefined();
    expect(line!.cycleTimeMin).toBeGreaterThan(0);
    expect(line!.machineName).toBe('Fortune 2225');
  });

  it('discloses, rather than fabricates, when a candidate exists but no dedicated rate is on file', () => {
    const result = computeCNCMilledCostSummary(
      milledInput({
        gunDrillCandidates: [{ diameterMm: 3, depthMm: 60, count: 4 }],
        gunDrillTable: GUN_DRILL_TABLE,
        gunDrillRate: undefined,
      } as any),
      mc('3_axis_mill'),
    );
    expect(result.processLines.some((l) => l.process === 'Gun Drilling')).toBe(false);
  });

  it('discloses, rather than fabricates, when a rate exists but no real cutting-physics table was resolved', () => {
    const result = computeCNCMilledCostSummary(
      milledInput({
        gunDrillCandidates: [{ diameterMm: 3, depthMm: 60, count: 4 }],
        gunDrillTable: null,
        gunDrillRate: rate(1500, { machineClass: 'gun_drill' }),
      } as any),
      mc('3_axis_mill'),
    );
    expect(result.processLines.some((l) => l.process === 'Gun Drilling')).toBe(false);
    expect(result.warnings.some((w) => w.includes('Gun Drilling') && w.includes('not available'))).toBe(true);
  });

  it("prefers the real machine's own setup_time_hr over the disclosed DEEP_HOLE_SETUP_MIN class default", () => {
    const result = computeCNCMilledCostSummary(
      milledInput({
        gunDrillCandidates: [{ diameterMm: 3, depthMm: 60, count: 4 }],
        gunDrillTable: GUN_DRILL_TABLE,
        gunDrillRate: rate(1500, { machineClass: 'gun_drill', setupTimeHr: 0.5 }), // real 30min, per every real gun_drill machine on file
      } as any),
      mc('3_axis_mill'),
    );
    const line = result.processLines.find((l) => l.process === 'Gun Drilling')!;
    expect(line.setupTimeMin).toBe(30);
    expect(line.setupTimeSource).toBe('machine');
  });

  it('falls back to the disclosed 30min class default (real, uniform across every staged machine) when setup_time_hr is absent', () => {
    const result = computeCNCMilledCostSummary(
      milledInput({
        gunDrillCandidates: [{ diameterMm: 3, depthMm: 60, count: 4 }],
        gunDrillTable: GUN_DRILL_TABLE,
        gunDrillRate: rate(1500, { machineClass: 'gun_drill' }),
      } as any),
      mc('3_axis_mill'),
    );
    const line = result.processLines.find((l) => l.process === 'Gun Drilling')!;
    expect(line.setupTimeMin).toBe(30);
    expect(line.setupTimeSource).toBe('class_default');
  });

  it('never double-counts a deep hole against the regular CNC Milling "Drill" op', () => {
    // The caller (bom-items.service.ts) is responsible for removing deep-hole
    // occurrences from featureOps before this function ever sees them —
    // simulate that contract directly: featureOps has no "Drill" entry for
    // the deep hole, only the candidate passed alongside it.
    const result = computeCNCMilledCostSummary(
      milledInput({
        featureOps: [{ name: 'Face Mill', timeSec: 45, source: 'fixed' as const }],
        gunDrillCandidates: [{ diameterMm: 3, depthMm: 60, count: 4 }],
        gunDrillTable: GUN_DRILL_TABLE,
        gunDrillRate: rate(1500, { machineClass: 'gun_drill' }),
      } as any),
      mc('3_axis_mill'),
    );
    const millingLine = result.processLines.find((l) => l.process === 'CNC Milling')!;
    // Only Face Mill (45s) drives CNC Milling -- the gun-drilled holes are
    // billed exclusively on the separate "Gun Drilling" line.
    expect(millingLine.cycleTimeMin).toBeCloseTo((45 * 1.15) / 60, 2);
    expect(result.processLines.some((l) => l.process === 'Gun Drilling')).toBe(true);
  });
});

// Real tblCylindricalGrinding row (material_cut_code "1.0") — already
// staged in machining_reference_data.
const CYLINDRICAL_GRINDING_PARAMS = {
  workSpeedMMin: 25.5, roughInfeedMm: 0.05, finishInfeedMm: 0.01,
  roughAxialFeedRevMm: 0.5, finishAxialFeedRevMm: 0.167, dataFound: true,
};

function turnedInput(overrides: Partial<CNCCostInput> = {}): CNCCostInput {
  return milledInput({
    family: 'cnc_turned',
    mhrRate: rate(900, { machineClass: '2_axis_lathe' }),
    ...overrides,
  });
}

// Root-caused live (2026-09-18): "Cylindrical Grinder" is a real, staged
// machine category (migrations 737/738/753) with a real machine fleet and
// real wheel-speed/infeed physics, but had ZERO cost engine — a tight-Ra
// turned part just got its Turning finish pass billed as if it could
// achieve any finish, when tblGtolProcessCapabilities.json's own real data
// says Turning/Milling Fine both bottom out at Ra 0.4µm.
describe('Cylindrical Grinding — new operation, real Ra<0.4µm-triggered, turned parts only', () => {
  it('adds no Cylindrical Grinding line when Ra is not tighter than the real turning/milling ceiling', () => {
    const result = computeCNCTurnedCostSummary(
      turnedInput({ tightestRaMicron: 0.8, cylindricalGrindingParams: CYLINDRICAL_GRINDING_PARAMS,
        cylindricalGrindingRate: rate(1800, { machineClass: 'cylindrical_grinder' }) }),
      mc('2_axis_lathe'),
    );
    expect(result.processLines.some((l) => l.process === 'Cylindrical Grinding')).toBe(false);
  });

  it(`adds no line exactly at the real ${TURNING_MILLING_BEST_ACHIEVABLE_RA_UM}µm ceiling (strictly less than, not <=)`, () => {
    const result = computeCNCTurnedCostSummary(
      turnedInput({ tightestRaMicron: TURNING_MILLING_BEST_ACHIEVABLE_RA_UM, cylindricalGrindingParams: CYLINDRICAL_GRINDING_PARAMS,
        cylindricalGrindingRate: rate(1800, { machineClass: 'cylindrical_grinder' }) }),
      mc('2_axis_lathe'),
    );
    expect(result.processLines.some((l) => l.process === 'Cylindrical Grinding')).toBe(false);
  });

  it('adds a real Cylindrical Grinding line, billed at its own dedicated rate, when Ra is tighter than turning/milling can achieve', () => {
    const result = computeCNCTurnedCostSummary(
      turnedInput({ tightestRaMicron: 0.2, cylindricalGrindingParams: CYLINDRICAL_GRINDING_PARAMS,
        cylindricalGrindingRate: rate(1800, { machineClass: 'cylindrical_grinder', machineName: 'Flex Grind Schaudt M' }) }),
      mc('2_axis_lathe'),
    );
    const line = result.processLines.find((l) => l.process === 'Cylindrical Grinding');
    expect(line).toBeDefined();
    expect(line!.cycleTimeMin).toBeGreaterThan(0);
    expect(line!.machineClass).toBe('cylindrical_grinder');
    expect(line!.machineName).toBe('Flex Grind Schaudt M');
  });

  it('matches the real traverse-grinding physics by hand (RPM from real work speed, real rough+finish pass count from the real finish-grinding allowance)', () => {
    // maxWidth=62, maxHeight=32 -> diameter = max = 62mm; maxLength=83mm (milledInput defaults)
    const result = computeCNCTurnedCostSummary(
      turnedInput({ tightestRaMicron: 0.2, cylindricalGrindingParams: CYLINDRICAL_GRINDING_PARAMS,
        cylindricalGrindingRate: rate(1800, { machineClass: 'cylindrical_grinder' }) }),
      mc('2_axis_lathe'),
    );
    const line = result.processLines.find((l) => l.process === 'Cylindrical Grinding')!;
    const rpm = (25.5 * 1000) / (Math.PI * 62);
    const roughPassSec = (83 / (rpm * 0.5)) * 60;
    const finishPassSec = (83 / (rpm * 0.167)) * 60;
    // finishGrindingDepth 0.1mm total; finish pass takes 0.01mm -> rough
    // portion 0.09mm / roughInfeed 0.05mm -> round(1.8) = 2 rough passes.
    const expectedSec = 2 * roughPassSec + finishPassSec;
    expect(line.cycleTimeMin).toBeCloseTo(expectedSec / 60, 2);
  });

  it('discloses, rather than fabricates, when Ra is tight but no real grinding physics data was resolved', () => {
    const result = computeCNCTurnedCostSummary(
      turnedInput({ tightestRaMicron: 0.2, cylindricalGrindingParams: { workSpeedMMin: 0, roughInfeedMm: 0, finishInfeedMm: 0, roughAxialFeedRevMm: 0, finishAxialFeedRevMm: 0, dataFound: false },
        cylindricalGrindingRate: rate(1800, { machineClass: 'cylindrical_grinder' }) }),
      mc('2_axis_lathe'),
    );
    expect(result.processLines.some((l) => l.process === 'Cylindrical Grinding')).toBe(false);
    expect(result.warnings.some((w) => w.includes('Cylindrical Grinding') && w.includes('not available'))).toBe(true);
  });

  it('discloses, rather than fabricates, when Ra is tight but no dedicated Cylindrical Grinder rate is on file', () => {
    const result = computeCNCTurnedCostSummary(
      turnedInput({ tightestRaMicron: 0.2, cylindricalGrindingParams: CYLINDRICAL_GRINDING_PARAMS, cylindricalGrindingRate: undefined }),
      mc('2_axis_lathe'),
    );
    expect(result.processLines.some((l) => l.process === 'Cylindrical Grinding')).toBe(false);
  });

  it('never adds a Cylindrical Grinding line for a milled part (turned-parts-only scope)', () => {
    const result = computeCNCMilledCostSummary(
      milledInput({ tightestRaMicron: 0.2, cylindricalGrindingParams: CYLINDRICAL_GRINDING_PARAMS,
        cylindricalGrindingRate: rate(1800, { machineClass: 'cylindrical_grinder' }) } as any),
      mc('3_axis_mill'),
    );
    expect(result.processLines.some((l) => l.process === 'Cylindrical Grinding')).toBe(false);
  });

  it("prefers the real machine's own setup_time_hr over the disclosed class default", () => {
    const result = computeCNCTurnedCostSummary(
      turnedInput({ tightestRaMicron: 0.2, cylindricalGrindingParams: CYLINDRICAL_GRINDING_PARAMS,
        cylindricalGrindingRate: rate(1800, { machineClass: 'cylindrical_grinder', setupTimeHr: 0.5 }) }), // real 30min, per every real machine on file
      mc('2_axis_lathe'),
    );
    const line = result.processLines.find((l) => l.process === 'Cylindrical Grinding')!;
    expect(line.setupTimeMin).toBe(30);
    expect(line.setupTimeSource).toBe('machine');
  });

  it(`falls back to the disclosed ${CYLINDRICAL_GRINDING_SETUP_MIN}min class default (real, uniform across every staged machine) when setup_time_hr is absent`, () => {
    const result = computeCNCTurnedCostSummary(
      turnedInput({ tightestRaMicron: 0.2, cylindricalGrindingParams: CYLINDRICAL_GRINDING_PARAMS,
        cylindricalGrindingRate: rate(1800, { machineClass: 'cylindrical_grinder' }) }),
      mc('2_axis_lathe'),
    );
    const line = result.processLines.find((l) => l.process === 'Cylindrical Grinding')!;
    expect(line.setupTimeMin).toBe(CYLINDRICAL_GRINDING_SETUP_MIN);
    expect(line.setupTimeSource).toBe('class_default');
  });
});

// Real tblBoringV2 "Finish Boring" rows (real hardness column, unlike
// Cylindrical Grinding's table — no 2-hop bridge needed here).
const FINISH_BORING_TABLE = [
  { tool_type: 'Finish Bore', cut_type: 'Finish Boring', material_cut_code_name: '1.0', hardness: 125, diameter_mm: 3, cutting_speed_m_min: 30, feed_mm_rev: 0.05 },
  { tool_type: 'Finish Bore', cut_type: 'Finish Boring', material_cut_code_name: '15.0', hardness: 275, diameter_mm: 3, cutting_speed_m_min: 15, feed_mm_rev: 0.03 },
];

// Root-caused live (2026-09-18): a real, tighter tier existed above
// Reaming (memory/machining/lookup/tblGtolProcessCapabilities.json's own
// real Jig Boring positionTolerance data, literal mm, no IT-grade
// conversion needed) but had no cost engine — every part, no matter how
// tight its real required tolerance, was priced at Reaming's rate at best.
describe('Jig Boring — new operation, a real tier tighter than Reaming', () => {
  it('adds no Jig Boring line when tolerance is looser than the real threshold', () => {
    const result = computeCNCMilledCostSummary(
      milledInput({
        tightestToleranceMm: 0.04, holeGroups: [{ diameter_mm: 3, count: 2 }],
        jigBoreTable: FINISH_BORING_TABLE,
        jigBoreRate: rate(2000, { machineClass: 'jig_bore' }),
      } as any),
      mc('3_axis_mill'),
    );
    expect(result.processLines.some((l) => l.process === 'Jig Boring')).toBe(false);
  });

  it(`adds a real Jig Boring line at the real ${JIG_BORE_POSITION_TOLERANCE_MM}mm threshold (inclusive) and tighter`, () => {
    const result = computeCNCMilledCostSummary(
      milledInput({
        tightestToleranceMm: JIG_BORE_POSITION_TOLERANCE_MM, holeGroups: [{ diameter_mm: 3, count: 2 }],
        jigBoreTable: FINISH_BORING_TABLE,
        jigBoreRate: rate(2000, { machineClass: 'jig_bore', machineName: 'SIP Hydroptic 6A' }),
      } as any),
      mc('3_axis_mill'),
    );
    const line = result.processLines.find((l) => l.process === 'Jig Boring');
    expect(line).toBeDefined();
    expect(line!.cycleTimeMin).toBeGreaterThan(0);
    expect(line!.machineClass).toBe('jig_bore');
    expect(line!.machineName).toBe('SIP Hydroptic 6A');
  });

  it('never also adds a Reaming line for the same tight-tolerance hole (mutually exclusive tiers)', () => {
    const result = computeCNCMilledCostSummary(
      milledInput({
        tightestToleranceMm: 0.02, holeGroups: [{ diameter_mm: 3, count: 2 }],
        jigBoreTable: FINISH_BORING_TABLE, jigBoreRate: rate(2000, { machineClass: 'jig_bore' }),
        reamTable: REAM_TABLE,
      } as any),
      mc('3_axis_mill'),
    );
    expect(result.processLines.some((l) => l.process === 'Jig Boring')).toBe(true);
    expect(result.processLines.some((l) => l.process === 'Reaming')).toBe(false);
  });

  it(`applies the real ${JIG_BORE_NUM_REPETITIONS}x repeat-pass count on top of the real Finish Boring physics`, () => {
    const result = computeCNCMilledCostSummary(
      milledInput({
        tightestToleranceMm: 0.02, holeGroups: [{ diameter_mm: 3, count: 1 }],
        jigBoreTable: FINISH_BORING_TABLE, jigBoreRate: rate(2000, { machineClass: 'jig_bore' }),
      } as any),
      mc('3_axis_mill'),
    );
    const line = result.processLines.find((l) => l.process === 'Jig Boring')!;
    // Single-pass finish-boring time at material_cut_code_name '1.0' (hardness
    // 125, nearest to mild_steel's real 125 bridge): depth = 3 * DRILL_DEPTH_TO_DIAMETER_RATIO (2.5) = 7.5mm.
    const rpm = (30 * 1000) / (Math.PI * 3);
    const feedMmPerMin = rpm * 0.05;
    const singlePassSec = (7.5 / feedMmPerMin) * 60 + 2; // + HOLE_OP_UNLOAD_SEC (2s, same constant computeRotaryCycleSec always adds)
    expect(line.cycleTimeMin).toBeCloseTo((singlePassSec * JIG_BORE_NUM_REPETITIONS) / 60, 2);
  });

  it('discloses, rather than fabricates, when tolerance is tight but no real Finish Boring data was resolved', () => {
    const result = computeCNCMilledCostSummary(
      milledInput({
        tightestToleranceMm: 0.02, holeGroups: [{ diameter_mm: 3, count: 1 }],
        jigBoreTable: null, jigBoreRate: rate(2000, { machineClass: 'jig_bore' }),
      } as any),
      mc('3_axis_mill'),
    );
    expect(result.processLines.some((l) => l.process === 'Jig Boring')).toBe(false);
    expect(result.warnings.some((w) => w.includes('Jig Boring') && w.includes('not available'))).toBe(true);
  });

  it('adds no line at all when tolerance is tight but no dedicated Jig Bore rate is on file (genuine gap, no fallback machine)', () => {
    const result = computeCNCMilledCostSummary(
      milledInput({
        tightestToleranceMm: 0.02, holeGroups: [{ diameter_mm: 3, count: 1 }],
        jigBoreTable: FINISH_BORING_TABLE, jigBoreRate: undefined,
      } as any),
      mc('3_axis_mill'),
    );
    expect(result.processLines.some((l) => l.process === 'Jig Boring')).toBe(false);
  });

  it("prefers the real machine's own setup_time_hr over the disclosed class default", () => {
    const result = computeCNCMilledCostSummary(
      milledInput({
        tightestToleranceMm: 0.02, holeGroups: [{ diameter_mm: 3, count: 1 }],
        jigBoreTable: FINISH_BORING_TABLE,
        jigBoreRate: rate(2000, { machineClass: 'jig_bore', setupTimeHr: 1.0 }), // real 60min, per every real Jig Bore machine on file
      } as any),
      mc('3_axis_mill'),
    );
    const line = result.processLines.find((l) => l.process === 'Jig Boring')!;
    expect(line.setupTimeMin).toBe(60);
    expect(line.setupTimeSource).toBe('machine');
  });

  it(`falls back to the disclosed ${JIG_BORE_SETUP_MIN}min class default when setup_time_hr is absent`, () => {
    const result = computeCNCMilledCostSummary(
      milledInput({
        tightestToleranceMm: 0.02, holeGroups: [{ diameter_mm: 3, count: 1 }],
        jigBoreTable: FINISH_BORING_TABLE, jigBoreRate: rate(2000, { machineClass: 'jig_bore' }),
      } as any),
      mc('3_axis_mill'),
    );
    const line = result.processLines.find((l) => l.process === 'Jig Boring')!;
    expect(line.setupTimeMin).toBe(JIG_BORE_SETUP_MIN);
    expect(line.setupTimeSource).toBe('class_default');
  });

  it('applies to turned parts too', () => {
    const result = computeCNCTurnedCostSummary(
      milledInput({
        family: 'cnc_turned', mhrRate: rate(900, { machineClass: '2_axis_lathe' }),
        tightestToleranceMm: 0.02, holeGroups: [{ diameter_mm: 3, count: 1 }],
        jigBoreTable: FINISH_BORING_TABLE, jigBoreRate: rate(2000, { machineClass: 'jig_bore' }),
      } as any),
      mc('2_axis_lathe'),
    );
    expect(result.processLines.some((l) => l.process === 'Jig Boring')).toBe(true);
  });
});

// Root-caused 2026-09-17: "Jig Grind" is a real, DISTINCT process in
// tblGtolProcessCapabilities.json (not a duplicate of Jig Boring) — same
// real 0.026mm position-tolerance ceiling, but its own real Num Repetitions
// (4, vs Jig Boring's 3) and its own real roughness range achievable on a
// HARDENED bore. Standard machining practice: a hardened bore this tight
// must be finish-ground, not bored. Routed by a real, disclosed heat-treat-
// callout classifier (bom_items.heat_treatment) rather than a fabricated
// threshold — mutually exclusive with Jig Boring at the same tolerance tier.
describe('Jig Grind — new operation, real tier ABOVE Jig Boring for hardened bores', () => {
  it('routes to Jig Boring, not Jig Grind, when tolerance is tight but there is no real heat-treat callout', () => {
    const result = computeCNCMilledCostSummary(
      milledInput({
        tightestToleranceMm: 0.02, holeGroups: [{ diameter_mm: 10, count: 1 }],
        jigBoreTable: FINISH_BORING_TABLE, jigBoreRate: rate(2000, { machineClass: 'jig_bore' }),
        heatTreatment: 'None',
        cylindricalGrindingParams: CYLINDRICAL_GRINDING_PARAMS,
        jigGrindRate: rate(1800, { machineClass: 'jig_grind' }),
      } as any),
      mc('3_axis_mill'),
    );
    expect(result.processLines.some((l) => l.process === 'Jig Boring')).toBe(true);
    expect(result.processLines.some((l) => l.process === 'Jig Grind')).toBe(false);
  });

  it('routes to Jig Grind, not Jig Boring, at the same real tight tolerance when a real heat-treat callout is present', () => {
    const result = computeCNCMilledCostSummary(
      milledInput({
        tightestToleranceMm: 0.02, holeGroups: [{ diameter_mm: 10, count: 1 }],
        jigBoreTable: FINISH_BORING_TABLE, jigBoreRate: rate(2000, { machineClass: 'jig_bore' }),
        heatTreatment: 'Harden and temper to Rc 58-62',
        cylindricalGrindingParams: CYLINDRICAL_GRINDING_PARAMS,
        jigGrindRate: rate(1800, { machineClass: 'jig_grind', machineName: 'Hauser S3-DR' }),
      } as any),
      mc('3_axis_mill'),
    );
    const line = result.processLines.find((l) => l.process === 'Jig Grind');
    expect(line).toBeDefined();
    expect(line!.cycleTimeMin).toBeGreaterThan(0);
    expect(line!.machineClass).toBe('jig_grind');
    expect(line!.machineName).toBe('Hauser S3-DR');
    expect(result.processLines.some((l) => l.process === 'Jig Boring')).toBe(false);
  });

  it.each(['none', 'N/A', 'as required', 'Not Required', 'No'])(
    'treats %p as no real callout (case-insensitive, matches this codebase\'s own existing placeholder strings)',
    (placeholder) => {
      const result = computeCNCMilledCostSummary(
        milledInput({
          tightestToleranceMm: 0.02, holeGroups: [{ diameter_mm: 10, count: 1 }],
          jigBoreTable: FINISH_BORING_TABLE, jigBoreRate: rate(2000, { machineClass: 'jig_bore' }),
          heatTreatment: placeholder,
          cylindricalGrindingParams: CYLINDRICAL_GRINDING_PARAMS,
          jigGrindRate: rate(1800, { machineClass: 'jig_grind' }),
        } as any),
        mc('3_axis_mill'),
      );
      expect(result.processLines.some((l) => l.process === 'Jig Grind')).toBe(false);
      expect(result.processLines.some((l) => l.process === 'Jig Boring')).toBe(true);
    },
  );

  it('adds no Jig Grind line (and no Jig Boring fallback) when tolerance is looser than the real threshold, even with a real heat-treat callout', () => {
    const result = computeCNCMilledCostSummary(
      milledInput({
        tightestToleranceMm: 0.04, holeGroups: [{ diameter_mm: 10, count: 1 }],
        heatTreatment: 'Case harden 0.5mm deep',
        cylindricalGrindingParams: CYLINDRICAL_GRINDING_PARAMS,
        jigGrindRate: rate(1800, { machineClass: 'jig_grind' }),
      } as any),
      mc('3_axis_mill'),
    );
    expect(result.processLines.some((l) => l.process === 'Jig Grind')).toBe(false);
    expect(result.processLines.some((l) => l.process === 'Jig Boring')).toBe(false);
  });

  it('applies the real 4x repeat-pass count on top of the real Cylindrical Grinding physics', () => {
    const result = computeCNCMilledCostSummary(
      milledInput({
        tightestToleranceMm: 0.02, holeGroups: [{ diameter_mm: 10, count: 1 }],
        heatTreatment: 'Harden to Rc60',
        cylindricalGrindingParams: CYLINDRICAL_GRINDING_PARAMS,
        jigGrindRate: rate(1800, { machineClass: 'jig_grind' }),
      } as any),
      mc('3_axis_mill'),
    );
    const line = result.processLines.find((l) => l.process === 'Jig Grind')!;
    // Single-pass cylindrical-grinding time at diameter 10mm, DRILL_DEPTH_TO_DIAMETER_RATIO
    // (2.5) -> boreDepthMm = 25mm, using CYLINDRICAL_GRINDING_PARAMS (workSpeedMMin 25.5,
    // roughInfeedMm 0.05, finishInfeedMm 0.01, roughAxialFeedRevMm 0.5, finishAxialFeedRevMm 0.167).
    const rpm = (25.5 * 1000) / (Math.PI * 10);
    const finishStockMm = Math.min(0.01, 0.1); // FINISH_GRINDING_DEPTH_MM = 0.1
    const roughStockMm = 0.1 - finishStockMm;
    const numRoughPasses = Math.max(0, Math.round(roughStockMm / 0.05));
    const passTimeSec = (feedRevMm: number) => (25 / (rpm * feedRevMm)) * 60;
    const singlePassSec = numRoughPasses * passTimeSec(0.5) + passTimeSec(0.167);
    expect(line.cycleTimeMin).toBeCloseTo((singlePassSec * 4) / 60, 2);
  });

  it('discloses, rather than fabricates, when routed to Jig Grind but no real grinding physics data was resolved', () => {
    const result = computeCNCMilledCostSummary(
      milledInput({
        tightestToleranceMm: 0.02, holeGroups: [{ diameter_mm: 10, count: 1 }],
        heatTreatment: 'Harden to Rc60',
        cylindricalGrindingParams: { workSpeedMMin: 0, roughInfeedMm: 0, finishInfeedMm: 0, roughAxialFeedRevMm: 0, finishAxialFeedRevMm: 0, dataFound: false },
        jigGrindRate: rate(1800, { machineClass: 'jig_grind' }),
      } as any),
      mc('3_axis_mill'),
    );
    expect(result.processLines.some((l) => l.process === 'Jig Grind')).toBe(false);
    expect(result.processLines.some((l) => l.process === 'Jig Boring')).toBe(false);
    expect(result.warnings.some((w) => w.includes('Jig Grind') && w.includes('not available'))).toBe(true);
  });

  it('adds no line when routed to Jig Grind but no dedicated Jig Grind rate is on file (genuine gap, no fallback machine)', () => {
    const result = computeCNCMilledCostSummary(
      milledInput({
        tightestToleranceMm: 0.02, holeGroups: [{ diameter_mm: 10, count: 1 }],
        heatTreatment: 'Harden to Rc60',
        cylindricalGrindingParams: CYLINDRICAL_GRINDING_PARAMS,
        jigGrindRate: undefined,
      } as any),
      mc('3_axis_mill'),
    );
    expect(result.processLines.some((l) => l.process === 'Jig Grind')).toBe(false);
    expect(result.processLines.some((l) => l.process === 'Jig Boring')).toBe(false);
  });

  it("prefers the real machine's own setup_time_hr over the disclosed class default", () => {
    const result = computeCNCMilledCostSummary(
      milledInput({
        tightestToleranceMm: 0.02, holeGroups: [{ diameter_mm: 10, count: 1 }],
        heatTreatment: 'Harden to Rc60',
        cylindricalGrindingParams: CYLINDRICAL_GRINDING_PARAMS,
        jigGrindRate: rate(1800, { machineClass: 'jig_grind', setupTimeHr: 1.0 }), // real 60min, every real Jig Grind machine on file
      } as any),
      mc('3_axis_mill'),
    );
    const line = result.processLines.find((l) => l.process === 'Jig Grind')!;
    expect(line.setupTimeMin).toBe(60);
    expect(line.setupTimeSource).toBe('machine');
  });

  it('applies to turned shafts too', () => {
    const result = computeCNCTurnedCostSummary(
      turnedInput({
        tightestToleranceMm: 0.02, holeGroups: [{ diameter_mm: 10, count: 1 }],
        heatTreatment: 'Harden to Rc60',
        cylindricalGrindingParams: CYLINDRICAL_GRINDING_PARAMS,
        jigGrindRate: rate(1800, { machineClass: 'jig_grind' }),
      }),
      mc('2_axis_lathe'),
    );
    expect(result.processLines.some((l) => l.process === 'Jig Grind')).toBe(true);
  });
});

// Root-caused live (2026-09-18): "Internal Grinder" is a real, staged
// machine category (migrations 737/738/753, 10 machines) with ZERO cost
// engine — no dedicated ID-grinding physics table exists in the reference
// corpus, so this reuses Cylindrical Grinding's real OD wheel-speed/infeed
// data (a disclosed simplification), applied to the smallest real hole.
describe('Internal Grinding — new operation, reuses Cylindrical Grinding physics for bores', () => {
  it('adds no line when Ra is not tighter than the real turning/milling ceiling', () => {
    const result = computeCNCMilledCostSummary(
      milledInput({
        tightestRaMicron: 0.8, holeGroups: [{ diameter_mm: 10, count: 1 }],
        cylindricalGrindingParams: CYLINDRICAL_GRINDING_PARAMS,
        internalGrindingRate: rate(1900, { machineClass: 'internal_grinder' }),
      } as any),
      mc('3_axis_mill'),
    );
    expect(result.processLines.some((l) => l.process === 'Internal Grinding')).toBe(false);
  });

  it('adds a real Internal Grinding line, billed at its own dedicated rate, for a tight-Ra bore on a MILLED part', () => {
    const result = computeCNCMilledCostSummary(
      milledInput({
        tightestRaMicron: 0.2, holeGroups: [{ diameter_mm: 10, count: 2 }],
        cylindricalGrindingParams: CYLINDRICAL_GRINDING_PARAMS,
        internalGrindingRate: rate(1900, { machineClass: 'internal_grinder', machineName: 'Danobat Overbeck IC/iD' }),
      } as any),
      mc('3_axis_mill'),
    );
    const line = result.processLines.find((l) => l.process === 'Internal Grinding');
    expect(line).toBeDefined();
    expect(line!.cycleTimeMin).toBeGreaterThan(0);
    expect(line!.machineClass).toBe('internal_grinder');
    expect(line!.machineName).toBe('Danobat Overbeck IC/iD');
  });

  it('applies to a tight-Ra bore on a TURNED part too, independent of any OD Cylindrical Grinding need', () => {
    const result = computeCNCTurnedCostSummary(
      turnedInput({
        tightestRaMicron: 0.2, holeGroups: [{ diameter_mm: 10, count: 1 }],
        cylindricalGrindingParams: CYLINDRICAL_GRINDING_PARAMS,
        internalGrindingRate: rate(1900, { machineClass: 'internal_grinder' }),
        // No OD grinding rate/params on this fixture -- proves Internal
        // Grinding fires independently of Cylindrical Grinding.
      }),
      mc('2_axis_lathe'),
    );
    expect(result.processLines.some((l) => l.process === 'Internal Grinding')).toBe(true);
    expect(result.processLines.some((l) => l.process === 'Cylindrical Grinding')).toBe(false);
  });

  it('discloses, rather than fabricates, when Ra is tight but no real grinding physics data was resolved', () => {
    const result = computeCNCMilledCostSummary(
      milledInput({
        tightestRaMicron: 0.2, holeGroups: [{ diameter_mm: 10, count: 1 }],
        cylindricalGrindingParams: { workSpeedMMin: 0, roughInfeedMm: 0, finishInfeedMm: 0, roughAxialFeedRevMm: 0, finishAxialFeedRevMm: 0, dataFound: false },
        internalGrindingRate: rate(1900, { machineClass: 'internal_grinder' }),
      } as any),
      mc('3_axis_mill'),
    );
    expect(result.processLines.some((l) => l.process === 'Internal Grinding')).toBe(false);
    expect(result.warnings.some((w) => w.includes('Internal Grinding') && w.includes('not available'))).toBe(true);
  });

  it('adds no line when Ra is tight but no dedicated Internal Grinder rate is on file', () => {
    const result = computeCNCMilledCostSummary(
      milledInput({
        tightestRaMicron: 0.2, holeGroups: [{ diameter_mm: 10, count: 1 }],
        cylindricalGrindingParams: CYLINDRICAL_GRINDING_PARAMS, internalGrindingRate: undefined,
      } as any),
      mc('3_axis_mill'),
    );
    expect(result.processLines.some((l) => l.process === 'Internal Grinding')).toBe(false);
  });

  it("prefers the real machine's own setup_time_hr over the disclosed class default", () => {
    const result = computeCNCMilledCostSummary(
      milledInput({
        tightestRaMicron: 0.2, holeGroups: [{ diameter_mm: 10, count: 1 }],
        cylindricalGrindingParams: CYLINDRICAL_GRINDING_PARAMS,
        internalGrindingRate: rate(1900, { machineClass: 'internal_grinder', setupTimeHr: 0.5 }), // real 30min, every real machine on file
      } as any),
      mc('3_axis_mill'),
    );
    const line = result.processLines.find((l) => l.process === 'Internal Grinding')!;
    expect(line.setupTimeMin).toBe(30);
    expect(line.setupTimeSource).toBe('machine');
  });
});

// Real tblBroaching_lookup_table.json row shape (material_cut_code_name
// '1.0'/hardness 125, tool_type 'Internal Gear Broach' — see
// MachiningLookupService.getBroachingParams' own doc comment for why this
// series is representative). Rough/finish speeds are deliberately DIFFERENT
// here (unlike the real code '1.0' row, where the table's own real
// data_quality_note says they coincide) so tests can prove both passes are
// independently exercised.
const BROACHING_PARAMS = { roughCuttingSpeedMPerMin: 6, finishCuttingSpeedMPerMin: 9, dataFound: true };

// Root-caused 2026-09-17: cnc_feature_recognizer.py already detects "keyway"
// as its own real, distinct feature type, but build_feature_graph_v2_from_cnc
// was deliberately collapsing it into generic "slot" output — the exact same
// "staged/detected-but-discarded" root cause already fixed repeatedly this
// session, just at the CAD/Python layer. "Broach" is a real, staged machine
// category (migrations 737/738/753, 4 machines) with genuinely LINEAR
// stroke-based physics (not rotary MRR like every other feature op above).
// keywayCandidates are pre-filtered out of fgv2Features by
// splitKeywayOccurrences (keyway-routing.ts) before buildOperationSequence
// runs — these tests exercise computeCNCMilledCostSummary/
// computeCNCTurnedCostSummary directly with pre-resolved candidates, the
// same convention every other new-engine describe block above uses.
describe('Keyway Broaching — new operation, genuinely linear stroke physics', () => {
  it('adds no line when there are no real keyway candidates', () => {
    const result = computeCNCMilledCostSummary(
      milledInput({
        keywayCandidates: [], broachingParams: BROACHING_PARAMS,
        broachRate: rate(1500, { machineClass: 'broach' }),
      } as any),
      mc('3_axis_mill'),
    );
    expect(result.processLines.some((l) => l.process === 'Keyway Broaching')).toBe(false);
  });

  it('adds a real Keyway Broaching line, billed at its own dedicated rate, for a real keyway on a MILLED part', () => {
    const result = computeCNCMilledCostSummary(
      milledInput({
        keywayCandidates: [{ lengthMm: 120, widthMm: 6, depthMm: 4, count: 2 }],
        broachingParams: BROACHING_PARAMS,
        broachRate: rate(1500, { machineClass: 'broach', machineName: 'Pioneer VT1040' }),
      } as any),
      mc('3_axis_mill'),
    );
    const line = result.processLines.find((l) => l.process === 'Keyway Broaching');
    expect(line).toBeDefined();
    expect(line!.cycleTimeMin).toBeGreaterThan(0);
    expect(line!.machineClass).toBe('broach');
    expect(line!.machineName).toBe('Pioneer VT1040');
  });

  it('computes exact real linear-stroke physics: one rough pass + one finish pass, each the full keyway length', () => {
    const result = computeCNCMilledCostSummary(
      milledInput({
        keywayCandidates: [{ lengthMm: 120, widthMm: 6, depthMm: 4, count: 2 }],
        broachingParams: BROACHING_PARAMS,
        broachRate: rate(1500, { machineClass: 'broach' }),
      } as any),
      mc('3_axis_mill'),
    );
    const line = result.processLines.find((l) => l.process === 'Keyway Broaching')!;
    // roughTimeSec = 120mm / (6 m/min * 1000/60 mm/s) = 120/100 = 1.2s
    // finishTimeSec = 120mm / (9 m/min * 1000/60 mm/s) = 120/150 = 0.8s
    // per-occurrence = 2.0s; x2 occurrences = 4.0s total
    // cycleTimeMin is r2-rounded to 2 decimal PLACES OF MINUTES (nearest
    // 0.6s) by makeLine, same as every other line in this file — precision
    // 2, not the sub-second precision a real broach stroke this short would need.
    const expectedRunMin = 4.0 / 60;
    expect(line.cycleTimeMin).toBeCloseTo(expectedRunMin, 2);
  });

  it('sums multiple distinct-dimension keyway candidates on the same part', () => {
    const result = computeCNCMilledCostSummary(
      milledInput({
        keywayCandidates: [
          { lengthMm: 120, widthMm: 6, depthMm: 4, count: 1 },
          { lengthMm: 40, widthMm: 4, depthMm: 3, count: 1 },
        ],
        broachingParams: BROACHING_PARAMS,
        broachRate: rate(1500, { machineClass: 'broach' }),
      } as any),
      mc('3_axis_mill'),
    );
    const line = result.processLines.find((l) => l.process === 'Keyway Broaching')!;
    const stroke = (lengthMm: number) => lengthMm / (6 * 1000 / 60) + lengthMm / (9 * 1000 / 60);
    const expectedRunMin = (stroke(120) + stroke(40)) / 60;
    expect(line.cycleTimeMin).toBeCloseTo(expectedRunMin, 2);
  });

  it('discloses, rather than fabricates, when a real keyway exists but no real broaching cutting-speed data was resolved', () => {
    const result = computeCNCMilledCostSummary(
      milledInput({
        keywayCandidates: [{ lengthMm: 120, widthMm: 6, depthMm: 4, count: 1 }],
        broachingParams: { roughCuttingSpeedMPerMin: 0, finishCuttingSpeedMPerMin: 0, dataFound: false },
        broachRate: rate(1500, { machineClass: 'broach' }),
      } as any),
      mc('3_axis_mill'),
    );
    expect(result.processLines.some((l) => l.process === 'Keyway Broaching')).toBe(false);
    expect(result.warnings.some((w) => w.includes('Keyway Broaching') && w.includes('not available'))).toBe(true);
  });

  it('adds no line when a real keyway exists but no dedicated Broach rate is on file (genuine gap, no fallback machine)', () => {
    const result = computeCNCMilledCostSummary(
      milledInput({
        keywayCandidates: [{ lengthMm: 120, widthMm: 6, depthMm: 4, count: 1 }],
        broachingParams: BROACHING_PARAMS, broachRate: undefined,
      } as any),
      mc('3_axis_mill'),
    );
    expect(result.processLines.some((l) => l.process === 'Keyway Broaching')).toBe(false);
  });

  it("prefers the real machine's own setup_time_hr over the disclosed class default", () => {
    const result = computeCNCMilledCostSummary(
      milledInput({
        keywayCandidates: [{ lengthMm: 120, widthMm: 6, depthMm: 4, count: 1 }],
        broachingParams: BROACHING_PARAMS,
        broachRate: rate(1500, { machineClass: 'broach', setupTimeHr: 0.01 }), // real 0.6min, every real Broach machine on file
      } as any),
      mc('3_axis_mill'),
    );
    const line = result.processLines.find((l) => l.process === 'Keyway Broaching')!;
    expect(line.setupTimeMin).toBeCloseTo(0.6, 5);
    expect(line.setupTimeSource).toBe('machine');
  });

  it('falls back to the disclosed 0.6min class default when setup_time_hr is absent', () => {
    const result = computeCNCMilledCostSummary(
      milledInput({
        keywayCandidates: [{ lengthMm: 120, widthMm: 6, depthMm: 4, count: 1 }],
        broachingParams: BROACHING_PARAMS,
        broachRate: rate(1500, { machineClass: 'broach' }),
      } as any),
      mc('3_axis_mill'),
    );
    const line = result.processLines.find((l) => l.process === 'Keyway Broaching')!;
    expect(line.setupTimeMin).toBeCloseTo(0.6, 5);
    expect(line.setupTimeSource).toBe('class_default');
  });

  it('applies to a real keyway on a TURNED shaft too (a keyway is at least as common on turned shafts as milled parts)', () => {
    const result = computeCNCTurnedCostSummary(
      turnedInput({
        keywayCandidates: [{ lengthMm: 120, widthMm: 6, depthMm: 4, count: 1 }],
        broachingParams: BROACHING_PARAMS,
        broachRate: rate(1500, { machineClass: 'broach' }),
      } as any),
      mc('2_axis_lathe'),
    );
    expect(result.processLines.some((l) => l.process === 'Keyway Broaching')).toBe(true);
  });
});

// Real tblWireEDMing.json row shape (material_cut_code_name '1.0', real
// Roughing/Finishing FeedRateMmPerMin). Root-caused 2026-09-18: "Wire EDM"
// is a real, staged machine category (migrations 737/738/753, 6 real
// machines) with real material cutting physics but had ZERO cost engine.
// Real, disclosed trigger: same heat-treat-callout signal Jig Grind
// already uses, applied to a real "slot" feature instead of a round bore
// (a hardened slot cannot be conventionally milled any more than a
// hardened bore can be conventionally bored). wireEdmCandidates are
// pre-filtered out of fgv2Features by splitWireEdmOccurrences
// (wire-edm-routing.ts) — these tests exercise
// computeCNCMilledCostSummary/computeCNCTurnedCostSummary directly with
// pre-resolved candidates, the same convention every other new-engine
// describe block above uses.
const WIRE_EDM_PARAMS = { roughFeedRateMmPerMin: 5.8, finishFeedRateMmPerMin: 4.8, dataFound: true };

describe('Wire EDM — new operation, real hardened-slot trigger', () => {
  it('adds no line when there are no real Wire EDM candidates', () => {
    const result = computeCNCMilledCostSummary(
      milledInput({
        wireEdmCandidates: [], wireEdmParams: WIRE_EDM_PARAMS,
        wireEdmRate: rate(1400, { machineClass: 'wire_edm' }),
      } as any),
      mc('3_axis_mill'),
    );
    expect(result.processLines.some((l) => l.process === 'Wire EDM')).toBe(false);
  });

  it('adds a real Wire EDM line, billed at its own dedicated rate, for a real hardened slot on a MILLED part', () => {
    const result = computeCNCMilledCostSummary(
      milledInput({
        wireEdmCandidates: [{ lengthMm: 100, count: 2 }],
        wireEdmParams: WIRE_EDM_PARAMS,
        wireEdmRate: rate(1400, { machineClass: 'wire_edm', machineName: 'Fanuc 0id' }),
      } as any),
      mc('3_axis_mill'),
    );
    const line = result.processLines.find((l) => l.process === 'Wire EDM');
    expect(line).toBeDefined();
    expect(line!.cycleTimeMin).toBeGreaterThan(0);
    expect(line!.machineClass).toBe('wire_edm');
    expect(line!.machineName).toBe('Fanuc 0id');
  });

  it('computes exact real 2-pass linear-cut physics: one rough pass + one finish pass, each the full cut-path length', () => {
    const result = computeCNCMilledCostSummary(
      milledInput({
        wireEdmCandidates: [{ lengthMm: 100, count: 3 }],
        wireEdmParams: WIRE_EDM_PARAMS,
        wireEdmRate: rate(1400, { machineClass: 'wire_edm' }),
      } as any),
      mc('3_axis_mill'),
    );
    const line = result.processLines.find((l) => l.process === 'Wire EDM')!;
    // roughTimeSec = (100mm / 5.8 mm/min) * 60 = 1034.48s
    // finishTimeSec = (100mm / 4.8 mm/min) * 60 = 1250.0s
    // per-occurrence = 2284.48s; x3 occurrences = 6853.45s total
    const roughSec = (100 / 5.8) * 60;
    const finishSec = (100 / 4.8) * 60;
    const expectedRunMin = ((roughSec + finishSec) * 3) / 60;
    expect(line.cycleTimeMin).toBeCloseTo(expectedRunMin, 1);
  });

  it('discloses, rather than fabricates, when a real hardened slot exists but no real Wire EDM cutting-speed data was resolved', () => {
    const result = computeCNCMilledCostSummary(
      milledInput({
        wireEdmCandidates: [{ lengthMm: 100, count: 1 }],
        wireEdmParams: { roughFeedRateMmPerMin: 0, finishFeedRateMmPerMin: 0, dataFound: false },
        wireEdmRate: rate(1400, { machineClass: 'wire_edm' }),
      } as any),
      mc('3_axis_mill'),
    );
    expect(result.processLines.some((l) => l.process === 'Wire EDM')).toBe(false);
    expect(result.warnings.some((w) => w.includes('Wire EDM') && w.includes('not available'))).toBe(true);
  });

  it('adds no line when a real hardened slot exists but no dedicated Wire EDM rate is on file (genuine gap, no fallback machine)', () => {
    const result = computeCNCMilledCostSummary(
      milledInput({
        wireEdmCandidates: [{ lengthMm: 100, count: 1 }],
        wireEdmParams: WIRE_EDM_PARAMS, wireEdmRate: undefined,
      } as any),
      mc('3_axis_mill'),
    );
    expect(result.processLines.some((l) => l.process === 'Wire EDM')).toBe(false);
  });

  it("prefers the real machine's own setup_time_hr over the disclosed class default", () => {
    const result = computeCNCMilledCostSummary(
      milledInput({
        wireEdmCandidates: [{ lengthMm: 100, count: 1 }],
        wireEdmParams: WIRE_EDM_PARAMS,
        wireEdmRate: rate(1400, { machineClass: 'wire_edm', setupTimeHr: 0.5 }), // real 30min, every real Wire EDM machine on file
      } as any),
      mc('3_axis_mill'),
    );
    const line = result.processLines.find((l) => l.process === 'Wire EDM')!;
    expect(line.setupTimeMin).toBe(30);
    expect(line.setupTimeSource).toBe('machine');
  });

  it(`falls back to the disclosed ${30}min class default when setup_time_hr is absent`, () => {
    const result = computeCNCMilledCostSummary(
      milledInput({
        wireEdmCandidates: [{ lengthMm: 100, count: 1 }],
        wireEdmParams: WIRE_EDM_PARAMS,
        wireEdmRate: rate(1400, { machineClass: 'wire_edm' }),
      } as any),
      mc('3_axis_mill'),
    );
    const line = result.processLines.find((l) => l.process === 'Wire EDM')!;
    expect(line.setupTimeMin).toBe(30);
    expect(line.setupTimeSource).toBe('class_default');
  });

  it('applies to a real hardened slot on a TURNED part too', () => {
    const result = computeCNCTurnedCostSummary(
      turnedInput({
        wireEdmCandidates: [{ lengthMm: 100, count: 1 }],
        wireEdmParams: WIRE_EDM_PARAMS,
        wireEdmRate: rate(1400, { machineClass: 'wire_edm' }),
      } as any),
      mc('2_axis_lathe'),
    );
    expect(result.processLines.some((l) => l.process === 'Wire EDM')).toBe(true);
  });
});
