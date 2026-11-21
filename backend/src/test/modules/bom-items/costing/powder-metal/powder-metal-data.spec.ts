// The Powder Metal data: its machines' crews and India twins (migration 1101) and its powders' density and material group (migration 1102),
// from memory/Powder metal and memory/Countries data.
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';

interface Csv { columns: string[]; rows: Record<string, string | number | boolean | null | undefined>[] }
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { readCsv } = require('../../../../../../migrations/scripts/lib/memory-machine-seed.js') as { readCsv: (path: string) => Csv };

const BACKEND = join(__dirname, '../../../../../..');
const MIGRATIONS = join(BACKEND, 'migrations');
const MEMORY = join(BACKEND, '../memory');
const DIR = join(MEMORY, 'Powder metal');
const machinesSql = () => readFileSync(join(MIGRATIONS, '1101_powder_metal_machines.sql'), 'utf8');
const materialsSql = () => readFileSync(join(MIGRATIONS, '1102_powder_metal_materials.sql'), 'utf8');
const MACHINE_FILES = { powder_metal_compaction_pressing: 'machines_compaction_pressing.csv', powder_metal_furnace_sintering: 'machines_furnace_sintering.csv' };

/** Runs a generator and returns whether it wrote the committed migration back byte for byte. */
function regenerates(script: string, read: () => string): boolean {
  const committed = read();
  execFileSync('node', [join(BACKEND, 'scripts', script)], { stdio: 'ignore' });
  return read() === committed;
}

describe('the Powder Metal machines (migration 1101)', () => {
  it('is what the generator writes from memory/', () => {
    expect(regenerates('generate-powder-metal-machines-migration.js', machinesSql)).toBe(true);
  });

  it('sets every machine\'s crew to the one memory gives it (half an operator on the smaller presses, one and a half on the 36" belt)', () => {
    const crew = (cls: string, name: string) => new RegExp(`\\(\\$str\\$${cls}\\$str\\$, \\$str\\$${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\$str\\$, ([0-9.]+)::numeric\\)`);
    let n = 0;
    for (const [cls, file] of Object.entries(MACHINE_FILES)) {
      for (const r of readCsv(join(DIR, 'Machines', file)).rows) {
        const m = crew(cls, String(r.Name)).exec(machinesSql());
        expect([r.Name, Number(m?.[1])]).toEqual([r.Name, Number(r['Number of Operators'])]);
        n += 1;
      }
    }
    expect(n).toBe(16);
    expect(machinesSql()).toContain('($str$powder_metal_compaction_pressing$str$, $str$Gasbarre DSP - 100 ton$str$, 0.5::numeric)');
    expect(machinesSql()).toContain('($str$powder_metal_furnace_sintering$str$, $str$Abbott - 36" Belt$str$, 1.5::numeric)');
  });

  it('adds the 16 India twins at the export\'s overheads (to cents) and the India rate of the 4 - Metal grade', () => {
    const twins = machinesSql().split('\n').filter((l) => l.startsWith('    ($str$India$str$'));
    expect(twins).toHaveLength(16);
    for (const l of twins) expect(l).toMatch(/\$str\$, 2\.3, [0-9.]+, [0-9.]+, \$str\$/);
    // memory/Countries data/India_XML_Data_.csv: direct 12.92564 and indirect 1.0386 USD/hr; 17.39332 and 3.00255.
    expect(twins.join('\n')).toContain('$str$powder_metal_compaction_pressing$str$, $str$Gasbarre DSP - 100 ton$str$, 2.3, 12.93, 1.04,');
    expect(twins.join('\n')).toContain('$str$powder_metal_furnace_sintering$str$, $str$Abbott - 12" Belt$str$, 2.3, 17.39, 3,');
    const grades = new Map(readCsv(join(DIR, 'wage_grade_associations.csv')).rows.map((r) => [String(r['Process Name']), r['Wage Grade Name']]));
    expect([grades.get('Compaction Pressing'), grades.get('Furnace Sintering')]).toEqual(['4 - Metal', '4 - Metal']);
  });
});

describe('the Powder Metal powders (migration 1102)', () => {
  it('is what the generator writes from memory/', () => {
    expect(regenerates('generate-powder-metal-materials-migration.js', materialsSql)).toBe(true);
  });

  it('gives each powder its green density, in kg/m³ and g/cm³, only where empty', () => {
    const powders = readCsv(join(DIR, 'Raw material/raw_materials.csv')).rows;
    expect(powders).toHaveLength(7);
    for (const p of powders) expect(materialsSql()).toContain(`($str$${String(p.Name)}$str$, ${Number(p['Green Density (kg / m^3)'])}::numeric)`);
    expect(materialsSql()).toContain('density_kg_m3 = COALESCE(rm.density_kg_m3, v.green_density)');
    expect(materialsSql()).toContain('density = COALESCE(rm.density, v.green_density / 1000)');
  });

  it('links Powder Metal to its own material group', () => {
    expect(materialsSql()).toContain('INSERT INTO process_material_groups (process_group, material_group) VALUES ($str$Powder Metal$str$, $str$Powder Metal$str$)');
  });
});
