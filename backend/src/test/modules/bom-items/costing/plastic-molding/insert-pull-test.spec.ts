// The insert pull test (formula registry F-40): a destructive AQL sample of each batch, each insert pulled to failure, each sample scrapped.
import { runInsertPullTest } from '../../../../../modules/bom-items/costing/plastic-molding/calculators/plastic-cycle-time';
import { plasticMoldingCalculatorsByName } from '../../../../../modules/bom-items/costing/plastic-molding/calculators/plastic-molding-calculator-spec';
import { insertPullTestReference } from '../../../../../modules/bom-items/costing/plastic-molding/reference/im-reference';
import { realPlasticReference } from './real-plastic-reference';

const calculators = plasticMoldingCalculatorsByName();
const aql = realPlasticReference().aqlSamples;
const run = (over: Partial<Parameters<typeof runInsertPullTest>[0]> = {}) =>
  runInsertPullTest({ ref: insertPullTestReference(), insertsPerPart: 3, batchSize: 2500, aql, testedPartUsd: 2, ...over }, calculators);

describe('the insert pull test', () => {
  it('samples a batch at the reference AQL special level (memory/Secondary process CMMInspection): 32 of 2,500', () => {
    expect(aql?.inspectionType).toBe('Smaller Sample Sizes (AQL Special Inspection)');
    const r = run();
    expect(r.derivable && r.trace.find((t) => t.fieldName === 'Sample Size')?.value).toBe(32);
  });

  it('times a sample as handling + per insert (seat + pull at 5 mm/min over 2 mm + approach + record), spread over the batch', () => {
    const r = run();
    if (!r.derivable) throw new Error(r.missing.join('; '));
    const field = (n: string) => r.trace.find((t) => t.fieldName === n)?.value;
    expect(field('Pull Time per Insert')).toBeCloseTo(25 + (2 / 5) * 60 + 15 + 20, 9); // 84 s
    expect(field('Sample Time')).toBeCloseTo(40 + 3 * 84, 9); // 292 s
    expect(r.cycleSec).toBeCloseTo((32 * 292) / 2500, 6); // 3.7376 s per part
  });

  it('rates the Mark-10 station (7,040 USD) by the machine-hour pattern, and scraps every sample at its cost', () => {
    const r = run();
    expect(r.testerRateUsdPerHr).toBeCloseTo((7040 / 10 + 7040 * 0.05 + (7040 * 0.2) / 10) / (6240 * 0.8 * 0.95), 4);
    expect(r.scrapUsdPerPart).toBeCloseTo((32 * 2) / 2500, 9);
  });

  it('a small batch tests at most the whole batch, and names what is missing instead of a default', () => {
    const small = run({ batchSize: 2 });
    expect(small.derivable && small.trace.find((t) => t.fieldName === 'Sample Size')?.value).toBe(2);
    const none = run({ insertsPerPart: 0, aql: null, testedPartUsd: null });
    expect(none.derivable).toBe(false);
    expect(!none.derivable && none.missing.join('; ')).toMatch(/inserts per part.*AQL sample size.*cost of a tested part/);
  });
});
