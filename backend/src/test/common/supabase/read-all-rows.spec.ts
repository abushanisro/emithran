import * as fs from 'fs';
import * as path from 'path';
import { readAllRows, POSTGREST_MAX_ROWS, type RowPage } from '../../../common/supabase/read-all-rows';

// A table read the way PostgREST serves it: `.range(from, to)` honoured, but
// never more than POSTGREST_MAX_ROWS rows in one response.
function cappedTable(size: number) {
  const rows = Array.from({ length: size }, (_, i) => ({ id: i }));
  let requests = 0;
  const page = async (from: number, to: number): Promise<RowPage<{ id: number }>> => {
    requests += 1;
    const end = Math.min(to, from + POSTGREST_MAX_ROWS - 1);
    return { data: rows.slice(from, end + 1), error: null, count: size };
  };
  return { page, requests: () => requests };
}

describe('readAllRows', () => {
  it('returns every row of a table larger than one capped response (1688 USA machines)', async () => {
    const table = cappedTable(1688);
    const { data, count } = await readAllRows(table.page);
    expect(data).toHaveLength(1688);
    expect(new Set(data.map((r) => r.id)).size).toBe(1688);
    expect(count).toBe(1688);
    expect(table.requests()).toBe(2);
  });

  it('reads an exact multiple of the cap without losing the last page', async () => {
    const { data } = await readAllRows(cappedTable(2000).page);
    expect(data).toHaveLength(2000);
  });

  it('reads only the requested window', async () => {
    const { data } = await readAllRows(cappedTable(3402).page, { from: 1500, to: 2599 });
    expect(data.map((r) => r.id)).toEqual(Array.from({ length: 1100 }, (_, i) => 1500 + i));
  });

  it('stops and reports the first failing page', async () => {
    const { data, error } = await readAllRows(async (from) =>
      from === 0
        ? { data: Array.from({ length: POSTGREST_MAX_ROWS }, (_, i) => ({ id: i })), error: null }
        : { data: null, error: { message: 'permission denied' } });
    expect(error?.message).toBe('permission denied');
    expect(data).toHaveLength(POSTGREST_MAX_ROWS);
  });
});

// No read may ask the server for more rows than one response can carry: the
// server silently truncates, so such a read loses data without an error. Read
// through readAllRows instead.
describe('no single read above the PostgREST row cap', () => {
  const srcRoot = path.resolve(__dirname, '../../..');
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (entry.name !== 'test') walk(p); }
      else if (entry.name.endsWith('.ts')) files.push(p);
    }
  };
  walk(srcRoot);

  it('has no .limit(n) or .range(a, b) larger than POSTGREST_MAX_ROWS', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const text = fs.readFileSync(f, 'utf8');
      for (const m of text.matchAll(/\.limit\((\d+)\)/g)) {
        if (Number(m[1]) > POSTGREST_MAX_ROWS) offenders.push(`${path.relative(srcRoot, f)}: ${m[0]}`);
      }
      for (const m of text.matchAll(/\.range\((\d+),\s*(\d+)\)/g)) {
        if (Number(m[2]) - Number(m[1]) + 1 > POSTGREST_MAX_ROWS) offenders.push(`${path.relative(srcRoot, f)}: ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
