import { describe, expect, it } from 'vitest';

import { columnShares, type ReferenceColumn } from '@/lib/calculators/reference-table';

// The Variables table of a casting domain: a name, a unit, a long note and the value. The note used to make the table wider than its panel,
// so it sat hidden behind the pinned value column and showed through the highlighted row.
const columns: ReferenceColumn[] = [{ name: 'key', label: 'Variable' }, { name: 'unit', label: 'Unit' }, { name: 'notes', label: 'Notes' }, { name: 'value', label: 'Value' }];
const rows = [
  { key: 'ingateGap', unit: 'Length', notes: 'Average distance between the ingate and the edge of the mold, measured along the runner.', value: 152.4 },
  { key: 'ladlePourRateGravityDieCasting', unit: 'Volume/Time', notes: null, value: 10 },
];
const cell = (row: Record<string, unknown>, column: string) => row[column];

describe('columnShares', () => {
  const shares = columnShares(columns, rows, cell);

  it('gives every column a share and the shares fill the table', () => {
    expect(shares).toHaveLength(4);
    expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 6);
    for (const s of shares) expect(s).toBeGreaterThan(0);
  });

  it('sizes a column by the longest text it shows, a long note no wider than the cap', () => {
    const [name, unit, notes, value] = shares;
    // 30 characters (the longest name), 11 (Volume/Time), 36 (the cap, not the 88-character note), 6 (the floor, not "152.4").
    expect(name! / unit!).toBeCloseTo(30 / 11, 6);
    expect(notes! / value!).toBeCloseTo(36 / 6, 6);
  });

  it('a header with its unit is room the column needs even when its cells are short', () => {
    const [only] = columnShares([{ name: 'a', label: 'Cutting Speed', unit: 'm/min' }, { name: 'b', label: 'B' }], [{ a: 1, b: 2 }], cell);
    expect(only).toBeCloseTo((100 * 21) / 27, 6); // "Cutting Speed" + " (m/min)" = 21 characters against the 6 of the floor
  });
});
