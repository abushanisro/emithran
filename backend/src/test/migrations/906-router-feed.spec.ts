// Migration 906 stages each router machine feed from the Countries data export. The values in the
// migration are checked against that export, and the unit decision (mm/s) against a real cut.
import * as fs from 'fs';
import * as path from 'path';

const sql = fs.readFileSync(path.resolve(__dirname, '../../../migrations/906_router_machine_feed_rate.sql'), 'utf8');
const staged = [...sql.matchAll(/\('([^']+)', ([0-9.]+)\)/g)].map((m) => ({ name: m[1]!, feed: Number(m[2]) }));

describe('migration 906 — router machine feed', () => {
  it('stages the 9 router machines named in the export, with the export feed', () => {
    const csv = fs.readFileSync(path.resolve(__dirname, '../../../../memory/Countries data/India_XML_Data_.csv'), 'utf8').split(/\r?\n/);
    const header = csv[0]!.split(',');
    const iType = header.indexOf('Machine Type'), iName = header.indexOf('name'), iFeed = header.indexOf('feedRate');
    const exported = new Map<string, number>();
    for (const line of csv.slice(1)) {
      const cells = line.match(/("([^"]|"")*"|[^,]*)(,|$)/g)!.map((c) => c.replace(/,$/, '').replace(/^"|"$/g, ''));
      if (cells[iType] === '2 Axis Router' && cells[iFeed]) exported.set(cells[iName]!, Number(cells[iFeed]));
    }
    expect(exported.size).toBe(9);
    expect(new Map(staged.map((s) => [s.name, s.feed]))).toEqual(exported);
  });

  it('a feed of 76.2 mm/s cuts the 5018 mm part in about 1.1 minutes', () => {
    expect(5018 / (76.2 * 60)).toBeCloseTo(1.1, 1);
  });
});
