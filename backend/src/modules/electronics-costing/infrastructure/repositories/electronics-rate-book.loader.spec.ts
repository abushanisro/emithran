import { chooseRateRows, type MachineRateRow } from './electronics-rate-book.loader';

const row = (over: Partial<MachineRateRow>): MachineRateRow => ({
  id: 'a',
  machine_name: 'M1',
  location: 'USA',
  mhr_usd_per_hour: 23.03,
  usd_labor_rate_per_hr: 43.21,
  currency_code: 'USD',
  economics_version: null,
  updated_at: '2026-10-08T00:00:00Z',
  ...over,
});

describe('chooseRateRows (a machine stored on more than one row)', () => {
  it('keeps a machine with a single row as it is', () => {
    expect(chooseRateRows([row({})])).toEqual([row({})]);
  });

  it('cites the most recently updated of identical rows, deterministically', () => {
    const older = row({ id: 'old', updated_at: '2026-10-08T00:00:00Z' });
    const newer = row({ id: 'new', updated_at: '2026-10-15T00:00:00Z' });
    expect(chooseRateRows([older, newer])).toEqual([newer]);
    expect(chooseRateRows([newer, older])).toEqual([newer]);
  });

  it('breaks an exact timestamp tie by id so the result never depends on read order', () => {
    const a = row({ id: 'a' });
    const b = row({ id: 'b' });
    expect(chooseRateRows([a, b])).toEqual([b]);
    expect(chooseRateRows([b, a])).toEqual([b]);
  });

  it('refuses rows that disagree on a rate, naming the machine', () => {
    expect(() => chooseRateRows([row({ id: 'a' }), row({ id: 'b', mhr_usd_per_hour: 25 })])).toThrow(/Machine "M1" has 2 rows with different rates/);
    expect(() => chooseRateRows([row({ id: 'a' }), row({ id: 'b', usd_labor_rate_per_hr: 50 })])).toThrow(/different rates/);
  });

  it('resolves each machine on its own', () => {
    const out = chooseRateRows([row({ id: 'a' }), row({ id: 'b', machine_name: 'M2', mhr_usd_per_hour: 9 })]);
    expect(out.map((r) => r.machine_name).sort()).toEqual(['M1', 'M2']);
  });
});
