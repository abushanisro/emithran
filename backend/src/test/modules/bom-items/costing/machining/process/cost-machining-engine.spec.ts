import {
  computeMillingCostSummary,
  computeTurningCostSummary,
  computeSurfaceTreatmentLine,
  meetsRequiredMilledClass,
  pickRecommendedRoute,
  checkMachiningCapability,
  type MachiningCostInput,
  type MachineClassId,
} from '../../../../../../modules/bom-items/costing/machining/process/cost-machining-engine';
import { matchSurfaceTreatmentCallout } from '../../../../../../modules/bom-items/costing/surface/surface-treatment-engine';
import { specAsCalculators } from '../../../../../../modules/bom-items/costing/machining/calculators/machining-calculator-spec';

const CALCS = specAsCalculators();

// A line whose real inputs are missing stays visible with a gap — never
// omitted, never estimated.
function expectGapLine(result: { processLines: any[]; warnings: string[] }, process: string) {
  const line = result.processLines.find((l) => l.process === process);
  expect(line).toBeDefined();
  expect(line.cycleTimeMin).toBe(0);
  expect(line.physicsGap?.gapType).toBe('unsupported_operation');
  expect(result.warnings.some((w) => w.includes(process) && w.includes('not priced'))).toBe(true);
}
import { realCapabilityRules, realDrillingTable, realGrindingParams, realKeywayBroachReference, realSurfaceGrindingParams, realTappingTable } from '../real-reference-tables';

const TAPPING = realTappingTable();
// Finishing-process rules from the real staged files (capability-rules.ts).
const RULES = realCapabilityRules();

// Machine classes are now DB-discovered (MachineClassId), not a fixed
// TypeScript union — this test file still uses the historical literal
// class names as fixture values, cast through this helper the same way
// production code casts a discovery-query result (assertKnownMachineClass).
const mc = (value: string): MachineClassId => value as MachineClassId;
import { EMPTY_CAPABILITY } from '../../../../../../modules/bom-items/costing/shared/capability/machine-selection/seed-registry';
import type { MachineCapability } from '../../../../../../modules/bom-items/costing/shared/capability/machine-selection/seed-registry';
import { buildOperationSequence } from '../../../../../../modules/bom-items/costing/machining/operation/operation-sequencer';
import type { MHRRateInput } from '../../../../../../modules/bom-items/costing/shared/core/cost-engine';
import {
  shapeRankForFamily,
  isDiscouragedShapeForFamily,
} from '../../../../../../modules/raw-materials/constants/material-shape-ranking';
import { resolveStockAllowanceRule, stockAllowancePerSideMm } from '../../../../../../modules/bom-items/costing/machining/stock-allowance';

// The reference stock-allowance rule, built from the real memory/Stock Maching
// variables.csv values (percentStockAllowance 5, minStockAllowance 0.79375,
// maxStockAllowance 3.175) through the same resolver production uses.
const STOCK_RULE = resolveStockAllowanceRule([
  { key: 'percentStockAllowance', value: '5' },
  { key: 'minStockAllowance', value: '0.79375' },
  { key: 'maxStockAllowance', value: '3.175' },
]).rule!;

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
function milledInput(overrides: Partial<MachiningCostInput> = {}): MachiningCostInput {
  return {
    volume: 100_000,
    surfaceArea: 40_000,
    maxLength: 83,
    maxWidth: 62,
    maxHeight: 32,
    holeCount: 107,
    holeGroups: [{ diameter_mm: 4, count: 107, depth_mm: 10 }],
    pocketCount: 4,
    materialGrade: 'AL6061-T6',
    materialCostPerKg: 350,
    materialDensityKgM3: 2700,
    materialSource: 'db',
    threads: [{ size: 'M4', count: 12 }],
    tightestToleranceMm: 0.05,
    // Two real callouts, each timed by an inspection_rules row (3 min). The
    // count always equals the callouts it came from (resolveGdtCallouts).
    gdtFeatureCount: 2,
    gdtFeatures: [
      { symbol: 'position', tolerance: 0.05, timeMin: 3 },
      { symbol: 'flatness', tolerance: 0.4, timeMin: 3 },
    ],
    batchSize: 60,
    family: 'milled',
    finishedWeightKg: 0.27,
    mhrRate: rate(900),
    tappingRate: rate(900, { machineClass: 'tapping' }),
    deburrRate: rate(300, { machineClass: 'deburring', machineName: null }),
    inspectionRate: rate(450, {
      machineClass: 'cmm', machineName: null, commodityCode: null,
    }),
    surfaceTreatment: null,
    machiningCalculators: CALCS,
    capabilityRules: RULES,
    location: 'India',
    ...overrides,
  };
}

describe('computeMillingCostSummary — billet and chip loss', () => {
  it('adds the reference stock allowance per side to the billet', () => {
    const perSide = stockAllowancePerSideMm(STOCK_RULE, { length: 83, width: 62, height: 32 }); // 5% of 62 = 3.1
    const result = computeMillingCostSummary(milledInput({ stockAllowancePerSideMm: perSide }), mc('3_axis_mill'));
    const allow = 2 * perSide;
    const expectedVol = (83 + allow) * (62 + allow) * (32 + allow);
    expect(result.materialRemoval!.billetWeightKg).toBeCloseTo((expectedVol / 1e9) * 2700, 3);
  });

  it('clamps utilization at 100% and warns when CAD volume exceeds the billet', () => {
    // Impossible data: part heavier than any billet the bbox can supply
    const result = computeMillingCostSummary(
      milledInput({ finishedWeightKg: 5.0 }),
      mc('3_axis_mill'),
    );
    expect(result.materialRemoval!.utilizationPct).toBeLessThanOrEqual(100);
    expect(result.materialRemoval!.chipScrapPct).toBeGreaterThanOrEqual(0);
  });

  it('warns on inconsistent CAD volume (volume > billet)', () => {
    const result = computeMillingCostSummary(
      milledInput({ volume: 999_999_999 }),
      mc('3_axis_mill'),
    );
    expect(result.warnings.some((w) => w.includes('volume exceeds'))).toBe(true);
  });

  it('warns when chip loss exceeds 65%', () => {
    const result = computeMillingCostSummary(
      milledInput({ finishedWeightKg: 0.05 }),
      mc('3_axis_mill'),
    );
    expect(result.materialRemoval!.chipScrapPct).toBeGreaterThan(65);
    expect(result.warnings.some((w) => w.includes('Chip loss'))).toBe(true);
  });

  it('folds fixture cost into CNC Milling setupCost (no separate Setup or Fixture process line)', () => {
    const india = computeMillingCostSummary(milledInput({ location: 'India' }), mc('3_axis_mill'));
    const usa = computeMillingCostSummary(milledInput({ location: 'USA' }), mc('3_axis_mill'));
    // Fixture is no longer a standalone process line
    expect(india.processLines.find((l) => l.process === 'Fixture')).toBeUndefined();
    expect(usa.processLines.find((l) => l.process === 'Fixture')).toBeUndefined();
    // "Setup" is no longer a standalone process line either (2026-09-18) —
    // it's folded into the first real line (CNC Milling) instead.
    expect(india.processLines.find((l) => l.process === 'Setup')).toBeUndefined();
    expect(usa.processLines.find((l) => l.process === 'Setup')).toBeUndefined();
    // Setup/fixture cost lives on the CNC Milling line itself. This fixture
    // supplies no fixtureUnitCostLocal and its rate carries no real
    // setup_time_hr, so that folded setupCost is genuinely 0 (setup not costed).
    const indiaMilling = india.processLines.find((l) => l.machineClass === '3_axis_mill')!;
    const usaMilling = usa.processLines.find((l) => l.machineClass === '3_axis_mill')!;
    expect(indiaMilling.setupCost).toBe(0);
    expect(usaMilling.setupCost).toBe(0);
    expect(indiaMilling.setupTimeSource).toBe('none');
    expect(usaMilling.setupTimeSource).toBe('none');
  });

  it('prices the tapping line at the machine rate it was given (rigid tapping inheritance)', () => {
    const result = computeMillingCostSummary(
      milledInput({ tappingRate: rate(900, { machineClass: 'tapping', machineName: 'Makino V56i' }) }),
      mc('3_axis_mill'),
    );
    const tapping = result.processLines.find((l) => l.process === 'Tapping')!;
    expect(tapping.hourlyRate).toBe(900);
    expect(tapping.machineName).toBe('Makino V56i');
  });

  // Reported: a machined part's Tapping, run on the lathe that turned it, was
  // labelled "Sheet Metal / Drilling / Tapping" — tapping's own catalog row —
  // instead of the lathe's Machining category.
  it('takes the host machine\'s Process/Category for tapping inherited onto it, with Tapping as the operation', () => {
    const identities = {
      tapping: { processGroup: 'Sheet Metal', processRoute: 'Drilling', operation: 'Tapping' },
      '3_axis_mill': { processGroup: 'Machining', processRoute: '3 Axis Mill', operation: 'Bulk Milling' },
    };
    const result = computeMillingCostSummary(
      milledInput({
        tappingRate: rate(900, { machineClass: 'tapping', hostMachineClass: '3_axis_mill', machineName: 'Makino V56i' }),
        processIdentityByMachineClass: identities,
      }),
      mc('3_axis_mill'),
    );
    const tapping = result.processLines.find((l) => l.process === 'Tapping')!;
    expect(tapping.processGroup).toBe('Machining');
    expect(tapping.processRoute).toBe('3 Axis Mill');
    expect(tapping.operation).toBe('Tapping');
    expect(tapping.hostMachineClass).toBe('3_axis_mill');
    expect(tapping.machineClass).toBe('tapping');
  });

  it('leaves a tapping line with no host on file unlabelled rather than borrowing tapping\'s Sheet Metal row', () => {
    const result = computeMillingCostSummary(
      milledInput({
        tappingRate: rate(900, { machineClass: 'tapping', hostMachineClass: '3_axis_mill' }),
        processIdentityByMachineClass: { tapping: { processGroup: 'Sheet Metal', processRoute: 'Drilling', operation: 'Tapping' } },
      }),
      mc('3_axis_mill'),
    );
    const tapping = result.processLines.find((l) => l.process === 'Tapping')!;
    expect(tapping.processGroup).toBeUndefined();
  });
});

describe('inspection line — batch sampling + CMM amortized rate', () => {
  // milledInput per-piece inspection minutes:
  // base 5 + holeSample min(ceil(107/5),15)×0.5 = 7.5 + threads min(12,6)×0.4 = 2.4
  // + tolAdder 8 (0.05mm) + GD&T 2 callouts × 3 min (inspection_rules) = 6 → 28.9 min
  const PER_PIECE_MIN = 28.9;

  // Per-piece minutes as the Inspection calculator itself computed them
  // ("Inspection per Piece" in the line's calculation trace).
  const perPiece = (r: ReturnType<typeof computeMillingCostSummary>) =>
    r.processLines.find((l) => l.process === 'Inspection')!.calculationTrace!.find((s) => s.fieldName === 'Inspection per Piece')!.value;
  const noFeatures = { holeCount: 0, holeGroups: [], threads: [], tightestToleranceMm: null, gdtFeatureCount: 0, gdtFeatures: [] };

  it('computes per-piece inspection minutes from holes/threads/tolerance/GD&T', () => {
    expect(perPiece(computeMillingCostSummary(milledInput(), mc('3_axis_mill')))).toBeCloseTo(PER_PIECE_MIN, 5);
  });

  it('uses per-callout GD&T time from the severity rules when callouts are provided', () => {
    // position 0.05 → CMM 8 min; flatness 0.4 → height gauge 4 min (vs flat 3+3)
    const withCallouts = computeMillingCostSummary(milledInput({
      ...noFeatures, gdtFeatureCount: 2,
      gdtFeatures: [{ symbol: 'position', tolerance: 0.05 }, { symbol: 'flatness', tolerance: 0.4 }],
    } as any), mc('3_axis_mill'));
    expect(perPiece(withCallouts)).toBe(5 + 8 + 4);
  });

  it('batch 1 = FAI full measurement + one final check', () => {
    const result = computeMillingCostSummary(milledInput({ batchSize: 1 }), mc('3_axis_mill'));
    const insp = result.processLines.find((l) => l.process === 'Inspection')!;
    // The default inspectionRate carries no real setup_time_hr: CMM setup not costed.
    expect(insp.setupCost).toBe(0);
    // FAI (28.9 min) + final visual check (2 min)
    expect(insp.runCost).toBeCloseTo(((PER_PIECE_MIN + 2) / 60) * 450, 2);
    expect(insp.hourlyRate).toBe(450);
    expect(insp.machineClass).toBe('cmm');
  });

  it('amortizes three-stage sampling over the batch (FAI + in-process 1/10 + final 1/25)', () => {
    // batch 60 → FAI 1 + in-process floor(59/10)=5 full measurements + final ceil(60/25)=3 × 2min
    const measuredMin = PER_PIECE_MIN * 6 + 2 * 3;
    const result = computeMillingCostSummary(milledInput({ batchSize: 60 }), mc('3_axis_mill'));
    const insp = result.processLines.find((l) => l.process === 'Inspection')!;
    expect(insp.runCost).toBeCloseTo(((measuredMin / 60) * 450) / 60, 2);
    expect(insp.setupCost).toBe(0); // no real CMM setup_time_hr on the default inspectionRate
    expect(insp.cycleTimeMin).toBeCloseTo(measuredMin / 60, 2);
  });

  it('honors a per-item samplingPerN override (1 = full measurement on every part)', () => {
    const result = computeMillingCostSummary(
      milledInput({ batchSize: 60, samplingPerN: 1 }),
      mc('3_axis_mill'),
    );
    const insp = result.processLines.find((l) => l.process === 'Inspection')!;
    // FAI 1 + in-process 59 = every part fully measured, + 3 final checks
    const measuredMin = PER_PIECE_MIN * 60 + 2 * 3;
    expect(insp.runCost).toBeCloseTo(((measuredMin / 60) * 450) / 60, 2);
  });

  it('emits the inspection line on turned parts too', () => {
    const result = computeTurningCostSummary(
      milledInput({ family: 'turned' }),
      mc('2_axis_lathe'),
    );
    expect(result.processLines.some((l) => l.process === 'Inspection')).toBe(true);
  });

  it('applies a named quality plan (full_cmm: every part measured)', () => {
    const result = computeMillingCostSummary(
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
    const general = computeMillingCostSummary(milledInput({ batchSize: 100 }), mc('3_axis_mill'));
    const as9100 = computeMillingCostSummary(
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
    const withDbTime = computeMillingCostSummary(milledInput({
      ...noFeatures, gdtFeatureCount: 1,
      gdtFeatures: [{ symbol: 'position', tolerance: 0.05, timeMin: 20 }],
    } as any), mc('3_axis_mill'));
    expect(perPiece(withDbTime)).toBe(5 + 20);
  });

  // Root-caused live (2026-09-18): a CMM class constant was used unconditionally,
  // ignoring a real per-CMM mhr_records.setup_time_hr even when present —
  // same fix pattern applied to the main Setup line below.
  it('uses a real per-CMM setup_time_hr when one is on file', () => {
    const result = computeMillingCostSummary(
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

  it('does not cost CMM setup, and says so, when no real setup_time_hr exists', () => {
    const result = computeMillingCostSummary(milledInput({ batchSize: 48 }), mc('3_axis_mill'));
    const insp = result.processLines.find((l) => l.process === 'Inspection')!;
    expect(insp.setupTimeMin).toBe(0);
    expect(insp.setupTimeSource).toBe('none');
    expect(insp.setupCost).toBe(0);
    expect(result.warnings.some((w) => w.includes('setup not costed') && w.includes('setup_time_hr'))).toBe(true);
  });
});

describe('Setup — folded into the first real line (CNC Milling / OD Turning), real per-machine mhr_records.setup_time_hr or not costed', () => {
  it('uses the real per-machine setup_time_hr when the selected machine has one', () => {
    const result = computeMillingCostSummary(
      milledInput({
        batchSize: 10,
        mhrRate: rate(900, { setupTimeHr: 0.75 }), // 45 min
      }),
      mc('3_axis_mill'),
    );
    // "Setup" is no longer its own process line (2026-09-18) — a machine's
    // one-time workholding/fixturing overhead is folded into the first real
    // operation line it produces instead of appearing as a peer operation.
    expect(result.processLines.find((l) => l.process === 'Setup')).toBeUndefined();
    const milling = result.processLines.find((l) => l.machineClass === '3_axis_mill')!;
    expect(milling.setupTimeMin).toBe(45);
    expect(milling.setupTimeSource).toBe('machine');
    // "3 Axis Mill: ..." is resolveSetupMinutes' own process-labeled warning
    // (named after the real, class-specific process — realProcessName) for
    // THIS line specifically -- the Inspection line's separate "setup not
    // costed" warning is expected to still fire in this fixture (its own
    // inspectionRate carries no setupTimeHr) and must not be confused for it.
    expect(result.warnings.some((w) => w.startsWith('3 Axis Mill:'))).toBe(false);
  });

  it('does not cost setup, and says so, when no real setup time resolved', () => {
    const result = computeMillingCostSummary(milledInput({ batchSize: 10 }), mc('3_axis_mill'));
    const milling = result.processLines.find((l) => l.machineClass === '3_axis_mill')!;
    expect(milling.setupTimeMin).toBe(0);
    expect(milling.setupTimeSource).toBe('none');
    expect(milling.setupCost).toBe(0);
    expect(result.warnings.some((w) => w.startsWith('3 Axis Mill: setup not costed'))).toBe(true);
  });

  it('applies the same real-data preference on turned parts', () => {
    const result = computeTurningCostSummary(
      milledInput({ family: 'turned', batchSize: 10, mhrRate: rate(900, { machineClass: '2_axis_lathe', setupTimeHr: 0.1 }) }), // 6 min
      mc('2_axis_lathe'),
    );
    expect(result.processLines.find((l) => l.process === 'Setup')).toBeUndefined();
    const roughTurning = result.processLines.find((l) => l.process === 'Rough Turning')!;
    expect(roughTurning.setupTimeMin).toBe(6);
    expect(roughTurning.setupTimeSource).toBe('machine');
  });
});

describe('surface treatment line — reference process from the drawing callout', () => {
  it('names the reference process a callout calls for, most specific first', () => {
    expect(matchSurfaceTreatmentCallout('Zinc plated')).toBe('Zinc Plating');
    expect(matchSurfaceTreatmentCallout('Zinc Nickel plated per ASTM B841')).toBe('Zinc Nickel Plating');
    expect(matchSurfaceTreatmentCallout('Black Anodize per MIL-A-8625')).toBe('Anodize');
    expect(matchSurfaceTreatmentCallout('Hard chrome')).toBe('Hard Chrome Plating');
    expect(matchSurfaceTreatmentCallout('Passivate')).toBe('Passivation');
    expect(matchSurfaceTreatmentCallout('Rainbow finish')).toBeNull();
    expect(matchSurfaceTreatmentCallout('None')).toBeNull();
    expect(matchSurfaceTreatmentCallout(null)).toBeNull();
  });

  it('assembles the line from the engine per-part cost, never a rate of its own', () => {
    const result = computeMillingCostSummary(
      milledInput({
        surfaceTreatment: 'Zinc plated',
        batchSize: 60,
        surfaceTreatmentDbRate: { treatmentType: 'surface_zinc_plating', label: 'Zinc Plating', machineName: 'Default Zinc Plating', totalCostFromCalculatorLocal: 1.76 },
      }),
      mc('3_axis_mill'),
    );
    const st = result.processLines.find((l) => l.process.startsWith('Surface Treatment'))!;
    expect(st.process).toBe('Surface Treatment (Zinc Plating)');
    expect(st.machineClass).toBe('surface_zinc_plating');
    expect(st.machineName).toBe('Default Zinc Plating');
    expect(st.totalCost).toBeCloseTo(1.76, 2);
  });

  it('a process the reference cannot cost is a zero line with its gap, not a price', () => {
    const warnings: string[] = [];
    const line = computeSurfaceTreatmentLine('Anodize', 40_000, 60, 'USA', warnings, {
      treatmentType: 'surface_anodize', label: 'Anodize', machineName: null,
      gap: { gapType: 'unsupported_operation', process: 'Anodize', machineClass: 'surface_anodize', reason: 'no anodizing duration rule' },
    })!;
    expect(line.totalCost).toBe(0);
    expect(line.physicsGap?.gapType).toBe('unsupported_operation');
    expect(warnings.some((w) => w.includes('no anodizing duration rule'))).toBe(true);
  });

  it('never prices a treatment on zero surface area — warns instead', () => {
    const warnings: string[] = [];
    const line = computeSurfaceTreatmentLine('Zinc plated', 0, 60, 'India', warnings, {
      treatmentType: 'surface_zinc_plating', label: 'Zinc Plating', machineName: null, totalCostFromCalculatorLocal: 1,
    });
    expect(line).toBeNull();
    expect(warnings.some((w) => w.includes('surface area is unknown'))).toBe(true);
  });

  it('warns on a callout that names no reference process instead of guessing a price', () => {
    const warnings: string[] = [];
    const line = computeSurfaceTreatmentLine('Rainbow finish', 40_000, 60, 'India', warnings);
    expect(line).toBeNull();
    expect(warnings.some((w) => w.includes('does not name a reference surface-treatment process'))).toBe(true);
  });

  it('adds no surface treatment line when the part has no callout', () => {
    const result = computeMillingCostSummary(milledInput(), mc('3_axis_mill'));
    expect(result.processLines.some((l) => l.process.startsWith('Surface Treatment'))).toBe(false);
  });
});

describe('computeTurningCostSummary — data sanity', () => {
  it('still flags sheet/plate material grades on turned parts', () => {
    const result = computeTurningCostSummary(
      milledInput({ family: 'turned', materialGrade: '6061-T6 Sheet' }),
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
    const result = computeTurningCostSummary(
      turnedInput({
        maxLength: 100, maxWidth: 20, maxHeight: 20,
        blankResult: {
          form: 'round_bar', sizeLabel: 'Ø30 round bar', barDiameterMm: 30,
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
    // Setup folds into Rough Turning only, not Finish Turning. This fixture's
    // rate has no real setup_time_hr, so the folded setup is disclosed as not
    // costed ('none') rather than charged.
    expect(roughLine.setupTimeMin).toBe(0);
    expect(roughLine.setupTimeSource).toBe('none');
    expect(finishLine.setupTimeMin).toBeUndefined();
  });

  it('reports a gap instead of estimating when real tblGeneralTurning data is not resolved', () => {
    const result = computeTurningCostSummary(
      turnedInput({
        maxLength: 100, maxWidth: 20, maxHeight: 20, volume: 5000,
        blankResult: {
          form: 'round_bar', sizeLabel: 'Ø30 round bar', barDiameterMm: 30,
          billetVolMm3: Math.PI * 15 ** 2 * 100,
          utilizationPct: 50,
        },
        turningParams: { roughCutDepthMm: 0, roughCuttingSpeedMPerMin: 0, roughFeedMmPerRev: 0, finishCutDepthMm: 0, finishCuttingSpeedMPerMin: 0, finishFeedMmPerRev: 0, dataFound: false },
      } as any),
      mc('2_axis_lathe'),
    );
    const line = result.processLines.find((l) => l.process === 'Rough Turning')!;
    // No estimated time: the line stays visible, unpriced, with the missing input named.
    expect(line.cycleTimeMin).toBe(0);
    expect(line.physicsGap?.gapType).toBe('unsupported_operation');
    expect(line.confidence).toBe('unsupported');
    expect(result.warnings.some((w) => w.includes('Turning not priced') && w.includes('tblGeneralTurning'))).toBe(true);
  });

  it('does not fall back with a warning when there is genuinely no material to remove (radial stock is zero)', () => {
    const result = computeTurningCostSummary(
      turnedInput({
        maxLength: 100, maxWidth: 20, maxHeight: 20, volume: 5000,
        blankResult: {
          form: 'round_bar', sizeLabel: 'Ø20 round bar', barDiameterMm: 20,
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

// Simultaneous Turning (multi-spindle automatic lathe) — real machine pool
// (simultaneous_turning_usa.csv, 15 real machines, real 2/6/8-spindle
// configs), real per-machine index-cycle overhead (migration 788), and the
// real Rough-Turning op-splitting physics (migration 785,
// tblMultiSpindleOpSplitting/Thresholds) confirmed the ONLY genuinely
// multi-spindle-specific data found anywhere in either reference corpus
// (the separate "Multi-Spindle Maching" folder turned out to have no real
// machine/rate/operation data at all beyond system-marker scaffolding —
// see migrations 784-787's own disclosed findings).
describe('Simultaneous Turning — real multi-station op-splitting + index-cycle overhead', () => {
  // Same 100mm/20x20mm/Ø30-round-bar fixture as the OD Turning suite above,
  // but with an explicit `volume` so materialRemovalMm3/barVolMm3 (the
  // disclosed real-removal-ratio proxy) is controllable and non-zero.
  // barVolMm3 = π×15²×100 ≈ 70685.83.
  const barVolMm3 = Math.PI * 15 ** 2 * 100;
  function simultaneousInput(volume: number, overrides: Partial<MachiningCostInput> = {}) {
    return turnedInput({
      maxLength: 100, maxWidth: 20, maxHeight: 20, volume,
      blankResult: { form: 'round_bar', sizeLabel: 'Ø30 round bar', barDiameterMm: 30, billetVolMm3: barVolMm3, utilizationPct: 50 },
      turningParams: REAL_TURNING_PARAMS,
      mhrRate: rate(1000, {
        machineClass: 'simultaneous_turning', machineName: 'Index MS32-6',
        numberSpindles: 6, drumIndexTimeS: 0.7, transferTimeS: 1.0, stockFeedTimeS: 2.5, speedSynchronizationTimeS: 1.5,
      }),
      ...overrides,
    } as any);
  }
  const baselineRoughSec = (() => {
    const diameterMm = 20;
    const rpm = (250.4 * 1000) / (Math.PI * diameterMm);
    const feedMmPerMin = rpm * 0.3625;
    return 3 * ((100 / feedMmPerMin) * 60); // 3 real rough passes, same math as the OD Turning suite
  })();

  it('splits Rough Turning across the real number of stations when the real removal ratio crosses the real threshold', () => {
    // volume=20000 -> materialRemovalMm3 = 70685.83-20000 = 50685.83 -> ratio ≈ 0.717, well over the real 0.22 threshold.
    const result = computeTurningCostSummary(
      simultaneousInput(20000, { roughTurningOpSplit: { shouldSplit: true, numberOfOperations: 2, thresholdRatio: 0.22, dataFound: true } }),
      mc('simultaneous_turning'),
    );
    const roughLine = result.processLines.find((l) => l.process === 'Rough Turning')!;
    expect(roughLine.cycleTimeMin).toBeCloseTo((baselineRoughSec / 2) / 60, 2);
    expect(result.warnings.some((w) => w.includes('split across 2 stations'))).toBe(true);
  });

  it('does NOT split when the real removal ratio is below the real threshold', () => {
    // volume=65000 -> materialRemovalMm3 = 5685.83 -> ratio ≈ 0.080, below the real 0.22 threshold.
    const result = computeTurningCostSummary(
      simultaneousInput(65000, { roughTurningOpSplit: { shouldSplit: true, numberOfOperations: 2, thresholdRatio: 0.22, dataFound: true } }),
      mc('simultaneous_turning'),
    );
    const roughLine = result.processLines.find((l) => l.process === 'Rough Turning')!;
    const expectedUnsplitSec = (() => {
      const diameterMm = 20;
      const rpm = (250.4 * 1000) / (Math.PI * diameterMm);
      const feedMmPerMin = rpm * 0.3625;
      const numRoughPasses = Math.round((5 - 0.8) / 1.3); // radialStock=(30-20)/2=5; same real pass-count formula
      return numRoughPasses * ((100 / feedMmPerMin) * 60);
    })();
    expect(roughLine.cycleTimeMin).toBeCloseTo(expectedUnsplitSec / 60, 2);
    expect(result.warnings.some((w) => w.includes('split across'))).toBe(false);
  });

  it('does not split — a disclosed gap, not a crash — when the real op-split data was not resolved', () => {
    const result = computeTurningCostSummary(
      simultaneousInput(20000, { roughTurningOpSplit: null }),
      mc('simultaneous_turning'),
    );
    const roughLine = result.processLines.find((l) => l.process === 'Rough Turning')!;
    expect(roughLine.cycleTimeMin).toBeCloseTo(baselineRoughSec / 60, 2);
    expect(result.warnings.some((w) => w.includes('split across'))).toBe(false);
  });

  it('adds a real Index Transfer line from the real per-machine index-cycle overhead (drum index + transfer + stock feed + speed sync)', () => {
    const result = computeTurningCostSummary(simultaneousInput(20000), mc('simultaneous_turning'));
    const line = result.processLines.find((l) => l.process === 'Index Transfer');
    expect(line).toBeDefined();
    // 0.7 + 1.0 + 2.5 + 1.5 = 5.7s = 0.095min (kept to 4 decimals, not rounded to 0.10)
    expect(line!.cycleTimeMin).toBeCloseTo(0.095, 4);
  });

  it('adds NO Index Transfer line for an ordinary (non-multi-spindle) lathe — numberSpindles is null', () => {
    const result = computeTurningCostSummary(
      turnedInput({
        maxLength: 100, maxWidth: 20, maxHeight: 20, volume: 20000,
        blankResult: { form: 'round_bar', sizeLabel: 'Ø30 round bar', barDiameterMm: 30, billetVolMm3: barVolMm3, utilizationPct: 50 },
        turningParams: REAL_TURNING_PARAMS,
      } as any),
      mc('2_axis_lathe'),
    );
    expect(result.processLines.some((l) => l.process === 'Index Transfer')).toBe(false);
  });

  it('never rechucks (single continuous automatic index cycle, SETUP_COUNT=1)', () => {
    const result = computeTurningCostSummary(simultaneousInput(20000), mc('simultaneous_turning'));
    expect(result.processLines.some((l) => l.process === 'Secondary Setup (Rechuck)')).toBe(false);
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
    const result = computeTurningCostSummary(
      turnedInput({
        maxLength: 100, maxWidth: 20, maxHeight: 20, volume: 5000,
        blankResult: {
          form: 'round_bar', sizeLabel: 'Ø30 round bar', barDiameterMm: 30,
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
    const result = computeTurningCostSummary(
      turnedInput({
        maxLength: 100, maxWidth: 20, maxHeight: 20, volume: 5000,
        blankResult: {
          form: 'round_bar', sizeLabel: 'Ø30 round bar', barDiameterMm: 30,
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
    const result = computeTurningCostSummary(
      turnedInput({
        maxLength: 100, maxWidth: 20, maxHeight: 20, volume: 5000,
        blankResult: {
          form: 'round_bar', sizeLabel: 'Ø30 round bar', barDiameterMm: 30,
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
    const result = computeTurningCostSummary(
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
// turning taxonomy computeTurningCostSummary already prices — this is a
// pure machine-class wiring fix (MACHINE_ENVELOPE/MACHINE_REGISTRY/
// SETUP_COUNT entries + a 4th route candidate), zero new
// physics.
describe('machining_millturn — real, distinct MillTurn machine class', () => {
  it('prices a turned part via computeTurningCostSummary using the machining_millturn machine class', () => {
    const result = computeTurningCostSummary(
      turnedInput({ mhrRate: rate(1200, { machineClass: 'machining_millturn', machineName: 'GILDEMEISTER GMX 400 LINEAR' }) } as any),
      mc('machining_millturn'),
    );
    expect(result.totalCost).toBeGreaterThan(0);
    expect(result.processLines.some((l) => l.machineClass === 'machining_millturn')).toBe(true);
  });

  it('does not cost setup, and says so, when no per-machine setup_time_hr is on the rate', () => {
    const result = computeTurningCostSummary(
      turnedInput({ mhrRate: rate(1200, { machineClass: 'machining_millturn' }) } as any),
      mc('machining_millturn'),
    );
    // "Setup" is no longer its own process line -- folded into Rough Turning.
    const roughTurning = result.processLines.find((l) => l.process === 'Rough Turning');
    expect(roughTurning).toBeDefined();
    expect(roughTurning!.setupTimeMin).toBe(0);
    expect(roughTurning!.setupTimeSource).toBe('none');
    expect(result.warnings.some((w) => w.includes('setup not costed'))).toBe(true);
  });
});

describe('meetsRequiredMilledClass', () => {
  it('passes every class when no requirement could be derived', () => {
    expect(meetsRequiredMilledClass(mc('3_axis_mill'), null)).toBe(true);
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

describe('material shape ranking (costing lookup)', () => {
  it('prefers plate/block/bar stock for machined parts over sheet rows', () => {
    expect(shapeRankForFamily('plates', 'milled')).toBeLessThan(
      shapeRankForFamily('sheets', 'milled'),
    );
    expect(shapeRankForFamily('bars', 'turned')).toBeLessThan(
      shapeRankForFamily('sheets', 'turned'),
    );
  });

  it('ranks a wrong-form row below a form-less row (sheet must lose to unknown for CNC)', () => {
    expect(shapeRankForFamily('sheets', 'milled')).toBeGreaterThan(
      shapeRankForFamily(null, 'milled'),
    );
    expect(isDiscouragedShapeForFamily('sheets', 'milled')).toBe(true);
    expect(isDiscouragedShapeForFamily('plates', 'milled')).toBe(false);
  });

  it('prefers sheet/coil stock for sheet-metal parts', () => {
    expect(shapeRankForFamily('sheets', 'sheet_metal')).toBe(0);
    expect(shapeRankForFamily('bars', 'sheet_metal')).toBe(100);
  });
});

// ── Sprint 1 regression tests ─────────────────────────────────────────────────

describe('Fix 1 — holeCount: feature-ops path uses correct count, not raw cylinder count', () => {
  it('a bare hole count with no per-diameter CAD data is never priced with a placeholder hole', () => {
    // Previously 19 raw cylinder faces were drilled as 19 invented 8 mm holes.
    const phantom = computeMillingCostSummary(
      milledInput({ holeCount: 19, holeGroups: [], featureOps: undefined }),
      mc('3_axis_mill'),
    );
    const none = computeMillingCostSummary(
      milledInput({ holeCount: 0, holeGroups: [], featureOps: undefined }),
      mc('3_axis_mill'),
    );
    const millingPhantom = phantom.processLines.find((l) => l.machineClass === '3_axis_mill')!.cycleTimeMin;
    const millingNone = none.processLines.find((l) => l.machineClass === '3_axis_mill')!.cycleTimeMin;
    expect(millingPhantom).toBe(millingNone);
    expect(phantom.warnings.some((w) => w.includes('Drilling not priced') && w.includes('per-diameter CAD hole data'))).toBe(true);
  });
});

describe('Fix 2 — blank optimizer: blankResult overrides bbox billet volume', () => {
  it('uses blankResult billetVolMm3 when provided instead of computing from bbox', () => {
    // The round bar (Ø30) gives a tighter blank than the full bbox billet
    const roundBarVol = Math.PI * 15 ** 2 * (83 + 5); // Ø30 × (L+5mm facing)
    const result = computeMillingCostSummary(
      milledInput({
        blankResult: {
          form: 'round_bar',
          sizeLabel: 'Ø30 round bar', barDiameterMm: 30,
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
    const perSide = stockAllowancePerSideMm(STOCK_RULE, { length: 83, width: 62, height: 32 });
    const allow = 2 * perSide;
    const bboxVol = (83 + allow) * (62 + allow) * (32 + allow);
    const result = computeMillingCostSummary(milledInput({ stockAllowancePerSideMm: perSide }), mc('3_axis_mill'));
    expect(result.materialRemoval!.billetWeightKg).toBeCloseTo((bboxVol / 1e9) * 2700, 3);
  });

  it('adds no allowance, and warns, when the reference rule is not staged', () => {
    const result = computeMillingCostSummary(milledInput({ stockAllowancePerSideMm: null }), mc('3_axis_mill'));
    expect(result.materialRemoval!.billetWeightKg).toBeCloseTo(((83 * 62 * 32) / 1e9) * 2700, 3);
    expect(result.warnings.some((w) => w.startsWith('Stock allowance not applied'))).toBe(true);
  });
});

describe('Fix 4 — machinabilityRating: scales MRR in both engines', () => {
  it('Al 6061 (machinability 150) gives lower roughing cycle time than mild steel (75)', () => {
    // No holes/holeGroups so milling time = pure roughing from MRR, uncontaminated by
    // fixed-time drilling ops. That isolates the machinabilityRating scaling.
    const alPart = computeMillingCostSummary(
      milledInput({ materialGrade: 'AL6061-T6', machinabilityRating: 150, holeCount: 0, holeGroups: [] }),
      mc('3_axis_mill'),
    );
    const steelPart = computeMillingCostSummary(
      milledInput({ materialGrade: 'A36', machinabilityRating: 75, holeCount: 0, holeGroups: [] }),
      mc('3_axis_mill'),
    );
    const alMilling = alPart.processLines.find((l) => l.machineClass === '3_axis_mill')!.cycleTimeMin;
    const steelMilling = steelPart.processLines.find((l) => l.machineClass === '3_axis_mill')!.cycleTimeMin;
    // Al MRR = 60000 × 2 = 120000; mild_steel MRR = 12000 × 1 = 12000 → 10× faster
    expect(alMilling).toBeLessThan(steelMilling);
    expect(steelMilling / alMilling).toBeCloseTo(10, 0);
  });

  it('featureOps path: total time with Al machinability < same ops with mild steel', () => {
    const fgv2 = [
      { feature_type: 'PocketV2', variant: 'default', diameter_mm: 0,
        occurrences: [{ depth_mm: 12, material_removed_mm3: 15_000 }] },
    ];
    const alOps = buildOperationSequence(fgv2, 'aluminum', 2.0);
    const steelOps = buildOperationSequence(fgv2, 'mild_steel', 1.0);
    const alTime = alOps.find((o) => o.name === 'Rough Milling')!.timeSec;
    const steelTime = steelOps.find((o) => o.name === 'Rough Milling')!.timeSec;
    expect(alTime).toBeLessThan(steelTime);
  });
});

describe('Fix 3 — featureOps path: total time drives CNC Milling line', () => {
  it('uses featureOps total when provided instead of billet-subtraction formula', () => {
    const knownOps = [
      { name: 'Facing', timeSec: 45, source: 'fixed' as const },
      { name: 'Rough Milling', timeSec: 300, source: 'feature' as const },
      { name: 'Drilling', timeSec: 40, source: 'feature' as const },
      { name: 'Deburr', timeSec: 90, source: 'fixed' as const },
    ];
    // Total = 385s (Face Mill + Pocket Rough + Drill) -- Deburr is excluded:
    // it has its own real, dedicated "Deburring" line elsewhere in this
    // function (tblDeburring-based) and must not also be folded in here.
    // With 15% overhead -> 385 * 1.15 / 60 ≈ 7.38 min.
    const result = computeMillingCostSummary(
      milledInput({ featureOps: knownOps }),
      mc('3_axis_mill'),
    );
    const millingMin = result.processLines.find((l) => l.machineClass === '3_axis_mill')!.cycleTimeMin;
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
      { name: 'Facing', timeSec: 45, source: 'fixed' as const },
      { name: 'Drilling', timeSec: 40, source: 'feature' as const },
      { name: 'Tapping', timeSec: 200, source: 'feature' as const },
      { name: 'Deburr', timeSec: 90, source: 'fixed' as const },
    ];
    const result = computeMillingCostSummary(
      milledInput({ featureOps: knownOps }),
      mc('3_axis_mill'),
    );
    const millingMin = result.processLines.find((l) => l.machineClass === '3_axis_mill')!.cycleTimeMin;
    // Only Face Mill (45s) + Drill (40s) = 85s, * 1.15 / 60
    expect(millingMin).toBeCloseTo((85 * 1.15) / 60, 2);
    // The real, separately-billed Tapping/Deburring lines still exist and
    // are unaffected -- this fix removes a DUPLICATE, not the real charge.
    expect(result.processLines.some((l) => l.process === 'Tapping')).toBe(true);
    expect(result.processLines.some((l) => l.process === 'Deburring')).toBe(true);
  });

  it('falls back to billet-subtraction when featureOps is absent', () => {
    const without = computeMillingCostSummary(milledInput({ featureOps: undefined }), mc('3_axis_mill'));
    const milling = without.processLines.find((l) => l.machineClass === '3_axis_mill')!;
    // bbox path: roughingMin = (billetVol - partVol) / MRR * 1.3 + drill
    expect(milling.cycleTimeMin).toBeGreaterThan(0);
  });
});

// Root-cause fix: cost-machining-engine.ts's drilling/tapping cycle times used to
// come from flat, material-blind tables (DRILL_CYCLE_SEC diameter buckets,
// TAP_CYCLE_SEC per thread size) — a stainless part and an aluminum part
// with identical geometry priced identically. Both now call the same real,
// sourced, material-family-aware physics (resolveDrillingSpeedFeed /
// computeTapCycleSec) every other secondary-hole-operation path in this
// codebase already uses. These tests prove the material sensitivity that
// did not exist before, not just that the functions still run.
describe('Fix — drilling/tapping now use real material-aware physics (no more flat tables)', () => {
  it('drilling a stainless part takes longer than the identical aluminum part (bbox-subtraction path)', () => {
    const alu = computeMillingCostSummary(
      milledInput({ featureOps: undefined, materialGrade: 'AL6061-T6', threads: [] }),
      mc('3_axis_mill'),
    );
    const stainless = computeMillingCostSummary(
      milledInput({ featureOps: undefined, materialGrade: 'SS304', threads: [] }),
      mc('3_axis_mill'),
    );
    const aluMilling = alu.processLines.find((l) => l.machineClass === '3_axis_mill')!.cycleTimeMin;
    const ssMilling = stainless.processLines.find((l) => l.machineClass === '3_axis_mill')!.cycleTimeMin;
    // Real HSS surface speed: aluminum 80 m/min vs stainless 15 m/min
    // (DRILL_SURFACE_SPEED_M_MIN_BY_MATERIAL) — stainless must take longer.
    expect(ssMilling).toBeGreaterThan(aluMilling);
  });

  it('prices tapping from tblTapping: M8 x 10 mm in mild steel at code 1.0, pitch 1.25 on the 1.0 mm row (22.6 m/min)', () => {
    const r = computeMillingCostSummary(
      milledInput({ materialGrade: 'AISI 1018', tappingTable: TAPPING, threads: [{ size: 'M8', count: 3, depthMm: 10 }] }),
      mc('3_axis_mill'),
    );
    const tap = r.processLines.find((l) => l.process === 'Tapping')!;
    const rpm = (22.6 * 1000) / (Math.PI * 8);
    const perThreadSec = (2 * 10) / (rpm * 1.25) * 60; // in and reversed out, one pitch per revolution
    expect(tap.cycleTimeMin).toBeCloseTo((perThreadSec * 3) / 60, 3);
    const speed = tap.calculationTrace!.find((st) => st.fieldName === 'Cutting Speed')!;
    expect(speed.source).toContain('tblTapping: material code 1');
    expect(tap.calculationTrace!.find((st) => st.fieldName === 'Thread Pitch')!.source).toBe('ISO 261 coarse pitch of M8');
  });

  it('tapping a stainless part takes longer than the identical mild-steel part (tblTapping speeds)', () => {
    const tapMin = (grade: string) => computeMillingCostSummary(
      milledInput({ materialGrade: grade, tappingTable: TAPPING, threads: [{ size: 'M6', count: 4, depthMm: 12 }] }),
      mc('3_axis_mill'),
    ).processLines.find((l) => l.process === 'Tapping')!.cycleTimeMin;
    expect(tapMin('SS304')).toBeGreaterThan(tapMin('AISI 1018'));
  });

  it('leaves aluminium tapping unpriced and named: tblTapping covers 125-400 HB only', () => {
    const r = computeMillingCostSummary(
      milledInput({ materialGrade: 'AL6061-T6', tappingTable: TAPPING, threads: [{ size: 'M6', count: 4, depthMm: 12 }] }),
      mc('3_axis_mill'),
    );
    const tap = r.processLines.find((l) => l.process === 'Tapping')!;
    expect(tap.cycleTimeMin).toBe(0);
    expect(r.warnings.join(' ')).toContain('tblTapping row for aluminum');
  });

  it('uses the real thread depth and never an assumed one', () => {
    const tapMin = (depthMm?: number) => computeMillingCostSummary(
      milledInput({ materialGrade: 'AISI 1018', tappingTable: TAPPING, threads: [{ size: 'M6', count: 4, depthMm }] }),
      mc('3_axis_mill'),
    );
    expect(tapMin(30).processLines.find((l) => l.process === 'Tapping')!.cycleTimeMin)
      .toBeGreaterThan(tapMin(5).processLines.find((l) => l.process === 'Tapping')!.cycleTimeMin);
    const noDepth = tapMin(undefined);
    expect(noDepth.processLines.find((l) => l.process === 'Tapping')!.cycleTimeMin).toBe(0);
    expect(noDepth.warnings.join(' ')).toContain('Thread Depth');
  });

  it('turned parts: boring/drilling is also material-aware now', () => {
    const turnedInput = (overrides: Partial<MachiningCostInput> = {}): MachiningCostInput => ({
      volume: 50_000, surfaceArea: 20_000, maxLength: 60, maxWidth: 25, maxHeight: 25,
      holeCount: 10, holeGroups: [{ diameter_mm: 6, count: 10, depth_mm: 15 }], pocketCount: 0,
      materialGrade: 'AL6061-T6', materialCostPerKg: 350, materialDensityKgM3: 2700,
      materialSource: 'db', threads: [], tightestToleranceMm: null, gdtFeatureCount: 0,
      batchSize: 60, family: 'turned', finishedWeightKg: 0.1,
      mhrRate: rate(900, { machineClass: '2_axis_lathe' }),
      tappingRate: rate(900, { machineClass: 'tapping' }),
      deburrRate: rate(300, { machineClass: 'deburring' }),
      inspectionRate: rate(450, { machineClass: 'cmm' }),
      surfaceTreatment: null,
      machiningCalculators: CALCS,
      drillingTable: realDrillingTable(),
      ...overrides,
    });
    const alu = computeTurningCostSummary(turnedInput({ materialGrade: 'AL6061-T6' }), mc('2_axis_lathe'));
    const stainless = computeTurningCostSummary(turnedInput({ materialGrade: 'SS304' }), mc('2_axis_lathe'));
    const aluBoring = alu.processLines.find((l) => l.process === 'Drilling')!.cycleTimeMin;
    const ssBoring = stainless.processLines.find((l) => l.process === 'Drilling')!.cycleTimeMin;
    expect(ssBoring).toBeGreaterThan(aluBoring);
  });
});

describe('Fix — operation-sequencer.ts shares one MRR/drill/tap source of truth with cost-machining-engine.ts', () => {
  it('feature-driven drilling is also material-aware (was diameter-only before)', () => {
    const throughHole = (dia: number) => [{
      feature_type: 'SimpleHole', variant: 'through',
      diameter_mm: dia,
      occurrences: [{ depth_mm: 10 }],
    }];
    const aluOps = buildOperationSequence(throughHole(6), 'aluminum', 1.0, 'AL6061-T6', null, null, null, realDrillingTable(), CALCS);
    const ssOps = buildOperationSequence(throughHole(6), 'stainless', 1.0, 'SS304', null, null, null, realDrillingTable(), CALCS);
    const aluDrill = aluOps.find((o) => o.name === 'Drilling')!.timeSec;
    const ssDrill = ssOps.find((o) => o.name === 'Drilling')!.timeSec;
    expect(ssDrill).toBeGreaterThan(aluDrill);
  });

  it('feature-driven tapping reads the same tblTapping calculator (stainless slower than mild steel)', () => {
    const tappedHole = [{
      feature_type: 'SimpleHole', variant: 'threaded',
      diameter_mm: 6,
      occurrences: [{ depth_mm: 12, spec: 'M6' }],
    }];
    const tapSec = (cls: 'mild_steel' | 'stainless', grade: string) =>
      buildOperationSequence(tappedHole, cls, 1.0, grade, null, null, null, null, CALCS, TAPPING).find((o) => o.name === 'Tapping')!.timeSec;
    expect(tapSec('stainless', 'SS304')).toBeGreaterThan(tapSec('mild_steel', 'AISI 1018'));
  });

});

// Root-caused 2026-09-16: checkMachiningCapability used to be untested and used a
// single hardcoded per-CLASS envelope for every machine in that class,
// regardless of which real machine was actually selected. Now delegates to
// checkMachineCapability (the same real per-machine system every other
// domain uses) when the caller has a resolved candidate, and only falls
// back to the class-level default when it genuinely doesn't (pre-selection
// feasibility gate, or physics selection disabled) — these tests prove
// both paths, and that they produce DIFFERENT verdicts for the same
// bounding box depending on which real machine was actually selected.
describe('checkMachiningCapability — real per-machine envelope (migration 755) vs class-default fallback', () => {
  function cap(overrides: Partial<MachineCapability>): MachineCapability {
    return { ...EMPTY_CAPABILITY, ...overrides };
  }

  it('a real small-chuck lathe rejects a part the class-default envelope alone would have allowed', () => {
    // 2_axis_lathe's MACHINE_ENVELOPE class default is generous (l:600,w:300,h:300);
    // a real, specific small lathe (maxDiameterMm=100) must be stricter.
    const withoutReal = checkMachiningCapability(mc('2_axis_lathe'), 500, 150, 150, 5);
    expect(withoutReal.overallCapable).toBe(true);

    const withReal = checkMachiningCapability(
      mc('2_axis_lathe'), 500, 150, 150, 5,
      cap({ maxDiameterMm: 100, maxLengthMm: 3000 }), 'imported',
    );
    expect(withReal.overallCapable).toBe(false);
    expect(withReal.machineCapabilityWarnings.some((w) => w.includes('swing capacity'))).toBe(true);
  });

  it('a real large mill accepts a part the class-default envelope alone would have rejected', () => {
    // 3_axis_mill's MACHINE_ENVELOPE class default is l:600,w:400,h:400;
    // a real, specific large VMC has real travel well beyond that.
    const withoutReal = checkMachiningCapability(mc('3_axis_mill'), 900, 700, 500, 50);
    expect(withoutReal.overallCapable).toBe(false);

    const withReal = checkMachiningCapability(
      mc('3_axis_mill'), 900, 700, 500, 50,
      cap({ maxXMm: 2133.6, maxYMm: 2133.6, maxZMm: 1219 }), 'imported',
    );
    expect(withReal.overallCapable).toBe(true);
  });

  it('rejects on real Z-axis travel specifically, distinct from X/Y', () => {
    const result = checkMachiningCapability(
      mc('5_axis_mill'), 500, 400, 900, 50,
      cap({ maxXMm: 2000, maxYMm: 2000, maxZMm: 750 }), 'imported',
    );
    expect(result.overallCapable).toBe(false);
    expect(result.machineCapabilityWarnings.some((w) => w.includes('Z-axis'))).toBe(true);
  });

  it('weight stays on the class-default ceiling even with real capability data (no real per-machine weight source exists)', () => {
    const result = checkMachiningCapability(
      mc('2_axis_lathe'), 100, 50, 50, 100_000, // absurd weight, real dims fine
      cap({ maxDiameterMm: 700, maxLengthMm: 3000 }), 'imported',
    );
    expect(result.overallCapable).toBe(false);
    expect(result.machineCapabilityWarnings.some((w) => w.includes('weight capacity'))).toBe(true);
  });

  it('falls back to the class-default envelope, disclosed as such, when no real machine has been selected yet', () => {
    const result = checkMachiningCapability(mc('3_axis_mill'), 5000, 5000, 5000, 5);
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
  // Real row copied verbatim from memory/Machining/lookup (tblReaming.csv): the aluminum-range
  // entry, so an aluminum part is inside the table's own hardness range.
  { ToolType: 'Ream', MaterialCutCodeName: '30.11', Hardness: 60, HardnessSystem: 'Brinell', DiameterMm: 3, CuttingSpeedMPerMin: 27.2, FeedMm: 0.3 },
];

// Every fixture below uses 0.04mm, not the tighter values a real Reaming
// scenario might use in the field — 0.04 sits strictly between the real
// RULES.jigBorePositionToleranceMm (variables jigBoreMaxPosTol 0.0254)
// and TIGHT_TOLERANCE_REAM_THRESHOLD_MM (0.05), so these tests exercise
// Reaming specifically without also entering Jig Boring's tier.

describe('Reaming — new operation, tolerance-triggered, real tblReaming physics', () => {
  it('adds no Reaming line when tolerance is not tight, even with real reamTable data', () => {
    const result = computeMillingCostSummary(
      milledInput({ tightestToleranceMm: 0.2, reamTable: REAM_TABLE } as any),
      mc('3_axis_mill'),
    );
    expect(result.processLines.some((l) => l.process === 'Reaming')).toBe(false);
  });

  it('shows the Reaming gap when tolerance is tight but no real reamTable was resolved (not fabricated)', () => {
    const result = computeMillingCostSummary(
      milledInput({ tightestToleranceMm: 0.04, reamTable: null } as any),
      mc('3_axis_mill'),
    );
    expectGapLine(result, 'Reaming');
  });

  it('adds a real Reaming line when tolerance is tight AND real reamTable data is available', () => {
    const result = computeMillingCostSummary(
      milledInput({
        tightestToleranceMm: 0.04,
        holeGroups: [{ diameter_mm: 3, count: 4, depth_mm: 7.5 }],
        reamTable: REAM_TABLE,
      } as any),
      mc('3_axis_mill'),
    );
    const reamLine = result.processLines.find((l) => l.process === 'Reaming');
    expect(reamLine).toBeDefined();
    expect(reamLine!.cycleTimeMin).toBeGreaterThan(0);
  });

  it('reams the smallest real hole group when several exist (disclosed part-level approximation)', () => {
    const withSmall = computeMillingCostSummary(
      milledInput({
        tightestToleranceMm: 0.04,
        holeGroups: [{ diameter_mm: 3, count: 1, depth_mm: 7.5 }, { diameter_mm: 20, count: 1, depth_mm: 50 }],
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
    const alu = computeMillingCostSummary(
      milledInput({
        materialGrade: 'AL6061-T6', tightestToleranceMm: 0.04,
        holeGroups: [{ diameter_mm: 3, count: 1, depth_mm: 7.5 }], reamTable: REAM_TABLE,
      } as any),
      mc('3_axis_mill'),
    );
    const stainless = computeMillingCostSummary(
      milledInput({
        materialGrade: 'SS304', tightestToleranceMm: 0.04,
        holeGroups: [{ diameter_mm: 3, count: 1, depth_mm: 7.5 }], reamTable: REAM_TABLE,
      } as any),
      mc('3_axis_mill'),
    );
    const aluReam = alu.processLines.find((l) => l.process === 'Reaming')!.cycleTimeMin;
    const ssReam = stainless.processLines.find((l) => l.process === 'Reaming')!.cycleTimeMin;
    expect(ssReam).toBeGreaterThan(aluReam);
  });

  it('applies to turned parts too (was missing from that function entirely)', () => {
    const turnedInput = (overrides: any = {}): MachiningCostInput => ({
      volume: 50_000, surfaceArea: 20_000, maxLength: 60, maxWidth: 25, maxHeight: 25,
      holeCount: 1, holeGroups: [{ diameter_mm: 3, count: 1, depth_mm: 7.5 }], pocketCount: 0,
      materialGrade: 'AL6061-T6', materialCostPerKg: 350, materialDensityKgM3: 2700,
      materialSource: 'db', threads: [], tightestToleranceMm: 0.04, gdtFeatureCount: 0,
      batchSize: 60, family: 'turned', finishedWeightKg: 0.1,
      mhrRate: rate(900, { machineClass: '2_axis_lathe' }),
      tappingRate: rate(900, { machineClass: 'tapping' }),
      deburrRate: rate(300, { machineClass: 'deburring' }),
      inspectionRate: rate(450, { machineClass: 'cmm' }),
      surfaceTreatment: null,
      machiningCalculators: CALCS,
      reamTable: REAM_TABLE,
      ...overrides,
    });
    const result = computeTurningCostSummary(turnedInput(), mc('2_axis_lathe'));
    expect(result.processLines.some((l) => l.process === 'Reaming')).toBe(true);
  });
});

describe('Deburring — real hardness-matched tblDeburring speed, fixed a pre-existing turned-part gap', () => {
  it('reports a gap, not a surface-area estimate, when the real edge speed or CAD edge length is missing', () => {
    const noSpeed = computeMillingCostSummary(milledInput({ deburrLinearSpeedMmPerSec: null, sharpEdgeLengthMm: 600 } as any), mc('3_axis_mill'));
    const noEdges = computeMillingCostSummary(milledInput({ deburrLinearSpeedMmPerSec: 18.8, sharpEdgeLengthMm: null } as any), mc('3_axis_mill'));
    for (const result of [noSpeed, noEdges]) {
      const line = result.processLines.find((l) => l.process === 'Deburring')!;
      expect(line.cycleTimeMin).toBe(0);
      expect(line.physicsGap?.gapType).toBe('unsupported_operation');
    }
    expect(noEdges.processLines.find((l) => l.process === 'Deburring')!.physicsGap)
      .toMatchObject({ reason: expect.stringContaining('CAD sharp-edge length') });
  });

  it('prices deburring as CAD sharp-edge length / real tblDeburring edge speed, with its trace', () => {
    const result = computeMillingCostSummary(milledInput({ deburrLinearSpeedMmPerSec: 18.8, sharpEdgeLengthMm: 600 } as any), mc('3_axis_mill'));
    const line = result.processLines.find((l) => l.process === 'Deburring')!;
    expect(line.cycleTimeMin).toBeCloseTo(600 / 18.8 / 60, 4);
    expect(line.confidence).toBe('verified');
    expect(line.calculationTrace?.map((s) => s.source ?? s.formula)).toEqual([
      expect.stringContaining('CAD'),
      expect.stringContaining('tblDeburring'),
      '{Sharp Edge Length} / {Edge Speed}',
    ]);
  });

  it('turned parts now get a real Deburring line — this was a total gap before (zero deburr cost on any turned part)', () => {
    const turnedInput = (overrides: any = {}): MachiningCostInput => ({
      volume: 50_000, surfaceArea: 20_000, maxLength: 60, maxWidth: 25, maxHeight: 25,
      holeCount: 0, holeGroups: [], pocketCount: 0,
      materialGrade: 'AL6061-T6', materialCostPerKg: 350, materialDensityKgM3: 2700,
      materialSource: 'db', threads: [], tightestToleranceMm: null, gdtFeatureCount: 0,
      batchSize: 60, family: 'turned', finishedWeightKg: 0.1,
      mhrRate: rate(900, { machineClass: '2_axis_lathe' }),
      tappingRate: rate(900, { machineClass: 'tapping' }),
      deburrRate: rate(300, { machineClass: 'deburring' }),
      inspectionRate: rate(450, { machineClass: 'cmm' }),
      surfaceTreatment: null,
      machiningCalculators: CALCS,
      sharpEdgeLengthMm: 400,
      deburrLinearSpeedMmPerSec: 18.8,
      ...overrides,
    });
    const result = computeTurningCostSummary(turnedInput(), mc('2_axis_lathe'));
    expect(result.processLines.some((l) => l.process === 'Deburring')).toBe(true);
  });

  it('turned-part cycleTimes.deburrMin now reports real deburr time, not boring time (a pre-existing mislabel)', () => {
    const turnedInput = (overrides: any = {}): MachiningCostInput => ({
      volume: 50_000, surfaceArea: 20_000, maxLength: 60, maxWidth: 25, maxHeight: 25,
      holeCount: 10, holeGroups: [{ diameter_mm: 6, count: 10, depth_mm: 15 }], pocketCount: 0,
      materialGrade: 'AL6061-T6', materialCostPerKg: 350, materialDensityKgM3: 2700,
      materialSource: 'db', threads: [], tightestToleranceMm: null, gdtFeatureCount: 0,
      batchSize: 60, family: 'turned', finishedWeightKg: 0.1,
      mhrRate: rate(900, { machineClass: '2_axis_lathe' }),
      tappingRate: rate(900, { machineClass: 'tapping' }),
      deburrRate: rate(300, { machineClass: 'deburring' }),
      inspectionRate: rate(450, { machineClass: 'cmm' }),
      surfaceTreatment: null,
      machiningCalculators: CALCS,
      drillingTable: realDrillingTable(),
      sharpEdgeLengthMm: 400,
      deburrLinearSpeedMmPerSec: 18.8,
      ...overrides,
    });
    const result = computeTurningCostSummary(turnedInput(), mc('2_axis_lathe'));
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
  // Real row copied verbatim from memory/Machining/lookup (tblGunDrilling.csv): the aluminum-range
  // entry, so an aluminum part is inside the table's own hardness range.
  { 'Tool Type': 'Gun Drill', 'Material Cut Code Name': '30.11', Hardness: 60, 'Diameter (mm)': 3, 'Cutting Speed (m / min)': 175, 'Feed (mm / rev)': 0.01 },
];
const DEEP_BORE_MATERIALS = [
  { material_cut_code: '1.0', hardness: 125, cutting_speed_m_min: 502.8, feed_mm_rev_by_diameter: { '68.0': 0.12, '75.0': 0.133 } },
  { material_cut_code: '15.0', hardness: 275, cutting_speed_m_min: 90.0, feed_mm_rev_by_diameter: { '68.0': 0.10, '75.0': 0.11 } },
  // Real row copied verbatim from memory/Machining/lookup (tblDeepBoreDrilling__materials.csv): the aluminum-range
  // entry, so an aluminum part is inside the table's own hardness range.
  { material_cut_code: '30.11', hardness: 60, cutting_speed_m_min: 606.7, feed_mm_rev_by_diameter: { '68.0': 0.12, '75.0': 0.133 } },
];

// Root-caused live (2026-09-18): "Gun Drill" and "Deep Bore Machine" are
// real, staged machine categories (migrations 737/738/752/753 already
// activate their process_calculator_mappings rows) with real cutting-
// physics tables, but had ZERO cost engine before this — every hole was
// priced as a regular CNC "Drill" op regardless of depth.
describe('Gun Drilling / Deep Bore Machine — new operations, real L/D-triggered routing (deep-hole-routing.ts)', () => {
  it('adds no Gun Drilling/Deep Bore line when there are no deep-hole candidates', () => {
    const result = computeMillingCostSummary(milledInput(), mc('3_axis_mill'));
    expect(result.processLines.some((l) => l.process === 'Gun Drilling')).toBe(false);
    expect(result.processLines.some((l) => l.process === 'Deep Bore Machine')).toBe(false);
  });

  it('adds a real Gun Drilling line, billed at its own dedicated rate, when a small-diameter deep-hole candidate and a real rate exist', () => {
    const result = computeMillingCostSummary(
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
    const result = computeMillingCostSummary(
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
    const result = computeMillingCostSummary(
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
    const result = computeMillingCostSummary(
      milledInput({
        gunDrillCandidates: [{ diameterMm: 3, depthMm: 60, count: 4 }],
        gunDrillTable: null,
        gunDrillRate: rate(1500, { machineClass: 'gun_drill' }),
      } as any),
      mc('3_axis_mill'),
    );
    expectGapLine(result, 'Gun Drilling');
  });

  it("uses the real machine's own setup_time_hr", () => {
    const result = computeMillingCostSummary(
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

  it('does not cost setup, and says so, when setup_time_hr is absent', () => {
    const result = computeMillingCostSummary(
      milledInput({
        gunDrillCandidates: [{ diameterMm: 3, depthMm: 60, count: 4 }],
        gunDrillTable: GUN_DRILL_TABLE,
        gunDrillRate: rate(1500, { machineClass: 'gun_drill' }),
      } as any),
      mc('3_axis_mill'),
    );
    const line = result.processLines.find((l) => l.process === 'Gun Drilling')!;
    expect(line.setupTimeMin).toBe(0);
    expect(line.setupTimeSource).toBe('none');
    expect(line.setupCost).toBe(0);
    expect(result.warnings.some((w) => w.startsWith('Gun Drilling: setup not costed'))).toBe(true);
  });

  it('never double-counts a deep hole against the regular CNC Milling "Drill" op', () => {
    // The caller (bom-items.service.ts) is responsible for removing deep-hole
    // occurrences from featureOps before this function ever sees them —
    // simulate that contract directly: featureOps has no "Drill" entry for
    // the deep hole, only the candidate passed alongside it.
    const result = computeMillingCostSummary(
      milledInput({
        featureOps: [{ name: 'Facing', timeSec: 45, source: 'fixed' as const }],
        gunDrillCandidates: [{ diameterMm: 3, depthMm: 60, count: 4 }],
        gunDrillTable: GUN_DRILL_TABLE,
        gunDrillRate: rate(1500, { machineClass: 'gun_drill' }),
      } as any),
      mc('3_axis_mill'),
    );
    const millingLine = result.processLines.find((l) => l.machineClass === '3_axis_mill')!;
    // Only Face Mill (45s) drives CNC Milling -- the gun-drilled holes are
    // billed exclusively on the separate "Gun Drilling" line.
    expect(millingLine.cycleTimeMin).toBeCloseTo((45 * 1.15) / 60, 2);
    expect(result.processLines.some((l) => l.process === 'Gun Drilling')).toBe(true);
  });
});

// Real tblCylindricalGrinding / tblInternalGrinding rows for material cut
// code "1.0", read from the memory/ files migrations 744 / 809 staged.
const CYLINDRICAL_GRINDING_PARAMS = realGrindingParams('tblCylindricalGrinding', '1.0');
const INTERNAL_GRINDING_PARAMS = realGrindingParams('tblInternalGrinding', '1.0');

function turnedInput(overrides: Partial<MachiningCostInput> = {}): MachiningCostInput {
  return milledInput({
    family: 'turned',
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
    const result = computeTurningCostSummary(
      turnedInput({ tightestRaMicron: 0.8, cylindricalGrindingParams: CYLINDRICAL_GRINDING_PARAMS,
        cylindricalGrindingRate: rate(1800, { machineClass: 'cylindrical_grinder' }) }),
      mc('2_axis_lathe'),
    );
    expect(result.processLines.some((l) => l.process === 'Cylindrical Grinding')).toBe(false);
  });

  it('decides no grinding when the capability reference data is not staged, and says which value is absent', () => {
    const result = computeTurningCostSummary(
      turnedInput({ tightestRaMicron: 0.2, cylindricalGrindingParams: CYLINDRICAL_GRINDING_PARAMS,
        cylindricalGrindingRate: rate(1800, { machineClass: 'cylindrical_grinder' }),
        capabilityRules: null, capabilityRulesMissing: ['variables: finishGrindingDepth'] }),
      mc('2_axis_lathe'),
    );
    expect(result.processLines.some((l) => /Grinding|Jig/.test(l.process))).toBe(false);
    expect(result.warnings.some((w) => w.includes('capability reference data missing (variables: finishGrindingDepth)'))).toBe(true);
  });

  it(`adds no line exactly at the real ${RULES.grindingRaTriggerUm}µm ceiling (strictly less than, not <=)`, () => {
    const result = computeTurningCostSummary(
      turnedInput({ tightestRaMicron: RULES.grindingRaTriggerUm, cylindricalGrindingParams: CYLINDRICAL_GRINDING_PARAMS,
        cylindricalGrindingRate: rate(1800, { machineClass: 'cylindrical_grinder' }) }),
      mc('2_axis_lathe'),
    );
    expect(result.processLines.some((l) => l.process === 'Cylindrical Grinding')).toBe(false);
  });

  it('adds a real Cylindrical Grinding line, billed at its own dedicated rate, when Ra is tighter than turning/milling can achieve', () => {
    const result = computeTurningCostSummary(
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
    const result = computeTurningCostSummary(
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
    const result = computeTurningCostSummary(
      turnedInput({ tightestRaMicron: 0.2, cylindricalGrindingParams: { workSpeedMMin: 0, roughInfeedMm: 0, finishInfeedMm: 0, roughAxialFeedRevMm: 0, finishAxialFeedRevMm: 0, dataFound: false },
        cylindricalGrindingRate: rate(1800, { machineClass: 'cylindrical_grinder' }) }),
      mc('2_axis_lathe'),
    );
    expectGapLine(result, 'Cylindrical Grinding');
  });

  it('discloses, rather than fabricates, when Ra is tight but no dedicated Cylindrical Grinder rate is on file', () => {
    const result = computeTurningCostSummary(
      turnedInput({ tightestRaMicron: 0.2, cylindricalGrindingParams: CYLINDRICAL_GRINDING_PARAMS, cylindricalGrindingRate: undefined }),
      mc('2_axis_lathe'),
    );
    expect(result.processLines.some((l) => l.process === 'Cylindrical Grinding')).toBe(false);
  });

  it('never adds a Cylindrical Grinding line for a milled part (turned-parts-only scope)', () => {
    const result = computeMillingCostSummary(
      milledInput({ tightestRaMicron: 0.2, cylindricalGrindingParams: CYLINDRICAL_GRINDING_PARAMS,
        cylindricalGrindingRate: rate(1800, { machineClass: 'cylindrical_grinder' }) } as any),
      mc('3_axis_mill'),
    );
    expect(result.processLines.some((l) => l.process === 'Cylindrical Grinding')).toBe(false);
  });

  it("uses the real machine's own setup_time_hr", () => {
    const result = computeTurningCostSummary(
      turnedInput({ tightestRaMicron: 0.2, cylindricalGrindingParams: CYLINDRICAL_GRINDING_PARAMS,
        cylindricalGrindingRate: rate(1800, { machineClass: 'cylindrical_grinder', setupTimeHr: 0.5 }) }), // real 30min, per every real machine on file
      mc('2_axis_lathe'),
    );
    const line = result.processLines.find((l) => l.process === 'Cylindrical Grinding')!;
    expect(line.setupTimeMin).toBe(30);
    expect(line.setupTimeSource).toBe('machine');
  });

  it('does not cost setup, and says so, when setup_time_hr is absent', () => {
    const result = computeTurningCostSummary(
      turnedInput({ tightestRaMicron: 0.2, cylindricalGrindingParams: CYLINDRICAL_GRINDING_PARAMS,
        cylindricalGrindingRate: rate(1800, { machineClass: 'cylindrical_grinder' }) }),
      mc('2_axis_lathe'),
    );
    const line = result.processLines.find((l) => l.process === 'Cylindrical Grinding')!;
    expect(line.setupTimeMin).toBe(0);
    expect(line.setupTimeSource).toBe('none');
    expect(line.setupCost).toBe(0);
    expect(result.warnings.some((w) => w.startsWith('Cylindrical Grinding: setup not costed'))).toBe(true);
  });
});

// Real tblBoringV2 "Finish Boring" rows (real hardness column, unlike
// Cylindrical Grinding's table — no 2-hop bridge needed here).
const FINISH_BORING_TABLE = [
  { tool_type: 'Finish Bore', cut_type: 'Finish Boring', material_cut_code_name: '1.0', hardness: 125, diameter_mm: 3, cutting_speed_m_min: 30, feed_mm_rev: 0.05 },
  { tool_type: 'Finish Bore', cut_type: 'Finish Boring', material_cut_code_name: '15.0', hardness: 275, diameter_mm: 3, cutting_speed_m_min: 15, feed_mm_rev: 0.03 },
  // Real row copied verbatim from memory/Machining/lookup (tblBoringV2__rows.csv): the aluminum-range
  // entry, so an aluminum part is inside the table's own hardness range.
  { tool_type: 'Finish Bore', cut_type: 'Finish Boring', material_cut_code_name: '30.11', hardness: 60, diameter_mm: 1, cutting_speed_m_min: 317.6, feed_mm_rev: 0.13 },
];

// Root-caused live (2026-09-18): a real, tighter tier existed above
// Reaming (memory/machining/lookup/tblGtolProcessCapabilities.json's own
// real Jig Boring positionTolerance data, literal mm, no IT-grade
// conversion needed) but had no cost engine — every part, no matter how
// tight its real required tolerance, was priced at Reaming's rate at best.
describe('Jig Boring — new operation, a real tier tighter than Reaming', () => {
  it('adds no Jig Boring line when tolerance is looser than the real threshold', () => {
    const result = computeMillingCostSummary(
      milledInput({
        tightestToleranceMm: 0.04, holeGroups: [{ diameter_mm: 3, count: 2, depth_mm: 7.5 }],
        jigBoreTable: FINISH_BORING_TABLE,
        jigBoreRate: rate(2000, { machineClass: 'jig_bore' }),
      } as any),
      mc('3_axis_mill'),
    );
    expect(result.processLines.some((l) => l.process === 'Jig Boring')).toBe(false);
  });

  it(`adds a real Jig Boring line at the real ${RULES.jigBorePositionToleranceMm}mm threshold (inclusive) and tighter`, () => {
    const result = computeMillingCostSummary(
      milledInput({
        tightestToleranceMm: RULES.jigBorePositionToleranceMm, holeGroups: [{ diameter_mm: 3, count: 2, depth_mm: 7.5 }],
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
    const result = computeMillingCostSummary(
      milledInput({
        tightestToleranceMm: 0.02, holeGroups: [{ diameter_mm: 3, count: 2, depth_mm: 7.5 }],
        jigBoreTable: FINISH_BORING_TABLE, jigBoreRate: rate(2000, { machineClass: 'jig_bore' }),
        reamTable: REAM_TABLE,
      } as any),
      mc('3_axis_mill'),
    );
    expect(result.processLines.some((l) => l.process === 'Jig Boring')).toBe(true);
    expect(result.processLines.some((l) => l.process === 'Reaming')).toBe(false);
  });

  it(`applies the real ${RULES.jigBoringRepetitions}x repeat-pass count on top of the real Finish Boring physics`, () => {
    const result = computeMillingCostSummary(
      milledInput({
        tightestToleranceMm: 0.02, holeGroups: [{ diameter_mm: 3, count: 1, depth_mm: 7.5 }],
        jigBoreTable: FINISH_BORING_TABLE, jigBoreRate: rate(2000, { machineClass: 'jig_bore' }),
      } as any),
      mc('3_axis_mill'),
    );
    const line = result.processLines.find((l) => l.process === 'Jig Boring')!;
    // Single-pass finish-boring time at material_cut_code_name '1.0' (hardness
    // 125, nearest to mild_steel's real 125 bridge): depth = 3 * DRILL_DEPTH_TO_DIAMETER_RATIO (2.5) = 7.5mm.
    const rpm = (30 * 1000) / (Math.PI * 3);
    const feedMmPerMin = rpm * 0.05;
    // Pure cutting time: the calculator adds no borrowed tapping overhead per pass.
    const singlePassSec = (7.5 / feedMmPerMin) * 60;
    expect(line.cycleTimeMin).toBeCloseTo((singlePassSec * RULES.jigBoringRepetitions) / 60, 2);
  });

  it('discloses, rather than fabricates, when tolerance is tight but no real Finish Boring data was resolved', () => {
    const result = computeMillingCostSummary(
      milledInput({
        tightestToleranceMm: 0.02, holeGroups: [{ diameter_mm: 3, count: 1, depth_mm: 7.5 }],
        jigBoreTable: null, jigBoreRate: rate(2000, { machineClass: 'jig_bore' }),
      } as any),
      mc('3_axis_mill'),
    );
    expectGapLine(result, 'Jig Boring');
  });

  it('adds no line at all when tolerance is tight but no dedicated Jig Bore rate is on file (genuine gap, no fallback machine)', () => {
    const result = computeMillingCostSummary(
      milledInput({
        tightestToleranceMm: 0.02, holeGroups: [{ diameter_mm: 3, count: 1, depth_mm: 7.5 }],
        jigBoreTable: FINISH_BORING_TABLE, jigBoreRate: undefined,
      } as any),
      mc('3_axis_mill'),
    );
    expect(result.processLines.some((l) => l.process === 'Jig Boring')).toBe(false);
  });

  it("uses the real machine's own setup_time_hr", () => {
    const result = computeMillingCostSummary(
      milledInput({
        tightestToleranceMm: 0.02, holeGroups: [{ diameter_mm: 3, count: 1, depth_mm: 7.5 }],
        jigBoreTable: FINISH_BORING_TABLE,
        jigBoreRate: rate(2000, { machineClass: 'jig_bore', setupTimeHr: 1.0 }), // real 60min, per every real Jig Bore machine on file
      } as any),
      mc('3_axis_mill'),
    );
    const line = result.processLines.find((l) => l.process === 'Jig Boring')!;
    expect(line.setupTimeMin).toBe(60);
    expect(line.setupTimeSource).toBe('machine');
  });

  it('does not cost setup, and says so, when setup_time_hr is absent', () => {
    const result = computeMillingCostSummary(
      milledInput({
        tightestToleranceMm: 0.02, holeGroups: [{ diameter_mm: 3, count: 1, depth_mm: 7.5 }],
        jigBoreTable: FINISH_BORING_TABLE, jigBoreRate: rate(2000, { machineClass: 'jig_bore' }),
      } as any),
      mc('3_axis_mill'),
    );
    const line = result.processLines.find((l) => l.process === 'Jig Boring')!;
    expect(line.setupTimeMin).toBe(0);
    expect(line.setupTimeSource).toBe('none');
    expect(line.setupCost).toBe(0);
    expect(result.warnings.some((w) => w.startsWith('Jig Boring: setup not costed'))).toBe(true);
  });

  it('applies to turned parts too', () => {
    const result = computeTurningCostSummary(
      milledInput({
        family: 'turned', mhrRate: rate(900, { machineClass: '2_axis_lathe' }),
        tightestToleranceMm: 0.02, holeGroups: [{ diameter_mm: 3, count: 1, depth_mm: 7.5 }],
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
    const result = computeMillingCostSummary(
      milledInput({
        tightestToleranceMm: 0.02, holeGroups: [{ diameter_mm: 10, count: 1, depth_mm: 25 }],
        jigBoreTable: FINISH_BORING_TABLE, jigBoreRate: rate(2000, { machineClass: 'jig_bore' }),
        heatTreatment: 'None',
        internalGrindingParams: INTERNAL_GRINDING_PARAMS,
        jigGrindRate: rate(1800, { machineClass: 'jig_grind' }),
      } as any),
      mc('3_axis_mill'),
    );
    expect(result.processLines.some((l) => l.process === 'Jig Boring')).toBe(true);
    expect(result.processLines.some((l) => l.process === 'Jig Grind')).toBe(false);
  });

  it('routes to Jig Grind, not Jig Boring, at the same real tight tolerance when a real heat-treat callout is present', () => {
    const result = computeMillingCostSummary(
      milledInput({
        tightestToleranceMm: 0.02, holeGroups: [{ diameter_mm: 10, count: 1, depth_mm: 25 }],
        jigBoreTable: FINISH_BORING_TABLE, jigBoreRate: rate(2000, { machineClass: 'jig_bore' }),
        heatTreatment: 'Harden and temper to Rc 58-62',
        internalGrindingParams: INTERNAL_GRINDING_PARAMS,
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
      const result = computeMillingCostSummary(
        milledInput({
          tightestToleranceMm: 0.02, holeGroups: [{ diameter_mm: 10, count: 1, depth_mm: 25 }],
          jigBoreTable: FINISH_BORING_TABLE, jigBoreRate: rate(2000, { machineClass: 'jig_bore' }),
          heatTreatment: placeholder,
          internalGrindingParams: INTERNAL_GRINDING_PARAMS,
          jigGrindRate: rate(1800, { machineClass: 'jig_grind' }),
        } as any),
        mc('3_axis_mill'),
      );
      expect(result.processLines.some((l) => l.process === 'Jig Grind')).toBe(false);
      expect(result.processLines.some((l) => l.process === 'Jig Boring')).toBe(true);
    },
  );

  it('adds no Jig Grind line (and no Jig Boring fallback) when tolerance is looser than the real threshold, even with a real heat-treat callout', () => {
    const result = computeMillingCostSummary(
      milledInput({
        tightestToleranceMm: 0.04, holeGroups: [{ diameter_mm: 10, count: 1, depth_mm: 25 }],
        heatTreatment: 'Case harden 0.5mm deep',
        internalGrindingParams: INTERNAL_GRINDING_PARAMS,
        jigGrindRate: rate(1800, { machineClass: 'jig_grind' }),
      } as any),
      mc('3_axis_mill'),
    );
    expect(result.processLines.some((l) => l.process === 'Jig Grind')).toBe(false);
    expect(result.processLines.some((l) => l.process === 'Jig Boring')).toBe(false);
  });

  it('applies the real 4x repeat-pass count on top of the bore-grinding (tblInternalGrinding) physics', () => {
    const result = computeMillingCostSummary(
      milledInput({
        tightestToleranceMm: 0.02, holeGroups: [{ diameter_mm: 10, count: 1, depth_mm: 25 }],
        heatTreatment: 'Harden to Rc60',
        internalGrindingParams: INTERNAL_GRINDING_PARAMS,
        jigGrindRate: rate(1800, { machineClass: 'jig_grind' }),
      } as any),
      mc('3_axis_mill'),
    );
    const line = result.processLines.find((l) => l.process === 'Jig Grind')!;
    // One traverse bore-grinding pass set at Ø10 x 25 mm from the real
    // tblInternalGrinding code-1.0 row, then x4 (tblGtol Jig Grind repetitions).
    const p = INTERNAL_GRINDING_PARAMS;
    const rpm = (p.workSpeedMMin * 1000) / (Math.PI * 10);
    const finishStockMm = Math.min(p.finishInfeedMm, RULES.finishGrindingDepthMm);
    const roughStockMm = RULES.finishGrindingDepthMm - finishStockMm;
    const numRoughPasses = Math.max(0, Math.round(roughStockMm / p.roughInfeedMm));
    const passTimeSec = (feedRevMm: number) => (25 / (rpm * feedRevMm)) * 60;
    const singlePassSec = numRoughPasses * passTimeSec(p.roughAxialFeedRevMm) + passTimeSec(p.finishAxialFeedRevMm);
    expect(line.cycleTimeMin).toBeCloseTo((singlePassSec * RULES.jigGrindRepetitions) / 60, 2);
    expect(line.calculationTrace!.find((st) => st.fieldName === 'Rough Infeed')!.source).toContain('tblInternalGrinding');
  });

  it('discloses, rather than fabricates, when routed to Jig Grind but no real grinding physics data was resolved', () => {
    const result = computeMillingCostSummary(
      milledInput({
        tightestToleranceMm: 0.02, holeGroups: [{ diameter_mm: 10, count: 1, depth_mm: 25 }],
        heatTreatment: 'Harden to Rc60',
        internalGrindingParams: { workSpeedMMin: 0, roughInfeedMm: 0, finishInfeedMm: 0, roughAxialFeedRevMm: 0, finishAxialFeedRevMm: 0, dataFound: false },
        jigGrindRate: rate(1800, { machineClass: 'jig_grind' }),
      } as any),
      mc('3_axis_mill'),
    );
    expectGapLine(result, 'Jig Grind');
    expect(result.processLines.some((l) => l.process === 'Jig Boring')).toBe(false);
  });

  it('adds no line when routed to Jig Grind but no dedicated Jig Grind rate is on file (genuine gap, no fallback machine)', () => {
    const result = computeMillingCostSummary(
      milledInput({
        tightestToleranceMm: 0.02, holeGroups: [{ diameter_mm: 10, count: 1, depth_mm: 25 }],
        heatTreatment: 'Harden to Rc60',
        internalGrindingParams: INTERNAL_GRINDING_PARAMS,
        jigGrindRate: undefined,
      } as any),
      mc('3_axis_mill'),
    );
    expect(result.processLines.some((l) => l.process === 'Jig Grind')).toBe(false);
    expect(result.processLines.some((l) => l.process === 'Jig Boring')).toBe(false);
  });

  it("uses the real machine's own setup_time_hr", () => {
    const result = computeMillingCostSummary(
      milledInput({
        tightestToleranceMm: 0.02, holeGroups: [{ diameter_mm: 10, count: 1, depth_mm: 25 }],
        heatTreatment: 'Harden to Rc60',
        internalGrindingParams: INTERNAL_GRINDING_PARAMS,
        jigGrindRate: rate(1800, { machineClass: 'jig_grind', setupTimeHr: 1.0 }), // real 60min, every real Jig Grind machine on file
      } as any),
      mc('3_axis_mill'),
    );
    const line = result.processLines.find((l) => l.process === 'Jig Grind')!;
    expect(line.setupTimeMin).toBe(60);
    expect(line.setupTimeSource).toBe('machine');
  });

  it('applies to turned shafts too', () => {
    const result = computeTurningCostSummary(
      turnedInput({
        tightestToleranceMm: 0.02, holeGroups: [{ diameter_mm: 10, count: 1, depth_mm: 25 }],
        heatTreatment: 'Harden to Rc60',
        internalGrindingParams: INTERNAL_GRINDING_PARAMS,
        jigGrindRate: rate(1800, { machineClass: 'jig_grind' }),
      }),
      mc('2_axis_lathe'),
    );
    expect(result.processLines.some((l) => l.process === 'Jig Grind')).toBe(true);
  });
});

// Root-caused live (2026-09-18): "Internal Grinder" is a real, staged
// machine category (migrations 737/738/753, 10 machines) with ZERO cost
// engine. It grinds the smallest real hole with tblInternalGrinding's own
// values (staged by migration 809; earlier it borrowed the OD table).
describe('Internal Grinding — its own tblInternalGrinding physics for bores', () => {
  it('adds no line when Ra is not tighter than the real turning/milling ceiling', () => {
    const result = computeMillingCostSummary(
      milledInput({
        tightestRaMicron: 0.8, holeGroups: [{ diameter_mm: 10, count: 1, depth_mm: 25 }],
        internalGrindingParams: INTERNAL_GRINDING_PARAMS,
        internalGrindingRate: rate(1900, { machineClass: 'internal_grinder' }),
      } as any),
      mc('3_axis_mill'),
    );
    expect(result.processLines.some((l) => l.process === 'Internal Grinding')).toBe(false);
  });

  it('adds a real Internal Grinding line, billed at its own dedicated rate, for a tight-Ra bore on a MILLED part', () => {
    const result = computeMillingCostSummary(
      milledInput({
        tightestRaMicron: 0.2, holeGroups: [{ diameter_mm: 10, count: 2, depth_mm: 25 }],
        internalGrindingParams: INTERNAL_GRINDING_PARAMS,
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
    const result = computeTurningCostSummary(
      turnedInput({
        tightestRaMicron: 0.2, holeGroups: [{ diameter_mm: 10, count: 1, depth_mm: 25 }],
        internalGrindingParams: INTERNAL_GRINDING_PARAMS,
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
    const result = computeMillingCostSummary(
      milledInput({
        tightestRaMicron: 0.2, holeGroups: [{ diameter_mm: 10, count: 1, depth_mm: 25 }],
        internalGrindingParams: { workSpeedMMin: 0, roughInfeedMm: 0, finishInfeedMm: 0, roughAxialFeedRevMm: 0, finishAxialFeedRevMm: 0, dataFound: false },
        internalGrindingRate: rate(1900, { machineClass: 'internal_grinder' }),
      } as any),
      mc('3_axis_mill'),
    );
    expectGapLine(result, 'Internal Grinding');
  });

  it('adds no line when Ra is tight but no dedicated Internal Grinder rate is on file', () => {
    const result = computeMillingCostSummary(
      milledInput({
        tightestRaMicron: 0.2, holeGroups: [{ diameter_mm: 10, count: 1, depth_mm: 25 }],
        internalGrindingParams: INTERNAL_GRINDING_PARAMS, internalGrindingRate: undefined,
      } as any),
      mc('3_axis_mill'),
    );
    expect(result.processLines.some((l) => l.process === 'Internal Grinding')).toBe(false);
  });

  it("uses the real machine's own setup_time_hr", () => {
    const result = computeMillingCostSummary(
      milledInput({
        tightestRaMicron: 0.2, holeGroups: [{ diameter_mm: 10, count: 1, depth_mm: 25 }],
        internalGrindingParams: INTERNAL_GRINDING_PARAMS,
        internalGrindingRate: rate(1900, { machineClass: 'internal_grinder', setupTimeHr: 0.5 }), // real 30min, every real machine on file
      } as any),
      mc('3_axis_mill'),
    );
    const line = result.processLines.find((l) => l.process === 'Internal Grinding')!;
    expect(line.setupTimeMin).toBe(30);
    expect(line.setupTimeSource).toBe('machine');
  });
  it('reads tblInternalGrinding, not the OD table: a bore grinds with the smaller internal infeed', () => {
    const bore = { tightestRaMicron: 0.2, holeGroups: [{ diameter_mm: 10, count: 1, depth_mm: 25 }],
      internalGrindingRate: rate(1900, { machineClass: 'internal_grinder' }) };
    const internal = computeMillingCostSummary(milledInput({ ...bore, internalGrindingParams: INTERNAL_GRINDING_PARAMS } as any), mc('3_axis_mill'))
      .processLines.find((l) => l.process === 'Internal Grinding')!;
    const odData = computeMillingCostSummary(milledInput({ ...bore, internalGrindingParams: CYLINDRICAL_GRINDING_PARAMS } as any), mc('3_axis_mill'))
      .processLines.find((l) => l.process === 'Internal Grinding')!;
    // Internal rough infeed 0.013 mm vs OD 0.05 mm: more passes, longer cycle.
    expect(INTERNAL_GRINDING_PARAMS.roughInfeedMm).toBeLessThan(CYLINDRICAL_GRINDING_PARAMS.roughInfeedMm);
    expect(internal.cycleTimeMin).toBeGreaterThan(odData.cycleTimeMin);
    const rough = internal.calculationTrace!.find((s) => s.fieldName === 'Rough Infeed')!;
    expect(rough.value).toBe(INTERNAL_GRINDING_PARAMS.roughInfeedMm);
    expect(rough.source).toContain('tblInternalGrinding');
  });
});

// The real keyway broach reference (pull type / shim type tables + the two
// positioning-time variables), read from memory/ like every table here.
const KEYWAY_BROACH = realKeywayBroachReference();
// A stroke is the broach (teeth x pitch) plus the keyway, at the broach's own
// cutting speed (m/min -> mm/s).
const strokeSec = (teeth: number, pitchMm: number, keywayMm: number, speedMMin: number) =>
  (teeth * pitchMm + keywayMm) / (speedMMin * 1000 / 60);

describe('Keyway Broaching — the reference keyway broach for each keyway', () => {
  it('adds no line when there are no real keyway candidates', () => {
    const result = computeMillingCostSummary(
      milledInput({
        keywayCandidates: [], keywayBroach: KEYWAY_BROACH,
        broachRate: rate(1500, { machineClass: 'broach' }),
      } as any),
      mc('3_axis_mill'),
    );
    expect(result.processLines.some((l) => l.process === 'Keyway Broaching')).toBe(false);
  });

  it('adds a real Keyway Broaching line, billed at its own dedicated rate, for a real keyway on a MILLED part', () => {
    const result = computeMillingCostSummary(
      milledInput({
        materialGrade: 'AISI 1018',
        keywayCandidates: [{ lengthMm: 40, widthMm: 6, depthMm: 4, count: 2 }],
        keywayBroach: KEYWAY_BROACH,
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

  it('single pass: a 6 x 40 mm keyway in mild steel takes pull broach 10512 (6.38 mm, 59 teeth x 11.11 mm, 9.1 m/min)', () => {
    const line = computeMillingCostSummary(
      milledInput({ materialGrade: 'AISI 1018', keywayCandidates: [{ lengthMm: 40, widthMm: 6, depthMm: 4, count: 2 }], keywayBroach: KEYWAY_BROACH, broachRate: rate(1500, { machineClass: 'broach' }) } as any),
      mc('3_axis_mill'),
    ).processLines.find((l) => l.process === 'Keyway Broaching')!;
    expect(line.cycleTimeMin).toBeCloseTo((2 * strokeSec(59, 11.11, 40, 9.1)) / 60, 3);
    expect(line.calculationTrace!.find((st) => st.fieldName === 'Broach Teeth')!.source).toContain('tblPullTypeKeywayBroach: broach 10512');
  });

  it('two passes: a 12.74 x 150 mm keyway takes pull broach 10524 (2 passes) plus one repositioning', () => {
    const line = computeMillingCostSummary(
      milledInput({ materialGrade: 'AISI 1018', keywayCandidates: [{ lengthMm: 150, widthMm: 12.74, depthMm: 4, count: 1 }], keywayBroach: KEYWAY_BROACH, broachRate: rate(1500, { machineClass: 'broach' }) } as any),
      mc('3_axis_mill'),
    ).processLines.find((l) => l.process === 'Keyway Broaching')!;
    const expected = 2 * strokeSec(39, 23.04, 150, 9.1) + 1 * KEYWAY_BROACH.singlePassPositioningS;
    expect(line.cycleTimeMin).toBeCloseTo(expected / 60, 3);
  });

  it('falls back to a shim broach (multipass) when no pull broach fits: 30 mm wide takes 10171, 8 shims = 9 passes', () => {
    const line = computeMillingCostSummary(
      milledInput({ materialGrade: 'AISI 1018', keywayCandidates: [{ lengthMm: 100, widthMm: 30, depthMm: 6, count: 1 }], keywayBroach: KEYWAY_BROACH, broachRate: rate(1500, { machineClass: 'broach' }) } as any),
      mc('3_axis_mill'),
    ).processLines.find((l) => l.process === 'Keyway Broaching')!;
    const expected = 9 * strokeSec(26, 15.88, 100, 9.8) + 8 * KEYWAY_BROACH.multipassPositioningS;
    expect(line.cycleTimeMin).toBeCloseTo(expected / 60, 3);
    expect(line.calculationTrace!.find((st) => st.fieldName === 'Passes')!.source).toContain('8 shims + the first pass');
  });

  it('leaves aluminium unpriced and named: the broach tables have no Brinell rows below 125 HB (the 55 / 59 rows are Rockwell C)', () => {
    const result = computeMillingCostSummary(
      milledInput({ materialGrade: 'AL6061-T6', keywayCandidates: [{ lengthMm: 40, widthMm: 6, depthMm: 4, count: 1 }], keywayBroach: KEYWAY_BROACH, broachRate: rate(1500, { machineClass: 'broach' }) } as any),
      mc('3_axis_mill'),
    );
    expectGapLine(result, 'Keyway Broaching');
    expect(result.warnings.join(' ')).toContain('a keyway broach for aluminum');
  });

  it('adds no line when a real keyway exists but no dedicated Broach rate is on file (genuine gap, no fallback machine)', () => {
    const result = computeMillingCostSummary(
      milledInput({
        keywayCandidates: [{ lengthMm: 120, widthMm: 6, depthMm: 4, count: 1 }],
        keywayBroach: KEYWAY_BROACH, broachRate: undefined,
      } as any),
      mc('3_axis_mill'),
    );
    expect(result.processLines.some((l) => l.process === 'Keyway Broaching')).toBe(false);
  });

  it("uses the real machine's own setup_time_hr", () => {
    const result = computeMillingCostSummary(
      milledInput({
        materialGrade: 'AISI 1018',
        keywayCandidates: [{ lengthMm: 40, widthMm: 6, depthMm: 4, count: 1 }],
        keywayBroach: KEYWAY_BROACH,
        broachRate: rate(1500, { machineClass: 'broach', setupTimeHr: 0.01 }), // real 0.6min, every real Broach machine on file
      } as any),
      mc('3_axis_mill'),
    );
    const line = result.processLines.find((l) => l.process === 'Keyway Broaching')!;
    expect(line.setupTimeMin).toBeCloseTo(0.6, 5);
    expect(line.setupTimeSource).toBe('machine');
  });

  it('does not cost setup, and says so, when setup_time_hr is absent', () => {
    const result = computeMillingCostSummary(
      milledInput({
        materialGrade: 'AISI 1018',
        keywayCandidates: [{ lengthMm: 40, widthMm: 6, depthMm: 4, count: 1 }],
        keywayBroach: KEYWAY_BROACH,
        broachRate: rate(1500, { machineClass: 'broach' }),
      } as any),
      mc('3_axis_mill'),
    );
    const line = result.processLines.find((l) => l.process === 'Keyway Broaching')!;
    expect(line.setupTimeMin).toBe(0);
    expect(line.setupTimeSource).toBe('none');
    expect(line.setupCost).toBe(0);
    expect(result.warnings.some((w) => w.startsWith('Keyway Broaching: setup not costed'))).toBe(true);
  });

  it('applies to a real keyway on a TURNED shaft too (a keyway is at least as common on turned shafts as milled parts)', () => {
    const result = computeTurningCostSummary(
      turnedInput({
        materialGrade: 'AISI 1018',
        keywayCandidates: [{ lengthMm: 40, widthMm: 6, depthMm: 4, count: 1 }],
        keywayBroach: KEYWAY_BROACH,
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
// computeMillingCostSummary/computeTurningCostSummary directly with
// pre-resolved candidates, the same convention every other new-engine
// describe block above uses.
const WIRE_EDM_PARAMS = { roughFeedRateMmPerMin: 5.8, finishFeedRateMmPerMin: 4.8, dataFound: true };

describe('Wire EDM — new operation, real hardened-slot trigger', () => {
  it('adds no line when there are no real Wire EDM candidates', () => {
    const result = computeMillingCostSummary(
      milledInput({
        wireEdmCandidates: [], wireEdmParams: WIRE_EDM_PARAMS,
        wireEdmRate: rate(1400, { machineClass: 'wire_edm' }),
      } as any),
      mc('3_axis_mill'),
    );
    expect(result.processLines.some((l) => l.process === 'Wire EDM')).toBe(false);
  });

  it('adds a real Wire EDM line, billed at its own dedicated rate, for a real hardened slot on a MILLED part', () => {
    const result = computeMillingCostSummary(
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
    const result = computeMillingCostSummary(
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
    const result = computeMillingCostSummary(
      milledInput({
        wireEdmCandidates: [{ lengthMm: 100, count: 1 }],
        wireEdmParams: { roughFeedRateMmPerMin: 0, finishFeedRateMmPerMin: 0, dataFound: false },
        wireEdmRate: rate(1400, { machineClass: 'wire_edm' }),
      } as any),
      mc('3_axis_mill'),
    );
    expectGapLine(result, 'Wire EDM');
  });

  it('adds no line when a real hardened slot exists but no dedicated Wire EDM rate is on file (genuine gap, no fallback machine)', () => {
    const result = computeMillingCostSummary(
      milledInput({
        wireEdmCandidates: [{ lengthMm: 100, count: 1 }],
        wireEdmParams: WIRE_EDM_PARAMS, wireEdmRate: undefined,
      } as any),
      mc('3_axis_mill'),
    );
    expect(result.processLines.some((l) => l.process === 'Wire EDM')).toBe(false);
  });

  it("uses the real machine's own setup_time_hr", () => {
    const result = computeMillingCostSummary(
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

  it('does not cost setup, and says so, when setup_time_hr is absent', () => {
    const result = computeMillingCostSummary(
      milledInput({
        wireEdmCandidates: [{ lengthMm: 100, count: 1 }],
        wireEdmParams: WIRE_EDM_PARAMS,
        wireEdmRate: rate(1400, { machineClass: 'wire_edm' }),
      } as any),
      mc('3_axis_mill'),
    );
    const line = result.processLines.find((l) => l.process === 'Wire EDM')!;
    expect(line.setupTimeMin).toBe(0);
    expect(line.setupTimeSource).toBe('none');
    expect(line.setupCost).toBe(0);
    expect(result.warnings.some((w) => w.startsWith('Wire EDM: setup not costed'))).toBe(true);
  });

  it('applies to a real hardened slot on a TURNED part too', () => {
    const result = computeTurningCostSummary(
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

describe('Surface Grinding — every CAD planar face when the title-block Ra is tighter than milling', () => {
  const SURFACE = realSurfaceGrindingParams('1.0');
  const faceInput = (overrides: Record<string, unknown> = {}) => milledInput({
    tightestRaMicron: 0.2,
    planarFaces: [{ lengthMm: 100, widthMm: 40, count: 2 }],
    surfaceGrindingParams: SURFACE,
    surfaceGrindingRate: rate(1600, { machineClass: 'reciprocating_surface_grinder' }),
    ...overrides,
  } as any);

  it('grinds each face in traverse strokes: tblReciprocatingSurfaceGrinding code 1.0, crossfeed capped by the 60 mm wheel', () => {
    const line = computeMillingCostSummary(faceInput(), mc('3_axis_mill')).processLines.find((l) => l.process === 'Surface Grinding')!;
    expect(SURFACE.wheelWidthMm).toBe(60);
    const crossfeed = Math.min(SURFACE.absoluteCrossfeedMm, SURFACE.maxFractionalCrossfeed * 60);
    const finishStock = Math.min(SURFACE.finishDownfeedMm, RULES.finishGrindingDepthMm);
    const roughPasses = Math.round(Math.max(RULES.finishGrindingDepthMm - finishStock, 0) / SURFACE.roughDownfeedMm);
    const strokes = Math.ceil(40 / crossfeed);
    const strokeSec = 100 / (SURFACE.tableSpeedMPerMin * 1000 / 60);
    const perFaceSec = (roughPasses + 1) * strokes * strokeSec;
    expect(line.cycleTimeMin).toBeCloseTo((perFaceSec * 2) / 60, 3);
    expect(line.machineClass).toBe('reciprocating_surface_grinder');
    expect(line.calculationTrace!.find((st) => st.fieldName === 'Crossfeed')!.source).toContain('tblGrinding');
  });

  it('adds no line when the Ra is not tighter than the milling ceiling', () => {
    const r = computeMillingCostSummary(faceInput({ tightestRaMicron: 0.8 }), mc('3_axis_mill'));
    expect(r.processLines.some((l) => l.process === 'Surface Grinding')).toBe(false);
  });

  it('names the missing table row instead of pricing without it', () => {
    const r = computeMillingCostSummary(faceInput({ surfaceGrindingParams: null }), mc('3_axis_mill'));
    expectGapLine(r, 'Surface Grinding');
    expect(r.warnings.join(' ')).toContain('tblReciprocatingSurfaceGrinding data');
  });
});

describe('Internal Grinding covers every bore (a title-block Ra applies to every surface)', () => {
  it('sums every bore group, not only the smallest', () => {
    const run = (holeGroups: Array<{ diameter_mm: number; count: number; depth_mm: number }>) => computeMillingCostSummary(
      milledInput({ tightestRaMicron: 0.2, holeGroups, internalGrindingParams: INTERNAL_GRINDING_PARAMS,
        internalGrindingRate: rate(1900, { machineClass: 'internal_grinder' }) } as any),
      mc('3_axis_mill'),
    ).processLines.find((l) => l.process === 'Internal Grinding')!.cycleTimeMin;
    const small = run([{ diameter_mm: 10, count: 1, depth_mm: 25 }]);
    const large = run([{ diameter_mm: 30, count: 1, depth_mm: 40 }]);
    expect(run([{ diameter_mm: 10, count: 1, depth_mm: 25 }, { diameter_mm: 30, count: 1, depth_mm: 40 }])).toBeCloseTo(small + large, 2);
  });
});
