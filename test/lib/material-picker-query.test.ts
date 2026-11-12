import { describe, expect, it } from 'vitest';

import { materialPickerQuery } from '@/lib/features/material-picker-query';

// The Material Database dialog: once a process is selected it lists that process's materials (process_material_groups, migration 879),
// and "All processes" lists the whole catalog. Group and class filters apply either way.
describe('Material Database query', () => {
  it("lists the selected process's materials by default", () => {
    expect(materialPickerQuery({ processGroup: 'Plastic Molding', scope: 'process' })).toEqual({ limit: 1000, processGroup: 'Plastic Molding' });
  });

  it('lists every material for "All processes"', () => {
    expect(materialPickerQuery({ processGroup: 'Plastic Molding', scope: 'all' })).toEqual({ limit: 1000 });
  });

  it('lists every material when no process is selected yet', () => {
    expect(materialPickerQuery({ processGroup: null, scope: 'process' })).toEqual({ limit: 1000 });
  });

  it('keeps the search, group and class filters', () => {
    expect(materialPickerQuery({ processGroup: 'Machining', scope: 'process', search: '6061', materialGroup: 'Aluminium', materialClass: 'Non-Ferrous' }))
      .toEqual({ limit: 1000, processGroup: 'Machining', search: '6061', materialGroup: 'Aluminium', materialClass: 'Non-Ferrous' });
  });
});
