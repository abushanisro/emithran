import { defined, machine } from './forging-fixtures';
import { FORGING_STEPS, forgingGapLine, priceForgingLine, type CostContext } from '../../../../../modules/bom-items/costing/forging/forging-line';

// The line structure only: capability and cycle time are the caller's. The
// 10 s cycle below is a TEST INPUT to check the arithmetic, not a forging
// cycle (no press cycle formula is in memory, v1.1 6.8).
const TEST_CYCLE_S = 10;
// Line terms only: no inspection, no yield loss, no material in the line.
const ctx: CostContext = {
  qairPerHr: 0, inspTimeMin: 0, samplingRate: 0, yieldPct: 1, netMatCost: 0, netWeightKg: 0, scrapPricePerKg: 0,
};
// memory/Forging/Machine/forging_machines_press.csv (migration 824):
//   Lasco KFP 1000: Direct OH 104.38 + Indirect OH 32.42 = MHR 136.80 USD/h, labour 36.30 USD/h, 0.33 operators, setup 0.50 h
//   Lasco KFP 1200: Direct OH 112.01 + Indirect OH 33.55 = MHR 145.56 USD/h, labour 36.30 USD/h, 0.33 operators, setup 0.50 h
const kfp1000 = machine('forging_machines_press.csv', 'Lasco KFP 1000', 'forging_press');
const kfp1200 = machine('forging_machines_press.csv', 'Lasco KFP 1200', 'forging_press');

describe('forging line cost structure', () => {
  it('prices a machine through eMithranTerms with setup spread over the batch (hand check)', () => {
    expect(kfp1000.machineRatePerHr).toBeCloseTo(136.8, 9);
    const { ok, line } = priceForgingLine({
      step: FORGING_STEPS.press, criteria: ['test'], batchSize: 1000, costContext: ctx,
      candidates: [{ machine: kfp1000, reasons: [], cycleTimeS: TEST_CYCLE_S }],
    });
    expect(ok).toBe(true);
    // cycle   10 s = 0.166667 min
    // machine 136.80 / 60 × 0.166667            = 2.28 × 0.166667        = 0.380000 USD
    // labour  36.30 / 60 × 0.33 × 0.166667      = 0.605 × 0.33 × 0.166667 = 0.033275 USD
    // setup   (2.28 + 0.605 × 0.33) × (0.5 h × 60 / 1000 parts) = 2.47965 × 0.03 = 0.074390 USD
    // total   0.380000 + 0.033275 + 0.074390     = 0.487665 USD per part
    expect(line.setupCost).toBe(0.07); // rounded to cents on the line
    expect(line.totalCost).toBe(0.49);
    expect(line.runCost).toBe(0.41); // r2(0.487665 - 0.07439) = r2(0.413275)
    expect(defined(line.machineChoice, 'machine choice').candidates[0].perPartCost).toBeCloseTo(0.4877, 4);
    expect(line.cycleTimeMin).toBe(0.167);
    expect(line.setupTimeMin).toBe(30);
    expect(line.hourlyRate).toBeCloseTo(136.8, 9);
    expect(line.labourRate).toBe(36.3);
    expect(line.operators).toBe(0.33);
    expect(line.rateSource).toBe('mhr_database');
    expect(line.physicsGap).toBeUndefined();
  });

  it('picks the cheapest capable machine per part and lists the others', () => {
    // KFP 1200: machine 145.56 / 60 × 0.166667 = 0.404333; labour 0.033275;
    //           setup (2.426 + 0.19965) × 0.03 = 0.078770; total 0.516378 USD > 0.487665 (KFP 1000).
    const { line } = priceForgingLine({
      step: FORGING_STEPS.press, criteria: ['test'], batchSize: 1000, costContext: ctx,
      candidates: [
        { machine: kfp1200, reasons: [], cycleTimeS: TEST_CYCLE_S },
        { machine: kfp1000, reasons: [], cycleTimeS: TEST_CYCLE_S },
        { machine: { ...kfp1000, name: 'Too small' }, reasons: ['press force 10000 kN < required 20000 kN'], cycleTimeS: TEST_CYCLE_S },
      ],
    });
    expect(line.machineName).toBe('Lasco KFP 1000');
    const c = defined(line.machineChoice, 'machine choice');
    expect(c.capableCount).toBe(2);
    expect(c.candidates.map((x) => [x.name, x.status, x.perPartCost])).toEqual([
      ['Lasco KFP 1000', 'chosen', 0.4877],
      ['Lasco KFP 1200', 'capable', 0.5164],
      ['Too small', 'rejected', null],
    ]);
    expect(c.candidates[2].reasons).toEqual(['press force 10000 kN < required 20000 kN']);
  });

  it('no capable machine, or no batch size, is a gap line; no rate or cycle is assumed', () => {
    const none = priceForgingLine({
      step: FORGING_STEPS.trim, criteria: [], batchSize: 1000, costContext: ctx,
      candidates: [{ machine: { ...kfp1000, setupTimeHr: null }, reasons: [], cycleTimeS: null }],
    });
    expect(none.ok).toBe(false);
    expect(none.line.totalCost).toBe(0);
    expect(none.line.physicsGap).toMatchObject({ gapType: 'unsupported_operation', process: 'Trim', machineClass: 'forging_trim' });
    expect(defined(none.line.machineChoice, 'machine choice').candidates[0].reasons).toEqual(['no setup time on file', 'no cycle time']);

    const noBatch = priceForgingLine({
      step: FORGING_STEPS.press, criteria: [], batchSize: null, costContext: ctx,
      candidates: [{ machine: kfp1000, reasons: [], cycleTimeS: TEST_CYCLE_S }],
    });
    expect(noBatch.ok).toBe(false);
    expect(noBatch.line.physicsGap).toMatchObject({ reason: 'Press: batch size not set (setup is spread over the batch).' });
  });

  it('a gap line has the hpdc gap shape and costs nothing', () => {
    expect(forgingGapLine(FORGING_STEPS.bandSaw, 'why')).toEqual({
      process: 'Band Saw', setupCost: 0, runCost: 0, totalCost: 0, cycleTimeMin: 0, hourlyRate: 0, rateSource: 'no_db_rate',
      machineClass: 'forging_band_saw', machineName: null, commodityCode: null, labourRate: null,
      physicsGap: { gapType: 'unsupported_operation', process: 'Band Saw', machineClass: 'forging_band_saw', reason: 'why' },
    });
  });
});
