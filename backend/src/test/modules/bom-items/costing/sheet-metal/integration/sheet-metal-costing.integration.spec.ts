import { computeCostSummary, type CostEngineInput, type MHRRateInput } from '../../../../../../modules/bom-items/costing/shared/core/cost-engine';
import { computeNesting } from '../../../../../../modules/bom-items/costing/sheet-metal/machine/sheet-metal-nesting.engine';
import { computePressStrokeCost } from '../../../../../../modules/bom-items/costing/sheet-metal/process/press-stroke-engine';

// Inputs -> nesting -> cost summary with the real engines (no mocks). Only the
// calculator-resolved cycle seconds are supplied, exactly as resolvePhysicsQuantity
// hands them to computeCostSummary in production.

const rate = (value: number, machineClass: string, extra: Partial<MHRRateInput> = {}): MHRRateInput => ({
  rate: value, source: 'mhr_database', machineClass, machineName: `T ${machineClass}`, commodityCode: null, labourRate: 12, ...extra,
});

const SHEET = [{ widthMm: 1250, lengthMm: 2500 }];
const DENSITY = 7850;

function build(args: { lengthMm: number; widthMm: number; thicknessMm: number; bends: number; batch: number; laserSec: number; bendSec: number }): CostEngineInput {
  const area = args.lengthMm * args.widthMm;
  const netKg = (area * args.thicknessMm) / 1e9 * DENSITY;
  const nestingResult = computeNesting({
    flatPatternLengthMm: args.lengthMm, flatPatternWidthMm: args.widthMm, thicknessMm: args.thicknessMm,
    netWeightKg: netKg, densityKgM3: DENSITY, materialPricePerKg: 1.2, scrapPricePerKg: 0.3, scrapRecoveryPct: 0.9,
    partAllowanceMm: 2, quantityRequired: args.batch, sheets: SHEET,
  });
  return {
    sheetThicknessMm: args.thicknessMm,
    cutLengthMm: 2 * (args.lengthMm + args.widthMm) + 150,
    pierceCount: 3,
    bendCount: args.bends,
    flatPatternAreaMm2: area,
    holeCount: 2,
    materialGrade: 'CRCA',
    materialCostPerKg: 1.2,
    materialDensityKgM3: DENSITY,
    materialSource: 'db',
    threads: [],
    batchSize: args.batch,
    family: 'sheet_metal',
    location: 'USA',
    directLaborRatePerHr: 12,
    qaInspectorRatePerHr: 20,
    samplingRate: 0.1,
    inspectionTimeMin: 0.5,
    yieldPct: 0.98,
    scrapPricePerKg: 0.3,
    nestingResult,
    laserCycleTimeSecFromCalculator: args.laserSec,
    pressBrakeCycleTimeSecFromCalculator: args.bends > 0 ? args.bendSec : undefined,
    pressBrakeSetupTimeMinFromCalculator: args.bends > 0 ? 30 / args.batch : undefined,
    deburrCycleTimeSecFromCalculator: 20,
    mhrRates: {
      laser: rate(26.47, 'fiber_laser', { setupTimeHr: 0.25 }),
      pressBrake: rate(18.39, 'press_brake'),
      deburring: rate(5.45, 'deburring'),
      tapping: rate(10, 'tapping'),
    },
  } as CostEngineInput;
}

const flatLaser = (batch = 100) => build({ lengthMm: 300, widthMm: 200, thicknessMm: 2, bends: 0, batch, laserSec: 40, bendSec: 0 });
const bracket = (batch = 100) => build({ lengthMm: 400, widthMm: 150, thicknessMm: 2, bends: 4, batch, laserSec: 55, bendSec: 48 });

function assertSane(result: ReturnType<typeof computeCostSummary>) {
  const numbers = [result.materialCost, result.totalProcessCost, result.totalCost, result.grossWeightKg,
    ...result.processLines.flatMap((l) => [l.setupCost, l.runCost, l.totalCost, l.cycleTimeMin, l.hourlyRate])];
  for (const n of numbers) {
    expect(Number.isFinite(n)).toBe(true);
    expect(n).toBeGreaterThanOrEqual(0);
  }
  // Roll-up: total = material + process, within cent rounding of the rounded lines.
  const lineSum = result.processLines.reduce((s, l) => s + l.totalCost, 0);
  expect(Math.abs(result.totalProcessCost - lineSum)).toBeLessThanOrEqual(0.005 * result.processLines.length + 1e-9);
  expect(Math.abs(result.totalCost - (result.materialCost + result.totalProcessCost))).toBeLessThanOrEqual(0.0101);
  for (const l of result.processLines) {
    // inspection and yield loss are added on top of setup + run, never subtracted
    expect(l.totalCost).toBeGreaterThanOrEqual(l.setupCost + l.runCost - 0.0101);
  }
}

describe('sheet metal costing — inputs to cost summary', () => {
  it('flat laser part: laser + deburring only, material from the real nest', () => {
    const r = computeCostSummary(flatLaser());
    assertSane(r);
    const names = r.processLines.map((l) => l.process);
    expect(names).toContain('Laser Cutting');
    expect(names).not.toContain('Press Brake');
    // 300x200 on 1250x2500 at 2 mm: gross weight per part = sheet weight / parts per sheet.
    const nest = flatLaser().nestingResult!;
    expect(r.grossWeightKg).toBeCloseTo(nest.grossWeightPerPartKg, 3);
    expect(r.materialCost).toBeCloseTo(nest.netMaterialCost, 2);
    expect(nest.sheetWeightKg).toBeCloseTo(1.25 * 2.5 * 2 * 7.85, 2);
  });

  it('bent bracket: adds a press brake line whose cost follows the calculator cycle and per-piece setup', () => {
    const flat = computeCostSummary(flatLaser());
    const r = computeCostSummary(bracket());
    assertSane(r);
    const pb = r.processLines.find((l) => l.process === 'Press Brake')!;
    expect(pb).toBeDefined();
    expect(pb.cycleTimeMin).toBeCloseTo(48 / 60, 3);
    // 30 min tool loading over the lot of 100, at machine 18.39 + labour 12 per hour.
    expect(pb.setupTimeMin).toBeCloseTo(30, 6);
    expect(pb.setupCost).toBeCloseTo((0.3 / 60) * (18.39 + 12), 2);
    expect(r.totalProcessCost).toBeGreaterThan(flat.totalProcessCost);
  });

  it('stamped part: press stroke cycle and setup amortise over the lot', () => {
    const press: MHRRateInput = rate(40, 'standard_press', { pressCycleTimeS: 1.2, handlingConstS: 1.5, handlingMassCoeffSPerKg: 3, setupTimeHr: 0.5 });
    const at = (batchSize: number) => computePressStrokeCost('Standard Press', 'standard_press', {
      numberOfStrokes: 1, batchSize, partWeightKg: 0.2, pressRate: press, dlrPerHr: 12, yieldPct: 0.98, netMatCost: 0.5, netWeightKg: 0.2, scrapPricePerKg: 0.3,
    });
    const small = at(100).processLines[0]!;
    const large = at(10_000).processLines[0]!;
    expect(at(100).cuttingMin).toBeCloseTo((1.2 + 1.5 + 3 * 0.2) / 60, 9);
    expect(large.setupCost).toBeLessThan(small.setupCost);
    expect(large.totalCost).toBeGreaterThan(0);
    for (const l of [small, large]) for (const n of [l.setupCost, l.runCost, l.totalCost]) {
      expect(Number.isFinite(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(0);
    }
  });

  it('per-part cost does not increase with batch size (setup amortisation), material unchanged', () => {
    for (const make of [flatLaser, bracket]) {
      let prevProcess = Infinity;
      for (const batch of [10, 50, 100, 500, 2000]) {
        const input = make(batch);
        const r = computeCostSummary(input);
        assertSane(r);
        expect(r.totalProcessCost).toBeLessThanOrEqual(prevProcess + 0.01);
        prevProcess = r.totalProcessCost;
      }
    }
  });

  it('is deterministic: identical inputs give identical output', () => {
    expect(computeCostSummary(bracket())).toEqual(computeCostSummary(bracket()));
  });
});
