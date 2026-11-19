// Gate trimming (formula registry F-38): each edge gate cut at manualTrimRate, the gate width by Pye's rule w = n x sqrt(A) / 30.
import { gateWidthConstant } from '../../../../../modules/bom-items/costing/plastic-molding/reference/im-reference';
import { runGateTrimmingTime } from '../../../../../modules/bom-items/costing/plastic-molding/calculators/plastic-cycle-time';
import { plasticMoldingCalculatorsByName } from '../../../../../modules/bom-items/costing/plastic-molding/calculators/plastic-molding-calculator-spec';

describe('the edge gate width constant (reference/gate-sizing-reference.csv)', () => {
  it('is Pye\'s n for the families he lists, matched by the catalog material type', () => {
    expect(gateWidthConstant('Polystyrene')).toMatchObject({ n: 0.6, confidence: 'source_backed' });
    expect(gateWidthConstant('Polypropylene')).toMatchObject({ n: 0.7, confidence: 'source_backed' });
    expect(gateWidthConstant('Nylon')).toMatchObject({ n: 0.8, confidence: 'source_backed' });
    expect(gateWidthConstant('acrylic')).toMatchObject({ n: 0.8 });
  });

  it('is the assumed middle value 0.7 for a material he does not list (ABS), and says so', () => {
    expect(gateWidthConstant('ABS')).toMatchObject({ n: 0.7, family: 'Other', confidence: 'assumed' });
    expect(gateWidthConstant(null)).toMatchObject({ n: 0.7, confidence: 'assumed' });
  });
});

describe('the gate trimming time', () => {
  const calculators = plasticMoldingCalculatorsByName();
  it('cuts each gate at the manual trim rate: 0.7 x sqrt(40,000) / 30 = 4.667 mm at 12.7 mm/s = 0.37 s', () => {
    const r = runGateTrimmingTime({ surfaceAreaMm2: 40_000, gateConstant: gateWidthConstant('ABS'), gatesPerCavity: 1, rateMmPerS: 12.7 }, calculators);
    expect(r.derivable && r.cycleSec).toBe(0.37);
    const two = runGateTrimmingTime({ surfaceAreaMm2: 40_000, gateConstant: gateWidthConstant('ABS'), gatesPerCavity: 2, rateMmPerS: 12.7 }, calculators);
    expect(two.derivable && two.cycleSec).toBe(0.73);
  });

  it('names what is missing instead of a default', () => {
    const r = runGateTrimmingTime({ surfaceAreaMm2: null, gateConstant: null, gatesPerCavity: 1, rateMmPerS: null }, calculators);
    expect(r.derivable).toBe(false);
    expect(!r.derivable && r.missing.join('; ')).toMatch(/part surface area.*gate width constant.*manual trim rate/);
  });
});

describe('gate trimming on the line', () => {
  it('has its own machine class, which migration 1088 gives a Plastic Molding catalog row (not the deburring bench\'s Finishing / Deslag)', () => {
    const sql = require('fs').readFileSync(require('path').join(__dirname, '../../../../../../migrations/1088_plastic_trim_pull_test_catalog_rows.sql'), 'utf8') as string;
    for (const [op, cls] of [['Gate Trimming', 'gate_trimming'], ['Deflashing', 'deflashing'], ['Insert Pull Test', 'insert_pull_test']]) {
      expect(sql).toContain(`'Plastic Molding', '${op}',`);
      expect(sql).toContain(`'${cls}'`);
    }
  });
});
