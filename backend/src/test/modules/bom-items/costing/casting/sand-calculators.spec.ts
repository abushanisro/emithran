import { erf } from 'mathjs';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { buildSandCastingCalculatorsMigrationSql, buildSandGatingVelocityMigrationSql, buildSandHotBoxPhysicsMigrationSql } from '../../../../../modules/bom-items/costing/casting/sand/calculators/sand-casting-calculators-migration';
import {
  loadSandCastingCalculatorSpec,
  sandCastingCalculatorsByName,
  sandCastingCalculatorsFromSpec,
} from '../../../../../modules/bom-items/costing/casting/sand/calculators/sand-casting-calculator-spec';
import { runReferenceCalculator, type CalcSeed } from '../../../../../modules/bom-items/costing/shared/calculators/reference-calculator';
import { normalizeFieldName } from '../../../../../modules/calculators/calculator-formula-evaluator';

// Real data only: every source a calculator names is checked against memory/Sand casting and the seed migrations, so a name that does
// not exist fails here, not at quote time.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { readCsv } = require('../../../../../../migrations/scripts/lib/memory-machine-seed.js');
const ROOT = join(__dirname, '../../../../../../..');
const SAND = join(ROOT, 'memory/Sand casting');
const MIGRATIONS = join(ROOT, 'backend/migrations');
const strip = (s: string) => s.replace(/^﻿/, '');

const spec = loadSandCastingCalculatorSpec();
const all = spec.calculators;

describe('sand casting calculator spec', () => {
  it('the committed migration 956 equals what the spec generates (regenerate, never hand-edit)', () => {
    const committed = readFileSync(join(MIGRATIONS, '956_sand_casting_calculators.sql'), 'utf8');
    expect(committed.replace(/\r\n/g, '\n')).toBe(buildSandCastingCalculatorsMigrationSql());
  });

  it('the committed migration 958 (the hot box physics) equals what the spec generates for that calculator alone', () => {
    const committed = readFileSync(join(MIGRATIONS, '958_sand_hot_box_physics.sql'), 'utf8');
    expect(committed.replace(/\r\n/g, '\n')).toBe(buildSandHotBoxPhysicsMigrationSql());
  });

  it('the committed migration 959 (the gating velocity) equals what the spec generates for the gating and riser calculators alone', () => {
    const committed = readFileSync(join(MIGRATIONS, '959_sand_gating_velocity.sql'), 'utf8');
    expect(committed.replace(/\r\n/g, '\n')).toBe(buildSandGatingVelocityMigrationSql());
  });

  it('has the 20 calculators of the step design: 12 compute operations (20 of them), 8 are helpers', () => {
    expect(all).toHaveLength(20);
    expect(all.filter((c) => c.helper)).toHaveLength(8);
    expect(all.flatMap((c) => c.operations)).toHaveLength(20);
  });

  it('every operation it computes is a real sand process of the staged catalog (migration 851) and none is computed twice', () => {
    const catalog = new Set(readCsv(join(SAND, 'Processes/processes.csv')).rows.map((r: Record<string, string>) => r['Process Name']));
    const ops = all.flatMap((c) => c.operations);
    expect(ops.filter((o) => !catalog.has(o))).toEqual([]);
    expect(new Set(ops).size).toBe(ops.length);
  });

  it('field names never collide once normalized (the evaluator addresses a field by its normalized name)', () => {
    for (const c of all) {
      const names = c.fields.map((f) => normalizeFieldName(f.name));
      expect({ calc: c.name, dup: names.filter((n, i) => names.indexOf(n) !== i) }).toEqual({ calc: c.name, dup: [] });
    }
  });

  it('every input names where it comes from, and every calculated field names none', () => {
    for (const c of all) for (const f of c.fields) expect({ c: c.name, f: f.name, ok: f.formula ? !f.source : !!f.source }).toEqual({ c: c.name, f: f.name, ok: true });
  });

  describe('every source resolves to real data', () => {
    const sources = all.flatMap((c) => c.fields.flatMap((f) => (f.source ? [{ calc: c.name, field: f.name, source: f.source }] : [])));
    const variables = new Set(readCsv(join(SAND, 'sand_casting_variables.csv')).rows.map((r: Record<string, string>) => r['Variable Name']));
    const headers = new Map<string, string[]>(
      readdirSync(join(SAND, 'Lookup')).filter((f) => f.endsWith('.csv')).map((f) => [
        f.replace(/\.csv$/, '').replace('lookupTables_Component_', ''),
        strip(readFileSync(join(SAND, 'Lookup', f), 'utf8').split(/\r?\n/)[0]!).split(',').map((h) => h.trim()),
      ]),
    );
    const seed = readdirSync(MIGRATIONS).filter((f) => f.startsWith('851_seed')).map((f) => readFileSync(join(MIGRATIONS, f), 'utf8')).join('\n');
    const rawMaterialsSql = readFileSync(join(MIGRATIONS, '852_promote_sand_casting_raw_materials.sql'), 'utf8');

    it('variables are in sand_casting_variables.csv', () => {
      for (const s of sources.filter((x) => 'variable' in x.source)) expect(variables.has((s.source as { variable: string }).variable)).toBe(true);
    });
    it('lookups are an existing table and header of memory/Sand casting/Lookup', () => {
      for (const s of sources.filter((x) => 'lookup' in x.source)) {
        const [table, column] = (s.source as { lookup: string }).lookup.split('.') as [string, string];
        expect({ at: `${s.calc}/${s.field}`, ok: headers.get(table)?.includes(column) }).toEqual({ at: `${s.calc}/${s.field}`, ok: true });
      }
    });
    it('machine columns are keys the sand machines were seeded with (migration 851) or a column of mhr_records', () => {
      for (const s of sources.filter((x) => 'machine' in x.source)) {
        const key = (s.source as { machine: string }).machine;
        expect({ at: `${s.calc}/${s.field}`, ok: seed.includes(`"${key}"`) || seed.includes(key) }).toEqual({ at: `${s.calc}/${s.field}`, ok: true });
      }
    });
    it('material columns are raw_materials columns of the sand materials (migration 852)', () => {
      for (const s of sources.filter((x) => 'material' in x.source)) expect(rawMaterialsSql).toContain((s.source as { material: string }).material);
    });
    it('part, scenario and route inputs are named', () => {
      for (const s of sources.filter((x) => 'cad' in x.source || 'scenario' in x.source || 'engine' in x.source)) {
        expect(Object.values(s.source)[0]).toMatch(/^[a-z][a-z0-9_]*$/);
      }
    });
  });
});

const seeds = (v: Record<string, number>): Record<string, CalcSeed> => Object.fromEntries(Object.entries(v).map(([k, value]) => [k, { value, source: 'hand-worked' }]));

describe('sand calculators run through the shared evaluator on hand-worked inputs', () => {
  const byOperation = sandCastingCalculatorsFromSpec();
  const byName = sandCastingCalculatorsByName();

  it('shakeout: 2 min per mould over 4 cavities is 30 s', () => {
    expect(runReferenceCalculator(byOperation, 'Shakeout', seeds({ 'Shakeout Time': 2, Cavities: 4 })).value).toBeCloseTo(30, 9);
  });

  // The hot box calculator on hand-worked inputs. Sand (staged variables): density 1600 kg/m3, specific heat 1170 J/(kg K), conductivity 0.52 W/(m K),
  // so alpha = 0.52 / (1600 x 1170) = 2.7778e-7 m2/s. Box 245 C, binder cures at 150 C, sand starts at 20 C: theta = (245 - 150) / (245 - 20) = 0.42222,
  // erfinv(theta) = 0.3936. A cured depth d takes t = d^2 / (4 alpha 0.3936^2): 2 mm 23.2 s, 3 mm 52.3 s, 6.35 mm 234.3 s (docs/design/sand-casting-hotbox-gating.md).
  const hotBox = (over: Record<string, number> = {}) =>
    runReferenceCalculator(byOperation, 'Hot Box', seeds({
      'Core Sand': 6, 'Blowing Rate': 12, 'Core Section': 60, 'Sand Density': 1600, 'Sand Specific Heat': 1170, 'Sand Conductivity': 0.52,
      'Initial Sand Temperature': 20, 'Corebox Temperature': 245, 'Cure Temperature': 150, 'Required Cured Depth': 3, 'Strip and Handling': 10, 'Energy Price': 0.1, ...over,
    }));

  it('hot box: 6 kg at 12 kg/min is 30 s to blow; 3 mm of sand reaches 150 C from a 245 C box in 52.3 s; 10 s to strip: 92.3 s', () => {
    const run = hotBox();
    expect(run.outputs['Cure Time']).toBeCloseTo(52.28, 1);
    expect(run.value).toBeCloseTo(30 + run.outputs['Cure Time']! + 10, 9);
  });

  it('hot box: the cure time really is the time for the depth to reach the cure temperature (the erf profile at that depth and time is 150 C)', () => {
    const t = hotBox().outputs['Cure Time']!;
    const alpha = 0.52 / (1600 * 1170);
    const temperature = 245 + (20 - 245) * (erf(0.003 / (2 * Math.sqrt(alpha * t))) as number);
    expect(temperature).toBeCloseTo(150, 6);
  });

  it('hot box: other depths and temperatures, hand-worked: 2 mm 23.2 s, 6.35 mm 234.3 s; a binder that cures at 100 C needs 8.4 s for 2 mm', () => {
    expect(hotBox({ 'Required Cured Depth': 2 }).outputs['Cure Time']).toBeCloseTo(23.2, 1);
    expect(hotBox({ 'Required Cured Depth': 6.35 }).outputs['Cure Time']).toBeCloseTo(234.3, 1);
    expect(hotBox({ 'Required Cured Depth': 2, 'Cure Temperature': 100 }).outputs['Cure Time']).toBeCloseTo(8.4, 1);
  });

  it('hot box: the depth cured is half the core\'s smallest section when that is less than the strip criterion (a thin core is cured through)', () => {
    const thin = hotBox({ 'Core Section': 4 });
    expect(thin.outputs['Cured Depth']).toBe(2);
    expect(thin.outputs['Cure Time']).toBeCloseTo(23.2, 1);
    expect(hotBox({ 'Core Section': 200 }).outputs['Cured Depth']).toBe(3);
  });

  // The sand's sensible heat to the cure temperature: 6 kg x 1170 J/(kg K) x (150 - 20) K = 912 600 J = 0.2535 kWh; at 0.10 USD/kWh that is 0.02535 USD a core.
  it('hot box energy: the sand\'s heat from 20 to 150 C, 6 kg: 912 600 J = 0.2535 kWh, 0.02535 USD at 0.10 USD/kWh', () => {
    const run = hotBox();
    expect(run.outputs['Sand Heat']).toBeCloseTo(912600, 6);
    expect(run.outputs['Energy']).toBeCloseTo(0.2535, 9);
    expect(run.outputs['Energy Cost']).toBeCloseTo(0.02535, 9);
    // twice the price, twice the cost; no price, none
    expect(hotBox({ 'Energy Price': 0.2 }).outputs['Energy Cost']).toBeCloseTo(0.0507, 9);
    expect(hotBox({ 'Energy Price': 0 }).outputs['Energy Cost']).toBe(0);
    // a cooler binder needs less heat: 100 C is 6 x 1170 x 80 = 561 600 J
    expect(hotBox({ 'Cure Temperature': 100 }).outputs['Sand Heat']).toBeCloseTo(561600, 6);
  });

  it('hot box: no cure or strip literals remain, and the settings it needs are named inputs', () => {
    const names = byOperation['Hot Box']!.fields.map((f) => f.field_name);
    expect(names).not.toEqual(expect.arrayContaining(['Cure Time (estimate)']));
    expect(names).toEqual(expect.arrayContaining(['Corebox Temperature', 'Cure Temperature', 'Required Cured Depth', 'Strip and Handling']));
    const cure = spec.calculators.find((c) => c.name === 'Sand Casting - Hot box coremaking')!.fields.find((f) => f.name === 'Cure Time')!;
    expect(cure.formula).toContain('ERFINV');
    for (const f of spec.calculators.find((c) => c.name === 'Sand Casting - Hot box coremaking')!.fields.filter((x) => x.formula)) {
      expect({ field: f.name, literalOnly: /^[0-9.\s]+$/.test(f.formula!) }).toEqual({ field: f.name, literalOnly: false });
    }
  });

  it('degating: (300 + 100) mm² of cut at 50 mm²/s is 8 s', () => {
    expect(runReferenceCalculator(byOperation, 'Degating', seeds({ 'Ingate Area': 300, 'Riser Contact': 100, 'Feed Rate': 50 })).value).toBeCloseTo(8, 9);
  });

  it('pour: a 10 kg mould, 250 kg ladle (25 moulds), coefficient 1.2, 1 min transport, 2 cavities: 4.0172 s', () => {
    const run = runReferenceCalculator(byOperation, 'Pour', seeds({ 'Poured per Mould': 10, 'Pouring Coefficient': 1.2, 'Ladle Capacity': 250, 'Ladle Transport Time': 1, Cavities: 2 }));
    // 1.2 x sqrt(10 / 0.45359237) + 1 x 60 / 25 = 8.0344; per cavity 4.0172
    expect(run.value).toBeCloseTo(4.017204543, 6);
  });

  it('a calculator with an input missing names it instead of guessing', () => {
    const run = runReferenceCalculator(byOperation, 'Shakeout', seeds({ Cavities: 4 }));
    expect(run.value).toBeNull();
    expect(run.missing.join(' ')).toMatch(/Shakeout Time/);
  });

  it('risers (a helper, found by name): modulus 5 mm, 1e6 mm³, 7200 kg/m³, 5 % shrinkage, 2 risers: Ø61.78 x 92.67 mm, 4.00 kg of risers', () => {
    const run = runReferenceCalculator(byName, 'Sand Casting - Risers', seeds({ 'Casting Modulus': 5, 'Casting Volume': 1e6, Density: 7200, Risers: 2, 'Shrinkage (estimate)': 5 }), 'Riser Weight');
    // by modulus: 5 x 1.2 = 6; D = 6 x (4 x 1.5 + 1) / 1.5 = 28. by feeding: V = 5 x 1e6 / (14 - 5) / 2; D = (4V / (pi x 1.5))^(1/3) = 61.7787. The larger wins.
    expect(run.outputs['Riser Diameter']).toBeCloseTo(61.77870299, 6);
    expect(run.outputs['Riser Height']).toBeCloseTo(92.66805448, 6);
    expect(run.value).toBeCloseTo(4, 9);
  });

  // A small iron casting: plausible values for every input name the sand calculators have, so each formula is run on physically consistent
  // numbers (a flask that holds the metal, a mould rate above its reduction per core, ...). Not reference data: only to prove the formulas run.
  const SMALL_IRON_CASTING: Record<string, number> = {
    'Casting Modulus': 8, 'Casting Volume': 5e5, Density: 7200, Risers: 2, 'Shrinkage (estimate)': 5, 'Poured per Mould': 12, Cavities: 1,
    'Pouring Coefficient': 1.2, 'Cope Height': 200, 'Casting Height in Cope': 100, 'Part Length': 150, Ingates: 2, 'Sprue Multiplier': 1,
    'Runner Multiplier': 1.5, 'Ingate Multiplier': 1, Efficiency: 0.9, 'Well Area Ratio': 5, 'Runner Aspect Ratio': 2, 'Ingate Aspect Ratio': 3,
    'Ingate Length Ratio': 0.1, Volume: 5e5, Gating: 3, 'Net Weight': 4, 'Poured Weight': 12, 'Furnace Yield Loss Factor': 0.98, 'Remelt Allowance': 0.1,
    Price: 2, 'Final Yield': 0.7, 'Yield Loss Factor': 0.98, 'Specific Heat': 500, 'Pour Temperature': 1450, 'Ambient Temperature': 21,
    'Heat of Fusion': 250000, 'Furnace Factor': 1.5, Power: 400, 'Energy Price': 0.1, 'Mould Rate No Core': 60, 'Reduction per Core': 5,
    'Mould Efficiency': 0.8, 'Cores per Mould': 1, 'Flask Length': 600, 'Flask Width': 500, 'Flask Height': 300, 'Metal Density': 7200,
    'Sand Density': 1600, 'Slinging Rate': 60, 'Cure Time': 10, 'Ladle Capacity': 250, 'Ladle Transport Time': 1, 'Specific Heat Liquid': 800,
    Liquidus: 1400, 'Sand Conductivity': 0.6, 'Sand Specific Heat': 1100, 'Mould Temperature': 21, Modulus: 8, Exponent: 2, 'Shakeout Time': 2,
    'Ingate Area': 300, 'Riser Contact': 100, 'Feed Rate': 50, 'Time per Load': 8, 'Parts per Load': 10, Surface: 120000, 'Blast Rate': 0.5,
    'Stub Height': 5, 'Riser Stub Height': 5, 'Parting Line': 800, 'Flash Thickness': 0.5, 'Flash Height': 2, 'Grinding Speed Gating': 410,
    'Grinding Speed Non-Gating': 410, 'Material Factor': 1, 'Inspection Rate': 1.4, Cores: 1, 'Single Core Factor': 1.5, 'Double Core Factor': 2,
    'Multi Core Adder': 0.1, 'Core Volume': 2e6, 'Core Length': 150, 'Print Length': 25, 'Core Sand': 3, 'Cycle per Core': 40, 'Blowing Rate': 12,
    'Core Section': 60, 'Initial Sand Temperature': 20, 'Corebox Temperature': 245, 'Cure Temperature': 150, 'Required Cured Depth': 3,
    'Strip and Handling': 10, 'Lifetime Volume': 10000, 'Refurb Life': 5000, 'Refurbs per Tool': 2, 'One Cavity Cost': 3000, 'Region Multiplier': 1,
  };

  it('every calculator of the spec runs to a finite output on a small iron casting, and every input has a plausible value in this table', () => {
    for (const c of all) {
      const inputs = c.fields.filter((f) => !f.formula).map((f) => f.name);
      expect({ calc: c.name, unlisted: inputs.filter((n) => SMALL_IRON_CASTING[n] === undefined) }).toEqual({ calc: c.name, unlisted: [] });
      const run = runReferenceCalculator(byName, c.name, seeds(Object.fromEntries(inputs.map((n) => [n, SMALL_IRON_CASTING[n]!]))), c.output ?? 'Cycle Time');
      expect({ calc: c.name, finite: run.value != null && Number.isFinite(run.value), missing: run.missing }).toEqual({ calc: c.name, finite: true, missing: [] });
    }
  });
});
