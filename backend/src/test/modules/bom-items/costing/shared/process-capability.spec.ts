import { join } from 'path';
import {
  processHolds,
  requiredItGrade,
  resolveCapabilityTable,
  resolveIsoTable,
} from '../../../../../modules/bom-items/costing/shared/tolerance/process-capability';

// Real data only: memory/Standards (ISO 286-1) and memory/Machining
// tblGtolProcessCapabilities, read with the CSV reader the staging uses.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { readCsv } = require('../../../../../../migrations/scripts/lib/memory-machine-seed.js');
const MEM = join(__dirname, '../../../../../../../memory');
const iso = resolveIsoTable(readCsv(join(MEM, 'Standards/lookup/iso286_standard_tolerances.csv')).rows);
const capRows: Array<Record<string, any>> = readCsv(join(MEM, 'Machining/lookup/tblGtolProcessCapabilities.csv')).rows;
const capability = resolveCapabilityTable(capRows);
const row = (p: string, c: string) => capRows.find((r) => r['Process'] === p && r['GtolCategory'] === c)!;

describe('ISO 286-1 grade of a tolerance band', () => {
  it('a band equal to a grade value is that grade (18-30 mm: IT7 = 21 um)', () => {
    expect(requiredItGrade(0.021, 25, iso)).toBe(7);
  });
  it('a band between two grades is the finer-fitting one (25 um at 25 mm is IT7, not IT8 = 33 um)', () => {
    expect(requiredItGrade(0.025, 25, iso)).toBe(7);
  });
  it('the size range includes its upper bound (30 mm is in 18-30)', () => {
    expect(requiredItGrade(0.021, 30, iso)).toBe(7);
    expect(requiredItGrade(0.021, 30.01, iso)).toBe(6); // 30-50: IT6 = 16, IT7 = 25
  });
  it('finer than IT1 or beyond 3150 mm is undecidable', () => {
    expect(requiredItGrade(0.0001, 25, iso)).toBeNull();
    expect(requiredItGrade(1, 4000, iso)).toBeNull();
  });
});

describe('process capability (tblGtolProcessCapabilities)', () => {
  const hpdcBest = Number(row('High Pressure Die Casting', 'diamTolerance')['Best Achievable']);
  const reamBest = Number(row('Reaming', 'diamTolerance')['Best Achievable']);

  it('a hole toleranced finer than HPDC holds is not held by HPDC, and is by reaming', () => {
    // 10 mm hole, +/-0.009 -> band 18 um; in 6-10 mm IT7 = 15 um fits, IT8 = 22 um does not: IT7.
    const req = { category: 'diamTolerance' as const, value: 0.009 };
    expect(requiredItGrade(0.018, 10, iso)).toBe(7);
    expect(7).toBeLessThan(hpdcBest);
    expect(processHolds('High Pressure Die Casting', req, 10, capability, iso).held).toBe(false);
    expect(7).toBeGreaterThanOrEqual(reamBest);
    expect(processHolds('Reaming', req, 10, capability, iso).held).toBe(true);
  });

  it('a loose tolerance is held as cast', () => {
    expect(processHolds('High Pressure Die Casting', { category: 'diamTolerance', value: 0.5 }, 10, capability, iso).held).toBe(true);
  });

  it('roughness compares literally in um', () => {
    const best = Number(row('High Pressure Die Casting', 'roughness')['Best Achievable']);
    expect(processHolds('High Pressure Die Casting', { category: 'roughness', value: best }, null, capability, iso).held).toBe(true);
    expect(processHolds('High Pressure Die Casting', { category: 'roughness', value: best / 2 }, null, capability, iso).held).toBe(false);
  });

  it('an unknown process or a missing size is undecided, with the reason', () => {
    const r1 = processHolds('No Such Process', { category: 'flatness', value: 0.1 }, 10, capability, iso);
    expect(r1.held).toBeNull();
    const r2 = processHolds('Milling', { category: 'flatness', value: 0.1 }, null, capability, iso);
    expect(r2.held).toBeNull();
    expect(r2.detail).toMatch(/size/);
  });
});
