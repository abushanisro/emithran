// Hand-calculated checks of the machining cost chain against the reference
// data (memory/Machining, memory/Stock Maching), an end-to-end run through the
// real calculators, and regressions for the defects the audit found.
import {
  computeDrillCycle,
  computeMillingCostSummary,
  computeTurningCostSummary,
  detectMaterialClass,
  type MachineClassId,
  type MachiningCostInput,
} from '../../../../../../modules/bom-items/costing/machining/process/cost-machining-engine';
import { specAsCalculators } from '../../../../../../modules/bom-items/costing/machining/calculators/machining-calculator-spec';
import type { MHRRateInput } from '../../../../../../modules/bom-items/costing/shared/core/cost-engine';
import {
  realCapabilityRules, realDrillingTable, realPartoffTable, realRotaryBroachReference, realTappingTable,
} from '../real-reference-tables';

const CALCS = specAsCalculators();
const DRILLING = realDrillingTable();
const mc = (v: string): MachineClassId => v as MachineClassId;

function rate(value: number, o: Partial<MHRRateInput> = {}): MHRRateInput {
  return { rate: value, source: 'mhr_database', machineClass: '3_axis_mill', machineName: 'Test VMC', commodityCode: 'X', ...o };
}

function input(o: Partial<MachiningCostInput> = {}): MachiningCostInput {
  return {
    volume: 40_000, surfaceArea: 20_000, maxLength: 100, maxWidth: 50, maxHeight: 20,
    holeCount: 0, holeGroups: [], pocketCount: 0,
    materialGrade: 'AISI 1018', materialCostPerKg: 80, materialDensityKgM3: 7850, materialSource: 'db',
    threads: [], tightestToleranceMm: null, gdtFeatureCount: 0, batchSize: 10, family: 'milled',
    finishedWeightKg: 0.3,
    mhrRate: rate(600), tappingRate: rate(600, { machineClass: 'tapping' }),
    deburrRate: rate(300, { machineClass: 'deburring', machineName: null }),
    inspectionRate: rate(450, { machineClass: 'cmm', machineName: null, commodityCode: null }),
    surfaceTreatment: null, machiningCalculators: CALCS, capabilityRules: realCapabilityRules(), location: 'India',
    ...o,
  };
}

// ── Reference values, read off the staged CSVs ──────────────────────────────
// tblDrilling, material code 1.0 (125 HB, the mild-steel row): solid-drill
// cutting speed 86.0 m/min; feed 0.145 mm/rev at the 19.9 mm breakpoint.
const DRILL_SPEED = 86.0;
const DRILL_FEED_AT_19_9 = 0.145;

describe('hand-calculated cost chain', () => {
  it('drilling: 3 holes of Ø19.9 x 40 mm = depth / (rpm x feed) x 60 x holes (tblDrilling 1.0)', () => {
    const rpm = (DRILL_SPEED * 1000) / (Math.PI * 19.9);
    const expectedSec = (40 / (rpm * DRILL_FEED_AT_19_9)) * 60 * 3;
    const cycle = computeDrillCycle(19.9, 'AISI 1018', 40, DRILLING, CALCS, 3);
    expect(cycle.missing).toEqual([]);
    expect(cycle.sec).toBeCloseTo(expectedSec, 6);
  });

  it('material: bbox billet + 2 x stock allowance per side, weight x price (no markup)', () => {
    const bare = computeMillingCostSummary(input({ stockAllowancePerSideMm: 0 }), mc('3_axis_mill'));
    // 100 x 50 x 20 mm = 1e5 mm3 = 1e-4 m3 x 7850 = 0.785 kg x 80 = 62.80
    expect(bare.materialRemoval!.billetWeightKg).toBeCloseTo(0.785, 3);
    expect(bare.materialCost).toBeCloseTo(62.8, 2);
    // 2 mm per side: 104 x 54 x 24 = 134 784 mm3 -> 1.058 kg (r3) x 80 = 84.64
    const allowed = computeMillingCostSummary(input({ stockAllowancePerSideMm: 2 }), mc('3_axis_mill'));
    expect(allowed.materialRemoval!.billetWeightKg).toBeCloseTo(1.058, 3);
    expect(allowed.materialCost).toBeCloseTo(84.64, 2);
  });

  it('setup: machine setup_time_hr x rate / batch, plus the fixture / batch; run = cycle x 1.15 x rate', () => {
    const result = computeMillingCostSummary(input({
      stockAllowancePerSideMm: 0, batchSize: 10, fixtureUnitCostLocal: 100,
      mhrRate: rate(600, { setupTimeHr: 0.5 }),
      featureOps: [{ name: 'Rough Mill', timeSec: 600, source: 't' }, { name: 'Tapping', timeSec: 999, source: 't' }],
    }), mc('3_axis_mill'));
    const line = result.processLines.find((l) => l.process === '3 Axis Mill')!;
    // 30 min / 10 parts = 3 min x 600/h = 30.00, + fixture 100 / 10 = 10.00
    expect(line.setupCost).toBeCloseTo(40, 2);
    expect(line.setupTimeMin).toBe(30);
    // 600 s = 10 min x 1.15 = 11.5 min (Tapping is billed on its own line, not here) x 600/h = 115.00
    expect(line.cycleTimeMin).toBeCloseTo(11.5, 4);
    expect(line.runCost).toBeCloseTo(115, 2);
    expect(line.totalCost).toBeCloseTo(155, 2);
  });

  it('turning: rough passes = round((bar - part)/2 - finish depth) / rough depth), finish = one pass (tblGeneralTurning 1.0)', () => {
    const p = {
      roughCutDepthMm: 1.3, roughCuttingSpeedMPerMin: 250.4, roughFeedMmPerRev: 0.3625,
      finishCutDepthMm: 0.8, finishCuttingSpeedMPerMin: 333.1, finishFeedMmPerRev: 0.29, dataFound: true,
    };
    const result = computeTurningCostSummary(input({
      family: 'turned', maxLength: 80, maxWidth: 32, maxHeight: 32, volume: 50_000,
      mhrRate: rate(900, { machineClass: '2_axis_lathe' }),
      blankResult: { form: 'round_bar', sizeLabel: 'Ø40', barDiameterMm: 40, billetVolMm3: Math.PI * 20 ** 2 * 80, utilizationPct: 50 },
      turningParams: p, partoffTable: realPartoffTable(),
    }), mc('2_axis_lathe'));
    const pass = (v: number, f: number) => (80 / (((v * 1000) / (Math.PI * 32)) * f)) * 60;
    // radial 4 mm - finish 0.8 = 3.2 mm rough stock / 1.3 = 2.46 -> 2 passes
    const rough = result.processLines.find((l) => l.process === 'Rough Turning')!;
    const finish = result.processLines.find((l) => l.process === 'Finish Turning')!;
    expect(rough.cycleTimeMin).toBeCloseTo((2 * pass(250.4, 0.3625)) / 60, 3);
    expect(finish.cycleTimeMin).toBeCloseTo(pass(333.1, 0.29) / 60, 3);
    expect(rough.runCost).toBeCloseTo(((2 * pass(250.4, 0.3625)) / 60 / 60) * 900, 1);
  });
});

describe('detectMaterialClass', () => {
  it.each([
    ['AL6061-T6', 'aluminum'], ['Aluminium 6082', 'aluminum'], ['Aluminum 5083', 'aluminum'], ['AL6063', 'aluminum'],
    ['EN AW-6082', 'aluminum'], ['Al 7050', 'aluminum'],
    ['Brass C360', 'copper_alloy'], ['C36000', 'copper_alloy'], ['Bronze', 'copper_alloy'], ['Copper C110', 'copper_alloy'],
    ['SS304', 'stainless'], ['AISI 316L', 'stainless'], ['AISI 304L', 'stainless'], ['Stainless Steel 304', 'stainless'],
    ['Ti-6Al-4V', 'titanium'], ['AISI 1018', 'mild_steel'], ['AISI 4140', 'mild_steel'],
    ['Delrin', 'plastic'], ['HDPE', 'plastic'], ['A2 tool steel', 'tool_steel'],
  ])('%s -> %s', (grade, cls) => {
    expect(detectMaterialClass(grade)).toBe(cls);
  });
});

describe('regression: rotary broaching shares the part machine, so its setup is charged once', () => {
  it('the broaching line carries no second setup of the primary machine', () => {
    const result = computeMillingCostSummary(input({
      stockAllowancePerSideMm: 0, batchSize: 10,
      mhrRate: rate(600, { setupTimeHr: 0.5 }),
      featureOps: [{ name: 'Rough Mill', timeSec: 600, source: 't' }],
      drillingTable: DRILLING,
      polygons: [{ kind: 'socket', sides: 6, acrossFlatsMm: 10, depthMm: 5, count: 1 }],
      rotaryBroach: realRotaryBroachReference(),
    }), mc('3_axis_mill'));
    const broach = result.processLines.find((l) => l.process === 'Rotary Broaching')!;
    expect(broach).toBeDefined();
    expect(broach.setupCost).toBe(0);
    expect(broach.runCost).toBeGreaterThan(0);
    // The one setup is on the primary line: 30 min / 10 x 600/h.
    expect(result.processLines.find((l) => l.process === '3 Axis Mill')!.setupCost).toBeCloseTo(30, 2);
    const setups = result.processLines.filter((l) => l.setupCost > 0 && l.machineName === 'Test VMC');
    expect(setups).toHaveLength(1);
  });
});

// ── End to end: inputs -> real calculators -> cost summary ──────────────────
const milled = (batchSize: number) => input({
  batchSize, stockAllowancePerSideMm: 2, volume: 40_000,
  holeCount: 6, holeGroups: [{ diameter_mm: 8, count: 4, depth_mm: 20 }, { diameter_mm: 5, count: 2, depth_mm: 12 }],
  threads: [{ size: 'M6', count: 2, depthMm: 10 }],
  tightestToleranceMm: 0.1, sharpEdgeLengthMm: 900, deburrLinearSpeedMmPerSec: 5,
  drillingTable: DRILLING, tappingTable: realTappingTable(),
  mhrRate: rate(600, { setupTimeHr: 0.5 }),
  inspectionRate: rate(450, { machineClass: 'cmm', setupTimeHr: 0.25, machineName: 'CMM' }),
  tappingRate: rate(600, { machineClass: 'tapping', hostMachineClass: '3_axis_mill' }),
  featureOps: [{ name: 'Rough Mill', timeSec: 420, source: 't' }, { name: 'Finish Mill', timeSec: 180, source: 't' }],
});

const turned = (batchSize: number) => input({
  batchSize, family: 'turned', maxLength: 80, maxWidth: 32, maxHeight: 32, volume: 50_000,
  holeCount: 1, holeGroups: [{ diameter_mm: 8, count: 1, depth_mm: 30 }],
  drillingTable: DRILLING, partoffTable: realPartoffTable(), sharpEdgeLengthMm: 400, deburrLinearSpeedMmPerSec: 5,
  mhrRate: rate(900, { machineClass: '2_axis_lathe', setupTimeHr: 0.5 }),
  inspectionRate: rate(450, { machineClass: 'cmm', setupTimeHr: 0.25, machineName: 'CMM' }),
  blankResult: { form: 'round_bar', sizeLabel: 'Ø40', barDiameterMm: 40, billetVolMm3: Math.PI * 20 ** 2 * 80, utilizationPct: 50 },
  turningParams: {
    roughCutDepthMm: 1.3, roughCuttingSpeedMPerMin: 250.4, roughFeedMmPerRev: 0.3625,
    finishCutDepthMm: 0.8, finishCuttingSpeedMPerMin: 333.1, finishFeedMmPerRev: 0.29, dataFound: true,
  },
});

const cases: Array<[string, (b: number) => MachiningCostInput, (i: MachiningCostInput) => ReturnType<typeof computeMillingCostSummary>]> = [
  ['milled', milled, (i) => computeMillingCostSummary(i, mc('3_axis_mill'))],
  ['turned', turned, (i) => computeTurningCostSummary(i, mc('2_axis_lathe'))],
];

describe.each(cases)('%s part, inputs to cost summary', (_name, build, run) => {
  const summary = run(build(10));

  it('breakdown sums to the total and every figure is finite and non-negative', () => {
    expect(summary.processLines.length).toBeGreaterThan(2);
    for (const l of summary.processLines) {
      for (const v of [l.setupCost, l.runCost, l.totalCost, l.cycleTimeMin]) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
      }
      expect(l.totalCost).toBeCloseTo(l.setupCost + l.runCost, 2);
    }
    expect(summary.totalProcessCost).toBeCloseTo(summary.processLines.reduce((s, l) => s + l.totalCost, 0), 1);
    expect(summary.totalCost).toBeCloseTo(summary.materialCost + summary.totalProcessCost, 1);
    expect(summary.materialCost).toBeGreaterThan(0);
    expect(summary.totalProcessCost).toBeGreaterThan(0);
    expect(summary.materialRemoval!.utilizationPct).toBeGreaterThan(0);
    expect(summary.materialRemoval!.utilizationPct).toBeLessThanOrEqual(100);
    expect(JSON.stringify(summary)).not.toMatch(/NaN|Infinity/);
  });

  it('is deterministic', () => {
    expect(JSON.stringify(run(build(10)))).toBe(JSON.stringify(summary));
  });

  it('never gets dearer as the batch grows; material is batch-independent', () => {
    const totals = [1, 10, 100, 1000].map((b) => run(build(b)));
    for (let i = 1; i < totals.length; i++) {
      expect(totals[i]!.totalCost).toBeLessThanOrEqual(totals[i - 1]!.totalCost + 0.01);
      expect(totals[i]!.materialCost).toBe(totals[0]!.materialCost);
    }
    expect(totals[0]!.totalCost).toBeGreaterThan(totals[3]!.totalCost);
  });
});
