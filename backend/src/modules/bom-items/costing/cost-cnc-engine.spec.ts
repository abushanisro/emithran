import {
  computeCNCMilledCostSummary,
  computeCNCTurnedCostSummary,
  computeInspectionMin,
  computeSurfaceTreatmentLine,
  localizeFixtureCost,
  requiredMilledMachineClass,
  meetsRequiredMilledClass,
  pickRecommendedRoute,
  type CNCCostInput,
} from './cost-cnc-engine';
import {
  benchmarkRateWarning,
  classifySurfaceTreatment,
  CMM_SETUP_MIN,
  CNC_STOCK_ALLOWANCE_PER_SIDE_MM,
  LOCATION_MHR_DEFAULTS,
} from './default-rates';
import type { MHRRateInput } from './cost-engine';
import {
  shapeRankForFamily,
  isDiscouragedShapeForFamily,
} from '../../raw-materials/constants/material-shape-ranking';

function rate(value: number, overrides: Partial<MHRRateInput> = {}): MHRRateInput {
  return {
    rate: value,
    source: 'mhr_database',
    machineClass: 'cnc_3ax_vmc',
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

describe('localizeFixtureCost', () => {
  it('is the INR benchmark in India (identity)', () => {
    expect(localizeFixtureCost('cnc_3ax_vmc', 'India')).toBe(500);
    expect(localizeFixtureCost('cnc_5ax_mc', 'India')).toBe(2000);
  });

  it('scales by the location machine-rate ratio, not raw FX-less reuse', () => {
    // USA 3ax benchmark $85 vs India ₹900 → 500 × 85/900 ≈ $47.2
    const usa = localizeFixtureCost('cnc_3ax_vmc', 'USA');
    expect(usa).toBeCloseTo(500 * (85 / 900), 5);
    // The defect this replaces: fixture showing the SAME digit in every currency
    expect(usa).not.toBe(500);
  });

  it('falls back to the India benchmark for unknown locations', () => {
    expect(localizeFixtureCost('cnc_3ax_vmc', 'Atlantis')).toBe(500);
  });
});

describe('computeCNCMilledCostSummary — billet and chip loss', () => {
  it('adds stock allowance per side to the billet', () => {
    const result = computeCNCMilledCostSummary(milledInput(), 'cnc_3ax_vmc');
    const allow = 2 * CNC_STOCK_ALLOWANCE_PER_SIDE_MM;
    const expectedVol = (83 + allow) * (62 + allow) * (32 + allow);
    expect(result.materialRemoval!.billetWeightKg).toBeCloseTo((expectedVol / 1e9) * 2700, 3);
  });

  it('clamps utilization at 100% and warns when CAD volume exceeds the billet', () => {
    // Impossible data: part heavier than any billet the bbox can supply
    const result = computeCNCMilledCostSummary(
      milledInput({ finishedWeightKg: 5.0 }),
      'cnc_3ax_vmc',
    );
    expect(result.materialRemoval!.utilizationPct).toBeLessThanOrEqual(100);
    expect(result.materialRemoval!.chipScrapPct).toBeGreaterThanOrEqual(0);
  });

  it('warns on inconsistent CAD volume (volume > billet)', () => {
    const result = computeCNCMilledCostSummary(
      milledInput({ volume: 999_999_999 }),
      'cnc_3ax_vmc',
    );
    expect(result.warnings.some((w) => w.includes('volume exceeds'))).toBe(true);
  });

  it('warns when chip loss exceeds 65%', () => {
    const result = computeCNCMilledCostSummary(
      milledInput({ finishedWeightKg: 0.05 }),
      'cnc_3ax_vmc',
    );
    expect(result.materialRemoval!.chipScrapPct).toBeGreaterThan(65);
    expect(result.warnings.some((w) => w.includes('Chip loss'))).toBe(true);
  });

  it('prices the fixture in local terms per location', () => {
    const india = computeCNCMilledCostSummary(milledInput({ location: 'India' }), 'cnc_3ax_vmc');
    const usa = computeCNCMilledCostSummary(milledInput({ location: 'USA' }), 'cnc_3ax_vmc');
    const fixtureOf = (r: typeof india) => r.processLines.find((l) => l.process === 'Fixture')!.totalCost;
    expect(fixtureOf(india)).toBeCloseTo(500 / 60, 2);
    expect(fixtureOf(usa)).toBeCloseTo((500 * (85 / 900)) / 60, 2);
  });

  it('prices the tapping line at the machine rate it was given (rigid tapping inheritance)', () => {
    const result = computeCNCMilledCostSummary(
      milledInput({ tappingRate: rate(900, { machineClass: 'tapping', machineName: 'Makino V56i' }) }),
      'cnc_3ax_vmc',
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
    const result = computeCNCMilledCostSummary(milledInput({ batchSize: 1 }), 'cnc_3ax_vmc');
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
    const result = computeCNCMilledCostSummary(milledInput({ batchSize: 60 }), 'cnc_3ax_vmc');
    const insp = result.processLines.find((l) => l.process === 'Inspection')!;
    expect(insp.runCost).toBeCloseTo(((measuredMin / 60) * 450) / 60, 2);
    expect(insp.setupCost).toBeCloseTo(((CMM_SETUP_MIN / 60) * 450) / 60, 2);
    expect(insp.cycleTimeMin).toBeCloseTo(measuredMin / 60, 2);
  });

  it('honors a per-item samplingPerN override (1 = full measurement on every part)', () => {
    const result = computeCNCMilledCostSummary(
      milledInput({ batchSize: 60, samplingPerN: 1 }),
      'cnc_3ax_vmc',
    );
    const insp = result.processLines.find((l) => l.process === 'Inspection')!;
    // FAI 1 + in-process 59 = every part fully measured, + 3 final checks
    const measuredMin = PER_PIECE_MIN * 60 + 2 * 3;
    expect(insp.runCost).toBeCloseTo(((measuredMin / 60) * 450) / 60, 2);
  });

  it('emits the inspection line on turned parts too', () => {
    const result = computeCNCTurnedCostSummary(
      milledInput({ family: 'cnc_turned' }),
      'cnc_lathe',
    );
    expect(result.processLines.some((l) => l.process === 'Inspection')).toBe(true);
  });

  it('applies a named quality plan (full_cmm: every part measured)', () => {
    const result = computeCNCMilledCostSummary(
      milledInput({
        batchSize: 60,
        samplingPolicy: { fai: true, inProcessPerN: 1, finalPerN: 1, finalCheckMin: 2 },
      }),
      'cnc_3ax_vmc',
    );
    const insp = result.processLines.find((l) => l.process === 'Inspection')!;
    // FAI 1 + in-process 59 = 60 full measurements + 60 final checks
    const measuredMin = PER_PIECE_MIN * 60 + 2 * 60;
    expect(insp.runCost).toBeCloseTo(((measuredMin / 60) * 450) / 60, 2);
  });

  it('applies an AS9100-style plan (5% in-process sampling) more cheaply than general', () => {
    const general = computeCNCMilledCostSummary(milledInput({ batchSize: 100 }), 'cnc_3ax_vmc');
    const as9100 = computeCNCMilledCostSummary(
      milledInput({
        batchSize: 100,
        samplingPolicy: { fai: true, inProcessPerN: 20, finalPerN: 25, finalCheckMin: 3 },
      }),
      'cnc_3ax_vmc',
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
});

describe('surface treatment line — anodize/plating pricing', () => {
  it('classifies drawing callouts to rate keys', () => {
    expect(classifySurfaceTreatment('Type III Hardcoat Black Anodize')).toBe('anodize_type_iii');
    expect(classifySurfaceTreatment('Black Anodize per MIL-A-8625')).toBe('anodize_type_ii');
    expect(classifySurfaceTreatment('Zinc plated')).toBe('zinc_plate');
    expect(classifySurfaceTreatment('None')).toBeNull();
    expect(classifySurfaceTreatment(null)).toBeNull();
  });

  it('prices by area when area cost beats the amortized minimum lot charge', () => {
    // 0.04 m² × ₹700/m² = ₹28 vs min-lot ₹1500/60 = ₹25 → area wins
    const result = computeCNCMilledCostSummary(
      milledInput({ surfaceTreatment: 'Type III Hardcoat Black Anodize', batchSize: 60 }),
      'cnc_3ax_vmc',
    );
    const st = result.processLines.find((l) => l.process.startsWith('Surface Treatment'))!;
    expect(st.process).toContain('Hardcoat Anodize Type III');
    expect(st.totalCost).toBeCloseTo(0.04 * 700, 2);
  });

  it('charges the amortized minimum lot at small batches', () => {
    // min-lot ₹1500/5 = ₹300 > area ₹28
    const result = computeCNCMilledCostSummary(
      milledInput({ surfaceTreatment: 'Type III Hardcoat', batchSize: 5 }),
      'cnc_3ax_vmc',
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

  it('localizes treatment via the labour-rate ratio, not raw digit reuse', () => {
    const warnings: string[] = [];
    const india = computeSurfaceTreatmentLine('anodize', 40_000, 5, 'India', warnings)!;
    const usa = computeSurfaceTreatmentLine('anodize', 40_000, 5, 'USA', warnings)!;
    // USA deburr benchmark $30 vs India ₹300 → ratio 0.1
    expect(usa.totalCost).toBeCloseTo(india.totalCost * (30 / 300), 2);
  });

  it('adds no surface treatment line when the part has no callout', () => {
    const result = computeCNCMilledCostSummary(milledInput(), 'cnc_3ax_vmc');
    expect(result.processLines.some((l) => l.process.startsWith('Surface Treatment'))).toBe(false);
  });
});

describe('computeCNCTurnedCostSummary — data sanity', () => {
  it('still flags sheet/plate material grades on turned parts', () => {
    const result = computeCNCTurnedCostSummary(
      milledInput({ family: 'cnc_turned', materialGrade: '6061-T6 Sheet' }),
      'cnc_lathe',
    );
    expect(result.warnings.some((w) => w.includes('sheet/plate'))).toBe(true);
  });
});

describe('requiredMilledMachineClass', () => {
  it('maps difficulty and pockets to the minimum class', () => {
    expect(requiredMilledMachineClass('medium', 4)).toBe('cnc_3ax_vmc');
    expect(requiredMilledMachineClass('hard', 4)).toBe('cnc_4ax_vmc');
    expect(requiredMilledMachineClass('medium', 13)).toBe('cnc_4ax_vmc');
    expect(requiredMilledMachineClass('very_hard', 0)).toBe('cnc_5ax_mc');
    expect(requiredMilledMachineClass(null, 26)).toBe('cnc_5ax_mc');
  });

  it('gates lower classes and passes higher ones', () => {
    expect(meetsRequiredMilledClass('cnc_3ax_vmc', 'cnc_4ax_vmc')).toBe(false);
    expect(meetsRequiredMilledClass('cnc_5ax_mc', 'cnc_4ax_vmc')).toBe(true);
    // Lathe classes are not gated by the milled hierarchy
    expect(meetsRequiredMilledClass('cnc_lathe', 'cnc_5ax_mc')).toBe(true);
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
    const warning = benchmarkRateWarning('cnc_5ax_mc', 'China', 160, 'Makino D300');
    expect(warning).toContain('Makino D300');
    expect(warning).toContain('below');
  });

  it('flags an implausibly high rate', () => {
    const warning = benchmarkRateWarning('cnc_3ax_vmc', 'USA', 900, 'Mystery VMC');
    expect(warning).toContain('over');
  });

  it('stays silent inside the plausible band and for unknown locations/classes', () => {
    expect(benchmarkRateWarning('cnc_3ax_vmc', 'USA', 85, 'Haas VF-2')).toBeNull();
    expect(benchmarkRateWarning('cnc_3ax_vmc', 'Atlantis', 85, 'Haas VF-2')).toBeNull();
    expect(benchmarkRateWarning('unknown_class', 'USA', 85, 'Haas VF-2')).toBeNull();
  });
});

describe('LOCATION_MHR_DEFAULTS coherence', () => {
  const classes = Object.keys(LOCATION_MHR_DEFAULTS['India']) as Array<
    keyof (typeof LOCATION_MHR_DEFAULTS)['India']
  >;

  it('keeps Germany above France with W. Europe between them (EUR locations)', () => {
    for (const cls of classes) {
      const de = LOCATION_MHR_DEFAULTS['Germany'][cls];
      const fr = LOCATION_MHR_DEFAULTS['France'][cls];
      const we = LOCATION_MHR_DEFAULTS['W. Europe'][cls];
      expect(de).toBeGreaterThan(fr);
      expect(we).toBeGreaterThanOrEqual(fr);
      expect(we).toBeLessThanOrEqual(de);
    }
  });

  it('keeps E. Europe below W. Europe but out of the pre-2015 absurd range', () => {
    for (const cls of classes) {
      expect(LOCATION_MHR_DEFAULTS['E. Europe'][cls]).toBeLessThan(
        LOCATION_MHR_DEFAULTS['W. Europe'][cls],
      );
    }
    // The old seed had 3ax VMC at €20/hr — below any EU electricity+labour floor
    expect(LOCATION_MHR_DEFAULTS['E. Europe'].cnc_3ax_vmc).toBeGreaterThanOrEqual(35);
  });

  it('keeps USA VMC rates inside the 2026 market band', () => {
    expect(LOCATION_MHR_DEFAULTS['USA'].cnc_3ax_vmc).toBeGreaterThanOrEqual(65);
    expect(LOCATION_MHR_DEFAULTS['USA'].cnc_3ax_vmc).toBeLessThanOrEqual(100);
    expect(LOCATION_MHR_DEFAULTS['USA'].cnc_5ax_mc).toBeGreaterThanOrEqual(120);
    expect(LOCATION_MHR_DEFAULTS['USA'].cnc_5ax_mc).toBeLessThanOrEqual(180);
  });

  it('keeps China VMC rates above the $22/hr impossibility line', () => {
    // ¥300 ≈ $41, ¥580 ≈ $80 at ~7.25 CNY/USD — inside the $35-60 / $60-120 bands
    expect(LOCATION_MHR_DEFAULTS['China'].cnc_3ax_vmc / 7.25).toBeGreaterThanOrEqual(35);
    expect(LOCATION_MHR_DEFAULTS['China'].cnc_5ax_mc / 7.25).toBeGreaterThanOrEqual(60);
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
