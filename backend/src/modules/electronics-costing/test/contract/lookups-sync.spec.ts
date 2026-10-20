import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { TABLES, render, outDir } = require('../../../../../scripts/sync-electronics-lookups');

// Each lookup table is data in memory/Electronics; the TypeScript copy is generated from it.
describe('electronics lookup tables (memory/Electronics)', () => {
  it.each(TABLES.map((t: { csv: string; out: string }) => [t.csv, t] as const))('the generated copy of %s matches the CSV', (_csv, table) => {
    expect(readFileSync(join(outDir, table.out), 'utf8')).toBe(render(table));
  });
});
