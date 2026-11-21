// How the staged reference data is read: a switch as true/false (usePreferredMachines is "true" in every memory domain, and read as a number
// it was never on), and a lookup cell written with thousands separators as the number it is (the open-ended last row of a table).
import { plainCell, resolveSandReference } from '../../../../../modules/bom-items/costing/casting/sand/sand-reference';

const reference = (variables: Record<string, string | null>, lookups: { key: string; rows: Record<string, unknown>[] }[] = []) =>
  resolveSandReference({
    variables: Object.entries(variables).map(([key, value]) => ({ key, value })),
    lookups: lookups.map((l) => ({ key: l.key, raw: { rows: l.rows } })),
  });

describe('a reference switch (flag)', () => {
  it('reads true/false and 1/0, in any case and with spaces; anything else, or nothing, is no answer', () => {
    const ref = reference({ a: 'true', b: 'FALSE', c: ' 1 ', d: '0', e: 'yes', f: '', g: null });
    expect(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'absent'].map((k) => ref.flag(k))).toEqual([true, false, true, false, null, null, null, null]);
  });

  it('usePreferredMachines as staged ("true") is on, though it is not a number', () => {
    const ref = reference({ usePreferredMachines: 'true' });
    expect(ref.number('usePreferredMachines')).toBeNull();
    expect(ref.flag('usePreferredMachines')).toBe(true);
  });

  it('a part\'s own value overrides the plant switch', () => {
    expect(reference({ usePreferredMachines: 'true' }).withOverrides(new Map([['usePreferredMachines', 'false']])).flag('usePreferredMachines')).toBe(false);
  });
});

describe('lookup cells with thousands separators', () => {
  it('lose them, so the open-ended last row is a number (2026-PowderMetal materialHandling, 2026-Hydroform tblMaterialHandling)', () => {
    const ref = reference({}, [{ key: 'materialHandling', rows: [{ 'Weight (kg)': '27.00', 'Load Time (s)': '38' }, { 'Weight (kg)': '4,545,454,545.00', 'Load Time (s)': '50' }] }]);
    const last = ref.table('materialHandling')[1];
    expect(last['Weight (kg)']).toBe('4545454545.00');
    expect(Number(last['Weight (kg)'])).toBe(4545454545);
    expect(ref.table('materialHandling')[0]).toEqual({ 'Weight (kg)': '27.00', 'Load Time (s)': '38' });
  });

  it('only a number written that way changes: text with commas, plain numbers and non-strings are kept as staged', () => {
    expect(['999,999,999.00', '-1,234.5', '125,000.00'].map(plainCell)).toEqual(['999999999.00', '-1234.5', '125000.00']);
    for (const kept of ['Steel, CR, 1010', '1,2', '12,34', '1,234,56', '0.07', 42, null, true]) expect(plainCell(kept)).toBe(kept);
  });

  it('a table staged as a bare array of rows (Multi-Spindle, migration 787) is read the same', () => {
    const ref = resolveSandReference({ variables: [], lookups: [{ key: 'tbl', raw: [{ size: '1,000' }] }] });
    expect(ref.table('tbl')).toEqual([{ size: '1000' }]);
  });
});
