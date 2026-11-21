import { describe, expect, it } from 'vitest';

import { missingMeasures, newRowId, prunedRow, tableOf, tablePatch, withRow, withoutRow, type RowVocabulary, type TableRow } from '@/lib/costing/joint-table';

// A two-kind vocabulary: a seam needs a length and takes a leg; a spot needs a count.
type F = 'count' | 'lengthMm' | 'sizeMm';
const V: RowVocabulary<F> = {
  fields: ['count', 'lengthMm', 'sizeMm'],
  kinds: [{ process: 'Seam', label: 'Seam' }, { process: 'Spot', label: 'Spot' }],
  required: (row) => (row.process === 'Seam' ? ['count', 'lengthMm'] : ['count']),
  optional: (row) => (row.process === 'Seam' ? ['sizeMm'] : []),
  choices: () => null,
  label: (f) => f,
  flags: new Set(),
  rekind: (row, process) => ({ id: row.id, process, count: 1 }),
};

describe('a Cost Guide table (joints, welds)', () => {
  it('reads the rows stored under its key, and nothing else as a row', () => {
    expect(tableOf<F>('welds', { welds: [{ id: 'w1', process: 'Seam' }, { process: 'no id' }, 7, null] })).toEqual([{ id: 'w1', process: 'Seam' }]);
    expect(tableOf('welds', { welds: 'not a table' })).toEqual([]);
    expect(tableOf('welds', null)).toEqual([]);
  });

  it('adds a row, replaces it by its id, removes it; a new id is unique; an empty table clears the key', () => {
    const t = withRow<F>([], { id: 'weld-1', process: 'Seam', count: 1 });
    expect(withRow(t, { id: 'weld-1', process: 'Seam', count: 2 })).toEqual([{ id: 'weld-1', process: 'Seam', count: 2 }]);
    expect(withoutRow(t, 'weld-1')).toEqual([]);
    expect(newRowId([...t, { id: 'weld-2', process: 'Spot' }], 'weld')).toBe('weld-3');
    expect(tablePatch('welds', t)).toEqual({ welds: t });
    expect(tablePatch('welds', [])).toEqual({ welds: null });
  });

  it('names what a row still needs: unset, empty or not positive', () => {
    expect(missingMeasures(V, { id: 'a', process: 'Seam', count: 2 })).toEqual(['lengthMm']);
    expect(missingMeasures(V, { id: 'a', process: 'Seam', count: 0, lengthMm: 300 })).toEqual(['count']);
    expect(missingMeasures(V, { id: 'a', process: 'Spot', count: 8 })).toEqual([]);
  });

  it('saved, a row drops the measures its kind does not take and keeps every other key', () => {
    const row = { id: 'a', process: 'Spot', label: 'Tabs', enabled: false, count: 8, sizeMm: 5, componentId: 'c1' } as TableRow<F>;
    expect(prunedRow(V, row)).toEqual({ id: 'a', process: 'Spot', label: 'Tabs', enabled: false, count: 8, componentId: 'c1' });
    expect(prunedRow(V, { id: 'b', process: 'Seam', count: 1, lengthMm: 300, sizeMm: 5 })).toEqual({ id: 'b', process: 'Seam', count: 1, lengthMm: 300, sizeMm: 5 });
  });
});
