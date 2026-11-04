import { eMithranTerms } from '../../../../../../modules/bom-items/costing/shared/core/engine-kernel';
import { estimateBendTonnage, recommendedBendTonnage } from '../../../../../../modules/bom-items/costing/shared/core/default-rates.constants';
import { computePressBrakeCost } from '../../../../../../modules/bom-items/costing/sheet-metal/process/press-brake-engine';
import { computeLaserCuttingCost } from '../../../../../../modules/bom-items/costing/sheet-metal/process/laser-cutting-engine';
import { computePressStrokeCost } from '../../../../../../modules/bom-items/costing/sheet-metal/process/press-stroke-engine';
import type { MHRRateInput } from '../../../../../../modules/bom-items/costing/shared/core/cost-engine';

// Hand-calculated from Sheet-Metal-Cost-Model-Algorithm.md section 3.3 / 4 / 5.3.
// Yield 100 %, no scrap, so only machine + setup + labour + inspection remain.
const noYieldLoss = { yieldPct: 1, netMatCost: 0, netWeightKg: 0, scrapPricePerKg: 0 };

describe('eMithranTerms — reference cost elements', () => {
  it('laser cutting NR-528064_A: machine 2.30, setup 2.77, labour 0.59, inspection 0.02', () => {
    const t = eMithranTerms({
      mhrPerHr: 26.47, dlrPerHr: 13.55, qairPerHr: 19.67, setupNDL: 0.5, cycleNDL: 0.5,
      cycleTimeMin: 312.6 / 60, setupTimeMin: 5.0, inspTimeMin: 5.0, samplingRate: 0.01, ...noYieldLoss,
    });
    expect(t.machineCost).toBeCloseTo(312.6 / 3600 * 26.47, 6);   // 2.2985
    expect(t.machineCost).toBeCloseTo(2.30, 2);
    expect(t.setupCost).toBeCloseTo((5 / 60) * (26.47 + 13.55 * 0.5), 6);
    expect(t.setupCost).toBeCloseTo(2.77, 2);
    expect(t.laborCost).toBeCloseTo(0.59, 2);
    expect(t.inspCost).toBeCloseTo(0.016, 3);
    expect(t.yieldCost).toBe(0);
    expect(t.total).toBeCloseTo(t.machineCost + t.setupCost + t.laborCost + t.inspCost, 9);
  });

  it('bending NR-528064_A: machine 0.98, labour 0.72, setup 0.16 (30 min die loading / lot 100), inspection 0.02', () => {
    const t = eMithranTerms({
      mhrPerHr: 18.39, dlrPerHr: 13.55, qairPerHr: 19.67, setupNDL: 1, cycleNDL: 1,
      cycleTimeMin: 192 / 60, setupTimeMin: 30 / 100, inspTimeMin: 5, samplingRate: 0.01, ...noYieldLoss,
    });
    expect(t.machineCost).toBeCloseTo(0.98, 2);
    expect(t.laborCost).toBeCloseTo(0.72, 2);
    expect(t.setupCost).toBeCloseTo(0.16, 2);
    expect(t.inspCost).toBeCloseTo(0.016, 3);
  });

  it('manual debur NR-528058_0: machine 0.015, labour 0.031, setup 0.0139, inspection 0.0066', () => {
    const t = eMithranTerms({
      mhrPerHr: 5.45, dlrPerHr: 11.17, qairPerHr: 19.67, setupNDL: 1, cycleNDL: 1,
      cycleTimeMin: 10 / 60, setupTimeMin: 0.05, inspTimeMin: 2, samplingRate: 0.01, ...noYieldLoss,
    });
    expect(t.machineCost).toBeCloseTo(0.0151, 3);
    expect(t.laborCost).toBeCloseTo(0.0310, 3);
    expect(t.setupCost).toBeCloseTo(0.0139, 3);
    expect(t.inspCost).toBeCloseTo(0.0066, 3);
    expect(t.total).toBeCloseTo(0.07, 2);
  });

  it('yield loss is (1 - yield) x (material + machine + setup + labour + inspection), 0 at 100 %', () => {
    const t = eMithranTerms({
      mhrPerHr: 60, dlrPerHr: 0, qairPerHr: 0, setupNDL: 1, cycleNDL: 1,
      cycleTimeMin: 1, setupTimeMin: 0, inspTimeMin: 0, samplingRate: 0,
      yieldPct: 0.9, netMatCost: 10, netWeightKg: 0, scrapPricePerKg: 0,
    });
    expect(t.yieldCost).toBeCloseTo(0.1 * (10 + 1), 9);
  });
});

describe('press brake tonnage — section 5.1', () => {
  it('equals the reference formula with the engine\'s 8 x t shoulder width', () => {
    // NR-528064_A: coefficient 1.33, UTS 440, L 1222.4, t 1.5. Reference uses shoulder 25 -> 6.56 t.
    // The engine uses V = 8 t = 12 mm, so the force scales by 25/12: 6.56 x 25/12 = 13.67 t.
    const theoretical = estimateBendTonnage(440, 1.5, 1222.4)!;
    expect(theoretical).toBeCloseTo((1.33 * 440 * 1222.4 * 1.5 ** 2) / (12 * 9810), 2);
    expect(theoretical * 12 / 25).toBeCloseTo(6.56, 1);
    expect(recommendedBendTonnage(440, 1.5, 1222.4)).toBeCloseTo(theoretical * 1.25, 1);
  });

  it('is null (not 0) when an input is missing', () => {
    expect(estimateBendTonnage(null, 1.5, 100)).toBeNull();
    expect(estimateBendTonnage(440, 0, 100)).toBeNull();
    expect(estimateBendTonnage(440, 1.5, 0)).toBeNull();
  });
});

const brakeRate: MHRRateInput = {
  rate: 18.39, source: 'mhr_database', machineClass: 'press_brake', machineName: 'PB', commodityCode: null, labourRate: 13.55,
};

describe('computePressBrakeCost — setup amortisation', () => {
  it('the calculator setup is already per piece: not divided by the lot a second time', () => {
    // 0.30 min/piece at lot 100 = 30 min die loading. Setup cost per piece = 0.30/60 x (18.39 + 13.55).
    const r = computePressBrakeCost({
      bendCount: 16, batchSize: 100, rate: brakeRate,
      cycleTimeSecFromCalculator: 192, setupTimeMinFromCalculator: 0.3,
      yieldPct: 1, samplingRate: 0, inspTimeMin: 0,
    });
    const line = r.processLines[0]!;
    expect(line.setupTimeMin).toBeCloseTo(30, 6);
    expect(line.setupCost).toBeCloseTo(0.16, 2);
    expect(line.runCost).toBeCloseTo(0.98 + 0.72, 2);
  });
});

describe('batch amortisation of per-batch setup', () => {
  const laserRate: MHRRateInput = { rate: 26.47, source: 'mhr_database', machineClass: 'fiber_laser', machineName: 'L', commodityCode: null, labourRate: 13.55, operators: 0.5 };
  it('laser setup cost per part falls as 1/batch while run cost is unchanged', () => {
    const at = (batchSize: number) => computeLaserCuttingCost({
      cutLengthMm: 1000, pierceCount: 2, batchSize, grade: 'CRCA', sheetThicknessMm: 1.5, laserRate,
      cuttingSecFromCalculator: 312.6, setupMin: 500, yieldPct: 1,
    }).processLines[0]!;
    const a = at(100), b = at(200);
    expect(b.setupCost).toBeCloseTo(a.setupCost / 2, 2);
    expect(b.runCost).toBeCloseTo(a.runCost, 6);
  });
});

describe('computePressStrokeCost — stamping cycle', () => {
  it('cycle = (strokes x press cycle time + handling const + coeff x weight) / 60', () => {
    const rate: MHRRateInput = {
      rate: 60, source: 'mhr_database', machineClass: 'standard_press', machineName: 'P', commodityCode: null,
      pressCycleTimeS: 1.5, handlingConstS: 2, handlingMassCoeffSPerKg: 4, setupTimeHr: 0.5,
    };
    const r = computePressStrokeCost('Standard Press', 'standard_press', {
      numberOfStrokes: 1, batchSize: 1000, partWeightKg: 0.5, pressRate: rate, yieldPct: 1,
    });
    expect(r.cuttingMin).toBeCloseTo((1.5 + 2 + 4 * 0.5) / 60, 9);
    const line = r.processLines[0]!;
    expect(line.setupTimeMin).toBeCloseTo(30, 9);
    expect(line.setupCost).toBeCloseTo((60 / 60) * (30 / 1000), 4);
  });
});
