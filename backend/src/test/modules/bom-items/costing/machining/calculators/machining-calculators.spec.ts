import { readFileSync } from 'fs';
import { join } from 'path';
import { runMachiningCalculator, CYCLE_TIME_FIELD, type CalcSeed } from '../../../../../../modules/bom-items/costing/machining/calculators/machining-calculator';
import { loadMachiningCalculatorSpec, specAsCalculators } from '../../../../../../modules/bom-items/costing/machining/calculators/machining-calculator-spec';
import { buildMachiningCalculatorsMigrationSql } from '../../../../../../modules/bom-items/costing/machining/calculators/machining-calculators-migration';

// Contract between the machining calculator spec, its migration, and the
// engine: one definition of every machining formula, stored in the database,
// evaluated by the engine — never a second copy.
const spec = loadMachiningCalculatorSpec();
const calcs = specAsCalculators(spec);
const ROOT = join(__dirname, '../../../../../../..');

describe('machining calculator spec ↔ migration ↔ engine', () => {
  it('the committed migration is exactly what the spec generates', () => {
    const committed = readFileSync(join(ROOT, 'migrations/804_machining_calculators.sql'), 'utf-8');
    expect(committed).toBe(buildMachiningCalculatorsMigrationSql(spec));
  });

  it.each(spec.calculators.map((c) => [c.name, c] as const))('%s: every formula references only its own fields, and it outputs Cycle Time', (_name, c) => {
    const names = new Set(c.fields.map((f) => f.name));
    expect(names.has(CYCLE_TIME_FIELD)).toBe(true);
    for (const f of c.fields.filter((x) => x.formula)) {
      const refs = [...f.formula!.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]!);
      expect(refs.filter((r) => !names.has(r))).toEqual([]);
    }
  });

  it.each(spec.calculators.map((c) => [c.name, c] as const))('%s: evaluates to a finite cycle time from its inputs', (_name, c) => {
    const seeds: Record<string, CalcSeed> = Object.fromEntries(
      c.fields.filter((f) => !f.formula && f.source !== 'default').map((f) => [f.name, { value: 2, source: 'test' }]),
    );
    const run = runMachiningCalculator(calcs, c.operation, seeds);
    expect(run.missing).toEqual([]);
    expect(Number.isFinite(run.sec)).toBe(true);
    expect(run.sec).toBeGreaterThanOrEqual(0);
  });

  it('every operation the engine evaluates has a calculator in the spec', () => {
    const engine = readFileSync(join(ROOT, 'src/modules/bom-items/costing/machining/process/cost-machining-engine.ts'), 'utf-8');
    const called = new Set([...engine.matchAll(/runMachiningCalculator\([^,]+,\s*'([^']+)'/g)].map((m) => m[1]!));
    // Deep-hole lines pass their process name through a variable.
    called.add('Gun Drilling'); called.add('Deep Bore Machine');
    const specified = new Set(spec.calculators.map((c) => c.operation));
    expect([...called].filter((op) => !specified.has(op))).toEqual([]);
  });

  it('a missing calculator is a named gap, not a number', () => {
    const run = runMachiningCalculator({}, 'Drilling', {});
    expect(run.sec).toBeNull();
    expect(run.missing[0]).toContain('none mapped');
  });
});
