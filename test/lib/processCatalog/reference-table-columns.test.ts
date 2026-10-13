import { describe, expect, it } from 'vitest';

import { strokeFactorColumnOf, withOutputColumnLast } from '@/lib/processCatalog/reference-table-columns';

const columns = [
  { name: 'machine_name', label: 'Machine' },
  { name: 'punch_rate_cycles_min', label: 'Punch Rate' },
  { name: 'tool_change_time_s', label: 'Tool Change Time' },
  { name: 'machine_tonnage_t', label: 'Machine Tonnage' },
];

describe('withOutputColumnLast', () => {
  it('moves the column the input reads to the end, keeping the others in order', () => {
    expect(withOutputColumnLast(columns, 'punch_rate_cycles_min').map((c) => c.name))
      .toEqual(['machine_name', 'tool_change_time_s', 'machine_tonnage_t', 'punch_rate_cycles_min']);
  });

  it('leaves the table as it is when the column is not in it', () => {
    expect(withOutputColumnLast(columns, 'nope').map((c) => c.name)).toEqual(columns.map((c) => c.name));
    expect(withOutputColumnLast(columns, undefined)).toHaveLength(4);
  });
});

describe('strokeFactorColumnOf', () => {
  it('reads the part complexity from the input source text', () => {
    expect(strokeFactorColumnOf('Lookup Table 1 — 22.0 t machine, inter part (sm_reference_data strokeRateFactor)')).toBe('intermediate');
    expect(strokeFactorColumnOf('Lookup Table 1 — 30.6 t machine, simple part')).toBe('simple');
    expect(strokeFactorColumnOf('Lookup Table 1 — 30.6 t machine, complex part')).toBe('complex');
    expect(strokeFactorColumnOf('typed by hand')).toBeUndefined();
  });
});
