import { readFileSync } from 'fs';
import { join } from 'path';
import { validateDomainCalculatorSpec, type DomainCalculatorSpec } from '../../../../../../modules/bom-items/costing/shared/calculators/domain-calculator-spec';
import { buildHeatTreatmentCalculatorsMigrationSql } from '../../../../../../modules/bom-items/costing/heat/calculators/heat-treatment-calculators-migration';
import { loadHeatTreatmentCalculatorSpec } from '../../../../../../modules/bom-items/costing/heat/calculators/heat-treatment-calculator-spec';

const spec = (over: Partial<DomainCalculatorSpec['calculators'][number]> = {}): DomainCalculatorSpec => ({
  domain: 'test', processGroup: 'Test',
  calculators: [{
    key: 'a', name: 'Test - A', description: 'd', operations: ['Op A'],
    fields: [{ name: 'X', unit: null }, { name: 'Cycle Time', unit: 's', formula: '{X} * 2' }], ...over,
  }],
});

describe('domain calculator spec validation', () => {
  it('accepts a well-formed spec', () => {
    expect(() => validateDomainCalculatorSpec(spec())).not.toThrow();
  });

  it('rejects a formula naming a field that is not defined before it', () => {
    expect(() => validateDomainCalculatorSpec(spec({ fields: [{ name: 'Cycle Time', unit: 's', formula: '{Y} * 2' }] }))).toThrow(/\{Y\}/);
  });

  it('rejects a calculator with no calculated Cycle Time', () => {
    expect(() => validateDomainCalculatorSpec(spec({ fields: [{ name: 'X', unit: null }] }))).toThrow(/Cycle Time/);
  });

  it('rejects an operation computed by two calculators', () => {
    const s = spec();
    s.calculators.push({ ...s.calculators[0]!, key: 'b', name: 'Test - B' });
    expect(() => validateDomainCalculatorSpec(s)).toThrow(/two calculators/);
  });
});

describe('heat treatment calculators migration', () => {
  it('the committed migration 907 equals what the spec generates (regenerate, never hand-edit)', () => {
    const committed = readFileSync(join(__dirname, '../../../../../../../migrations/907_heat_treatment_calculators.sql'), 'utf8');
    expect(committed.replace(/\r\n/g, '\n')).toBe(buildHeatTreatmentCalculatorsMigrationSql());
  });

  it('the shipped spec is valid and links all 22 heat-treatment operations', () => {
    const ops = loadHeatTreatmentCalculatorSpec().calculators.flatMap((c) => c.operations);
    expect(ops).toHaveLength(22);
    expect(new Set(ops).size).toBe(22);
  });
});
