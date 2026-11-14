import { readFileSync } from 'fs';
import { join } from 'path';
import { runMachiningCalculator, CYCLE_TIME_FIELD, type CalcSeed } from '../../../../../../modules/bom-items/costing/machining/calculators/machining-calculator';
import { loadMachiningCalculatorSpec, specAsCalculators, STATION_OPERATION } from '../../../../../../modules/bom-items/costing/machining/calculators/machining-calculator-spec';
import { buildMachiningCalculatorMigrationSql, buildMachiningCalculatorsMigrationSql } from '../../../../../../modules/bom-items/costing/machining/calculators/machining-calculators-migration';

// Contract between the machining calculator spec, its migration, and the
// engine: one definition of every machining formula, stored in the database,
// evaluated by the engine — never a second copy.
const spec = loadMachiningCalculatorSpec();
const calcs = specAsCalculators(spec);
const ROOT = join(__dirname, '../../../../../../..');

describe('machining calculator spec ↔ migration ↔ engine', () => {
  it('the committed migration is exactly what the spec generates', () => {
    const committed = readFileSync(join(ROOT, 'migrations/804_machining_calculators.sql'), 'utf-8');
    // 804 is built from the whole spec, superseded entries included: an applied migration never changes.
    expect(committed).toBe(buildMachiningCalculatorsMigrationSql());
  });

  it('a calculator replaced later keeps its 804 entry, and the replacement ships in its own migration (Inspection, 1029)', () => {
    const committed = readFileSync(join(ROOT, 'migrations/1029_machining_inspection_from_reference.sql'), 'utf-8');
    expect(committed).toBe(buildMachiningCalculatorMigrationSql(1029, spec));
    expect(committed).toContain('tblInspection');
    // The engine sees only the current entry.
    expect(spec.calculators.filter((c) => c.name === 'Machining - Inspection').map((c) => c.fields.map((f) => f.name))).toEqual([
      ['Time Per Analysis', 'Inspection Sample Ratio', 'Final Inspection Time', 'Cycle Time'],
    ]);
    expect(buildMachiningCalculatorsMigrationSql()).toContain('Positioning Time');
  });

  it('a calculator added later ships in its own migration, and 804 does not change for it', () => {
    const committed = readFileSync(join(ROOT, 'migrations/1027_machining_milling_calculator.sql'), 'utf-8');
    expect(committed).toBe(buildMachiningCalculatorMigrationSql(1027, spec));
    expect(buildMachiningCalculatorsMigrationSql()).not.toContain('Machining - Milling');
  });

  it('the calculators added to the spec after 804 was applied ship again in 1028, so a database that ran the earlier 804 gets them', () => {
    const committed = readFileSync(join(ROOT, 'migrations/1028_machining_calculators_missing_after_804.sql'), 'utf-8');
    expect(committed).toBe(buildMachiningCalculatorMigrationSql(1028, spec));
    for (const name of ['Surface Grinding', 'Hobbing', 'Shaving', 'Rotary Broaching']) expect(committed).toContain(`Machining - ${name}`);
  });

  it('the second batch of calculators ships in 1030: ten more reference processes get one', () => {
    const committed = readFileSync(join(ROOT, 'migrations/1030_machining_calculators_batch_2.sql'), 'utf-8');
    expect(committed).toBe(buildMachiningCalculatorMigrationSql(1030, spec));
    for (const station of ['Rotary Surface Grinder', 'Shaper', 'Drill Press', 'Stock Prep Mill', 'Stock Prep Lathe', 'Bench Operation', '3 Axis Router', '5 Axis Router']) {
      expect(calcs[station]?.name).toMatch(/^Machining - /);
    }
    expect(calcs['Straight BG Face Milling']?.name).toBe('Machining - Straight Bevel Gear Cutting');
    expect(calcs['Automated Deburring']?.name).toBe('Machining - Automated Deburring');
  });

  it('the milling operations of the sequencer each have a calculator, shipped in 1031', () => {
    const committed = readFileSync(join(ROOT, 'migrations/1031_machining_mill_operation_calculators.sql'), 'utf-8');
    expect(committed).toBe(buildMachiningCalculatorMigrationSql(1031, spec));
    for (const op of ['Facing', 'Rough Milling', 'Bulk Milling', 'Fine Finish Milling', 'Contouring', 'Perimeter Milling', 'Slot Milling', 'Center Drilling', 'Chamfering', 'Filleting', 'Groove Milling']) {
      expect(calcs[op]?.name).toBe(`Machining - ${op}`);
    }
  });

  it('the third batch ships in 1032: every reference process with a machine now has a calculator', () => {
    const committed = readFileSync(join(ROOT, 'migrations/1032_machining_calculators_batch_3.sql'), 'utf-8');
    expect(committed).toBe(buildMachiningCalculatorMigrationSql(1032, spec));
    for (const station of ['Mask Cure', 'Scribe', 'Etch Cell', 'DeMask', 'Spline Roller', 'Profile Gear Grinder', 'Threaded Wheel Gear Grinder']) {
      expect(calcs[station]?.name).toMatch(/^Machining - /);
    }
  });

  it('countersinking has its own machining calculator, shipped in 1035', () => {
    const committed = readFileSync(join(ROOT, 'migrations/1035_machining_countersinking_calculator.sql'), 'utf-8');
    expect(committed).toBe(buildMachiningCalculatorMigrationSql(1035, spec));
    expect(calcs['Countersinking']?.name).toBe('Machining - Countersinking');
  });

  it('part setup (load, unload, reorient) has a calculator, shipped in 1037', () => {
    const committed = readFileSync(join(ROOT, 'migrations/1037_machining_part_setup_calculator.sql'), 'utf-8');
    expect(committed).toBe(buildMachiningCalculatorMigrationSql(1037, spec));
    expect(calcs['Part Setup']?.name).toBe('Machining - Part Setup');
  });

  it('the milling calculator prices the line of every mill station, and of the live-tool turning machines', () => {
    expect(['3 Axis Mill', '4 Axis Mill', '5 Axis Mill', 'MillTurn', '3 Axis Lathe'].map((station) => calcs[station]?.name)).toEqual(Array(5).fill('Machining - Milling'));
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
    // A station calculator is keyed by each station it prices ("3 Axis Mill", ...).
    const operation = c.operation === STATION_OPERATION ? spec.stations[c.machineClasses[0]!]! : c.operation;
    const run = runMachiningCalculator(calcs, operation, seeds);
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
