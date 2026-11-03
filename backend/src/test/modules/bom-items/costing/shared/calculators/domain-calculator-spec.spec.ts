import { readFileSync } from 'fs';
import { join } from 'path';
import { domainCalculatorsAsReference, domainCalculatorsByName, validateDomainCalculatorSpec, type DomainCalculatorSpec } from '../../../../../../modules/bom-items/costing/shared/calculators/domain-calculator-spec';
import { buildDomainCalculatorsMigrationSql } from '../../../../../../modules/bom-items/costing/shared/calculators/domain-calculators-migration';
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

describe('domain calculator spec: helpers, named outputs, sources', () => {
  const field = { name: 'X', unit: null };
  const helper = (over: Partial<DomainCalculatorSpec['calculators'][number]> = {}) =>
    spec({ operations: [], helper: true, output: 'Weight', fields: [field, { name: 'Weight', unit: 'kg', formula: '{X} * 2' }], ...over });

  it('accepts a helper: no operation, its own output', () => {
    expect(() => validateDomainCalculatorSpec(helper())).not.toThrow();
  });

  it('a calculator with no operation must say it is a helper, and a helper must have none', () => {
    expect(() => validateDomainCalculatorSpec(helper({ helper: undefined }))).toThrow(/not marked helper/);
    expect(() => validateDomainCalculatorSpec(helper({ operations: ['Op A'] }))).toThrow(/helper but computes operations/);
  });

  it('the output must be a calculated field, and an operation\'s calculator keeps Cycle Time', () => {
    expect(() => validateDomainCalculatorSpec(helper({ output: 'Missing' }))).toThrow(/no calculated "Missing"/);
    expect(() => validateDomainCalculatorSpec(spec({ output: 'Weight', fields: [field, { name: 'Weight', unit: 'kg', formula: '{X}' }] }))).toThrow(/must be "Cycle Time"/);
  });

  it('each named result is a calculated field, and a calculated field has no source', () => {
    expect(() => validateDomainCalculatorSpec(helper({ results: ['Nope'] }))).toThrow(/result "Nope"/);
    expect(() => validateDomainCalculatorSpec(spec({ fields: [field, { name: 'Cycle Time', unit: 's', formula: '{X}', source: { engine: 'x' } }] }))).toThrow(/no source/);
  });

  it('a helper is found by name, not by operation', () => {
    const s = validateDomainCalculatorSpec(helper());
    expect(Object.keys(domainCalculatorsAsReference(s))).toEqual([]);
    expect(Object.keys(domainCalculatorsByName(s))).toEqual(['Test - A']);
  });

  it('the migration of a helper maps no operation', () => {
    const sql = buildDomainCalculatorsMigrationSql(validateDomainCalculatorSpec(helper()), { number: 1, title: 't', generator: 'g', specPath: 'p', rootCause: 'r' });
    expect(sql).not.toMatch(/UPDATE public\.process_calculator_mappings/);
    expect(sql).toMatch(/\(\$q\$Test - A\$q\$, 2, 0\)/);
  });
});
