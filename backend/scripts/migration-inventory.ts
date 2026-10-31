// What the migrations hold: for every migration file, whether it changes the schema, writes data, or both, and which tables
// receive rows from migrations at all. The tables that migrations fill are where eMithran's reference data lives today; this is
// the inventory step 4 of the on-premises plan starts from (docs/ENGINEERING.md).
//
//   npm run migrations:inventory                 summary on stdout
//   npm run migrations:inventory -- --json FILE  the full inventory as JSON
import * as fs from 'fs';
import * as path from 'path';

import { classifyStatement, splitStatements, type Statement } from '../src/common/migrations/sql-statements';

interface FileReport {
  file: string;
  kind: 'schema' | 'data' | 'mixed' | 'procedural' | 'empty';
  schemaStatements: number;
  dataStatements: number;
  proceduralStatements: number;
  tables: Record<string, { statements: number; rows: number; verbs: string[] }>;
}

const migrationsDir = path.join(__dirname, '../migrations');
const files = [
  ...fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).map((f) => path.join(migrationsDir, f)),
  ...fs.readdirSync(path.join(migrationsDir, 'calculators')).filter((f) => f.endsWith('.sql')).map((f) => path.join(migrationsDir, 'calculators', f)),
].sort();

const tableName = (t: string) => (t.includes('.') ? t : `public.${t}`);

function report(file: string): FileReport {
  const statements: Statement[] = splitStatements(fs.readFileSync(file, 'utf8')).map(classifyStatement);
  const r: FileReport = {
    file: path.relative(migrationsDir, file),
    kind: 'empty',
    schemaStatements: statements.filter((s) => s.kind === 'schema').length,
    dataStatements: statements.filter((s) => s.kind === 'data').length,
    proceduralStatements: statements.filter((s) => s.kind === 'procedural').length,
    tables: {},
  };
  for (const s of statements.filter((x) => x.kind === 'data')) {
    const t = (r.tables[tableName(s.table!)] ??= { statements: 0, rows: 0, verbs: [] });
    t.statements++;
    t.rows += s.rows ?? 0;
    if (!t.verbs.includes(s.verb!)) t.verbs.push(s.verb!);
  }
  r.kind =
    r.schemaStatements && r.dataStatements ? 'mixed'
    : r.dataStatements ? 'data'
    : r.schemaStatements ? 'schema'
    : r.proceduralStatements ? 'procedural'
    : 'empty';
  return r;
}

const reports = files.map(report);
const byTable = new Map<string, { files: number; rows: number; inserts: number; updates: number }>();
for (const r of reports) {
  for (const [table, t] of Object.entries(r.tables)) {
    const agg = byTable.get(table) ?? { files: 0, rows: 0, inserts: 0, updates: 0 };
    agg.files++;
    agg.rows += t.rows;
    if (t.verbs.includes('INSERT') || t.verbs.includes('COPY')) agg.inserts += t.statements;
    if (t.verbs.includes('UPDATE') || t.verbs.includes('DELETE')) agg.updates += t.statements;
    byTable.set(table, agg);
  }
}

const jsonAt = process.argv.indexOf('--json');
if (jsonAt !== -1) {
  const out = process.argv[jsonAt + 1];
  if (!out) throw new Error('--json needs a file');
  const tables = Object.fromEntries([...byTable.entries()].sort(([a], [b]) => a.localeCompare(b)));
  fs.writeFileSync(out, `${JSON.stringify({ files: reports, tables }, null, 2)}\n`);
}

const count = (k: FileReport['kind']) => reports.filter((r) => r.kind === k).length;
console.log(`${reports.length} migration files: ${count('schema')} schema, ${count('data')} data, ${count('mixed')} mixed, ${count('procedural')} procedural only, ${count('empty')} empty`);
console.log(`${byTable.size} tables receive rows from migrations (rows counted from INSERT ... VALUES only):`);
for (const [table, t] of [...byTable.entries()].sort((a, b) => b[1].rows - a[1].rows)) {
  console.log(`  ${table.padEnd(56)} ${String(t.rows).padStart(7)} rows  ${String(t.files).padStart(3)} files  ${t.inserts} inserts  ${t.updates} updates/deletes`);
}
