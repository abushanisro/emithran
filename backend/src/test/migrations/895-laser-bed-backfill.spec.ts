// Traceability: migration 895 must carry exactly the laser bed sizes in
// memory/Sheetmetal/machine/machine_library.csv (the roadmap source).
import * as fs from 'fs';
import * as path from 'path';

const root = path.resolve(__dirname, '../../../..');
const csv = fs.readFileSync(path.join(root, 'memory/Sheetmetal/machine/machine_library.csv'), 'utf8').replace(/^﻿/, '');
const sql = fs.readFileSync(path.join(root, 'backend/migrations/895_laser_bed_size_from_machine_library.sql'), 'utf8');

const [header, ...lines] = csv.split(/\r?\n/).filter(Boolean);
const cols = header.split(',');
const library = lines.map((l) => l.split(',')).map((c) => Object.fromEntries(cols.map((k, i) => [k, c[i]])));
const CATEGORY: Record<string, string> = { fiber_laser: 'Fiber Laser Cutting Machine', co2_laser: 'Laser Cutting Machine' };

const rows = [...sql.matchAll(/\('(fiber_laser|co2_laser)',\s*'([^']+)',\s*([\d.]+),\s*([\d.]+)\)/g)]
  .map((m) => ({ cls: m[1], name: m[2], len: +m[3], wid: +m[4] }));

describe('migration 895 ↔ machine_library.csv', () => {
  it.each(Object.entries(CATEGORY))('%s covers every "%s" machine', (cls, category) => {
    const expected = library.filter((r) => r.machine_category === category).map((r) => r.name).sort();
    expect(rows.filter((r) => r.cls === cls).map((r) => r.name).sort()).toEqual(expected);
  });

  it.each(rows.map((r) => [`${r.cls} ${r.name}`, r]))('%s: bed matches the library', (_label, row) => {
    const r = row as typeof rows[number];
    const lib = library.find((l) => l.machine_category === CATEGORY[r.cls] && l.name === r.name)!;
    expect(r.len).toBe(Number(lib.bed_length_mm));
    expect(r.wid).toBe(Number(lib.bed_width_mm));
  });

  it('never overwrites an existing value', () => {
    for (const col of ['max_x_mm', 'max_y_mm']) {
      expect(sql).toMatch(new RegExp(col + String.raw`\s*=\s*COALESCE\(m\.` + col + ','));
    }
  });
});
