// The Sheet Metal - Hydroforming machine data (migration 1109): the hydroform presses' rates and forming time, the offline blanking presses'
// stroke and handling data, and the India twins, from memory/Sheetmetal Hydroforming and memory/Countries data.
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';

interface Csv { columns: string[]; rows: Record<string, string | number | boolean | null | undefined>[] }
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { readCsv } = require('../../../../../../migrations/scripts/lib/memory-machine-seed.js') as { readCsv: (path: string) => Csv };

const BACKEND = join(__dirname, '../../../../../..');
const MIGRATIONS = join(BACKEND, 'migrations');
const MEMORY = join(BACKEND, '../memory');
const DIR = join(MEMORY, 'Sheetmetal Hydroforming');
const machinesSql = () => readFileSync(join(MIGRATIONS, '1109_hydroforming_machines.sql'), 'utf8');

/** The export's Sheet Metal - Hydroforming row of a machine. */
function exportRow(country: string, name: string): Record<string, unknown> {
  const t = readCsv(join(MEMORY, 'Countries data', `${country}_XML_Data_.csv`));
  const row = t.rows.find((r) => r.Commodity === 'Sheet Metal - Hydroforming' && r.name === name);
  if (!row) throw new Error(`${country}: no ${name}`);
  return row;
}

describe('the Sheet Metal - Hydroforming machines (migration 1109)', () => {
  it('is what the generator writes from memory/', () => {
    const committed = machinesSql();
    execFileSync('node', [join(BACKEND, 'scripts/generate-hydroforming-machines-migration.js')], { stdio: 'ignore' });
    expect(machinesSql()).toBe(committed);
  });

  it('rates each USA hydroform press at the Netherlands overheads (to cents) and gives it the forming cycle time of the exports', () => {
    const presses = readCsv(join(DIR, 'Machine/machines_hydroform.csv')).rows;
    expect(presses).toHaveLength(38);
    for (const p of presses) {
      const nl = exportRow('Netherlands', String(p.Name));
      const d = Math.round(Number(nl.customWorkCenterDirectOverheadRate) * 100) / 100;
      const i = Math.round(Number(nl.customWorkCenterIndirectOverheadRate) * 100) / 100;
      expect(machinesSql()).toContain(`($str$${String(p.Name)}$str$, ${d}::numeric, ${i}::numeric)`);
      expect(machinesSql()).toContain(`($str$${String(p.Name)}$str$, ${Number(nl.machineFormingCycleTime)}::numeric)`);
    }
    // memory/Countries data/Netherlands: 69.14 + 18.76 USD/hr, a 45 s forming cycle.
    expect(machinesSql()).toContain('($str$Hydroform Press - Deep Draw - 456 Dia$str$, 69.14::numeric, 18.76::numeric)');
    expect(machinesSql()).toContain('usd_labor_rate_per_hr = 36.3, usd_lhr_total = 36.3, benchmark_labor_rate_usd_hr = 36.3');
    expect(machinesSql()).toContain('AND m.mhr_usd_per_hour IS NULL;');
  });

  it('gives each offline blanking press its press cycle time and handling coefficients', () => {
    expect(machinesSql()).toContain('($str$Bliss - B-55$str$, $jsonb${"press_cycle_time_s":2.83,"mass_coeff_handling_time_s_per_kg":0.034,');
    expect((machinesSql().match(/"press_cycle_time_s":/g) ?? [])).toHaveLength(18);
  });

  it('twins all 56 in India at the India export\'s overheads and the 3 - Metal India labour (1.73)', () => {
    const twins = machinesSql().split('\n').filter((l) => l.startsWith('    ($str$India$str$'));
    expect(twins).toHaveLength(56);
    for (const l of twins) expect(l).toMatch(/\$str\$, 1\.73, [0-9.]+, [0-9.]+, \$str\$/);
    expect(twins.join('\n')).toContain('$str$hydroform$str$, $str$Hydroform Press - Deep Draw - 456 Dia$str$, 1.73, 51.38, 2.64,');
    expect(twins.join('\n')).toContain('$str$hydroform_offline_blank$str$, $str$Bliss - B-55$str$, 1.73, 62.45, 4.11,');
    const grades = new Map(readCsv(join(DIR, 'hydroforming_wage_grade_associations.csv')).rows.map((r) => [String(r['Process Name']), r['Wage Grade Name']]));
    expect([grades.get('Hydroform'), grades.get('Offline Blank')]).toEqual(['3 - Metal', '3 - Metal']);
  });
});
