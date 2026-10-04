import { readFileSync } from 'fs';
import { join } from 'path';
import { runReferenceCalculator, type CalcSeed } from '../../../../../../modules/bom-items/costing/shared/calculators/reference-calculator';
import {
  dieCastingLookupTableNames,
  dieCastingSpecAsCalculators,
  loadDieCastingCalculatorSpec,
} from '../../../../../../modules/bom-items/costing/casting/calculators/die-casting-calculator-spec';
import { buildDieCastingCalculatorsMigrationSql } from '../../../../../../modules/bom-items/costing/casting/calculators/die-casting-calculators-migration';

// Contract between the die-casting calculator spec, its migration, the staged
// memory/Die Casting reference data and the engine: one definition of every
// die-casting formula, stored in the database, evaluated by the engine.
const spec = loadDieCastingCalculatorSpec();
const calcs = dieCastingSpecAsCalculators(spec);
const ROOT = join(__dirname, '../../../../../../..');
const MEMORY = join(ROOT, '../memory/Die Casting');

describe('die-casting calculator spec ↔ migration ↔ reference data', () => {
  it('the committed migration is exactly what the spec generates', () => {
    const committed = readFileSync(join(ROOT, 'migrations/893_die_casting_calculators.sql'), 'utf-8');
    expect(committed).toBe(buildDieCastingCalculatorsMigrationSql(spec));
  });

  it.each(spec.calculators.map((c) => [c.name, c] as const))('%s: formulas reference only its own fields; its output is calculated', (_name, c) => {
    const names = new Set(c.fields.map((f) => f.name));
    expect(c.fields.find((f) => f.name === c.output)?.formula).toBeTruthy();
    for (const f of c.fields.filter((x) => x.formula)) {
      const refs = [...f.formula!.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]!);
      expect(refs.filter((r) => !names.has(r))).toEqual([]);
    }
  });

  it.each(spec.calculators.map((c) => [c.name, c] as const))('%s: evaluates to a finite output from its inputs', (_name, c) => {
    const seeds: Record<string, CalcSeed> = Object.fromEntries(
      // 2 everywhere, except flags (1) and a mold below the liquidus (a 0 divisor otherwise).
      c.fields.filter((f) => !f.formula).map((f) => [f.name, { value: ({ 'Gates Ground': 1, 'Pressure Die': 1, 'Mold Temp': 1 } as Record<string, number>)[f.name] ?? 2, source: 'test' }]),
    );
    const run = runReferenceCalculator(calcs, c.key, seeds, c.output);
    expect(run.missing).toEqual([]);
    expect(Number.isFinite(run.value)).toBe(true);
  });

  it('every variable and lookup a calculator reads is in memory/Die Casting', () => {
    const variables = new Set(readFileSync(join(MEMORY, 'Die casting_variables.csv'), 'utf-8').split(/\r?\n/).map((l) => l.split(',')[0]));
    const missing: string[] = [];
    for (const c of spec.calculators) {
      for (const f of c.fields) {
        if (f.source !== 'variable') continue;
        for (const name of [f.column!, ...(f.alsoColumns ?? [])]) if (!variables.has(name)) missing.push(`${c.key}.${f.name}: ${name}`);
      }
    }
    expect(missing).toEqual([]);
    const lookups = dieCastingLookupTableNames(spec).filter((t) => !['variables', 'materials_master'].includes(t) && !t.startsWith('digital_factory_'));
    for (const t of lookups) expect(() => readFileSync(join(MEMORY, `Lookup/${t}.csv`))).not.toThrow();
  });

  it('a missing calculator is a named gap, not a number', () => {
    const run = runReferenceCalculator({}, 'High Pressure Die Casting', {});
    expect(run.value).toBeNull();
    expect(run.missing[0]).toContain('none mapped');
  });
});
