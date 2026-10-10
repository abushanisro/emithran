// Traceability: migration 894 must carry exactly the press brake capability
// in memory/Sheetmetal/machine/machine_library.csv (the roadmap source) — a
// typo in the SQL VALUES list would silently mis-size a real machine.
import * as fs from 'fs';
import * as path from 'path';

const root = path.resolve(__dirname, '../../../..');
const csv = fs.readFileSync(path.join(root, 'memory/Sheetmetal/machine/machine_library.csv'), 'utf8').replace(/^﻿/, '');
const sql = fs.readFileSync(path.join(root, 'backend/migrations/894_press_brake_bend_length_thickness_from_machine_library.sql'), 'utf8');

const [header, ...lines] = csv.split(/\r?\n/).filter(Boolean);
const cols = header.split(',');
const library = lines
  .map((l) => l.split(','))
  .map((c) => Object.fromEntries(cols.map((k, i) => [k, c[i]])))
  .filter((r) => r.machine_category === 'Bend Press Brake');

// ('name', bend, steel, ss, al, kN)
const rows = [...sql.matchAll(/\('([^']+)',\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)\)/g)]
  .map((m) => ({ name: m[1], bend: +m[2], steel: +m[3], ss: +m[4], al: +m[5], kn: +m[6] }));

describe('migration 894 ↔ machine_library.csv', () => {
  it('covers every library press brake except the "Default Bend Brake" placeholder', () => {
    const expected = library.map((r) => r.name).filter((n) => n !== 'Default Bend Brake').sort();
    expect(rows.map((r) => r.name).sort()).toEqual(expected);
  });

  it.each(rows.map((r) => [r.name, r]))('%s: values match the library exactly', (_name, row) => {
    const lib = library.find((r) => r.name === (row as any).name)!;
    expect((row as any).bend).toBe(Number(lib.max_bend_length_mm));
    expect((row as any).steel).toBe(Number(lib.max_thickness_steel_mm));
    expect((row as any).ss).toBe(Number(lib.max_thickness_stainless_steel_mm));
    expect((row as any).al).toBe(Number(lib.max_thickness_aluminum_mm));
    expect((row as any).kn).toBe(Number(lib.press_force_kn));
  });

  it('never overwrites an existing value (COALESCE on every column)', () => {
    for (const col of ['max_length_mm', 'max_thickness_mm', 'max_tonnage']) {
      expect(sql).toMatch(new RegExp(col + String.raw`\s*=\s*COALESCE\(m\.` + col + ','));
    }
  });
});
