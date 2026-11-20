// Migration 1096: the Machining machines' fractional crews, from memory/machining/machine (the smallint column of migrations 738 and 829
// stored 0.25 as 0 and 0.5 as 1; migration 971 widened it without restoring them).
import { execFileSync } from 'child_process';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

interface Csv { columns: string[]; rows: Record<string, string | number | boolean | undefined>[] }
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { readCsv } = require('../../../../migrations/scripts/lib/memory-machine-seed.js') as { readCsv: (path: string) => Csv };

const BACKEND = join(__dirname, '../../../..');
const MACHINES = join(BACKEND, '../memory/machining/machine');
const FILE = join(BACKEND, 'migrations/1096_machining_fractional_crews.sql');
const sql = () => readFileSync(FILE, 'utf8');

/** Every machine of memory/machining/machine with its crew, whichever spelling its file uses. */
const crews = readdirSync(MACHINES).filter((f) => f.endsWith('.csv')).flatMap((f) => {
  const { columns, rows } = readCsv(join(MACHINES, f));
  const crew = ['accounting.number_of_operators', 'accounting.numberOfOperators'].find((c) => columns.includes(c));
  const name = ['name', 'primary_id.name'].find((c) => columns.includes(c));
  return crew && name ? rows.map((r) => ({ name: String(r[name]).trim(), operators: Number(r[crew]) })) : [];
});

describe('migration 1096: the Machining machines\' fractional crews', () => {
  it('is what the generator writes from memory/', () => {
    const committed = sql();
    execFileSync('node', [join(BACKEND, 'scripts/generate-machining-crews-migration.js')], { stdio: 'ignore' });
    expect(sql()).toBe(committed);
  });

  it('sets every fractional crew of memory/machining/machine, and no whole one', () => {
    const fractional = crews.filter((c) => !Number.isInteger(c.operators));
    expect(fractional.length).toBe(16);
    for (const c of fractional) expect(sql()).toContain(`($str$${c.name}$str$, ${c.operators})`);
    for (const c of crews.filter((x) => Number.isInteger(x.operators))) expect(sql()).not.toContain(`($str$${c.name}$str$,`);
  });

  it('a multi-spindle is a quarter of an operator, a twin-spindle turning center and the automated deburr cell half of one', () => {
    expect(sql()).toContain('($str$Index MS32-6$str$, 0.25)');
    expect(sql()).toContain('($str$HAAS DS-30Y$str$, 0.5)');
    expect(sql()).toContain('($str$Default Automated Deburr$str$, 0.5)');
  });

  it('writes only operators, on Machining rows by name, and checks nothing is left different', () => {
    expect(sql()).toContain('UPDATE mhr_records m SET operators = v.operators, updated_at = now()');
    expect(sql()).toContain("WHERE m.process_group = 'Machining' AND m.machine_name = v.machine_name AND m.operators IS DISTINCT FROM v.operators;");
    expect(sql()).toContain("RAISE EXCEPTION 'Machining machines whose crew still differs from memory/machining/machine: %'");
  });
});
