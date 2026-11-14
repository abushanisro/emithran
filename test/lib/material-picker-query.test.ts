import { describe, expect, it } from 'vitest';

import { PROCESS_MATERIALS, initialMaterialGroup, materialPickerQuery } from '@/lib/features/material-picker-query';

// The Material Database has one group dropdown. With a selected process its first choice is "<process> materials" (the process's linked
// material groups, process_material_groups, migration 879) and it starts there; "All Groups" lists every material; a group lists that group.
describe('Material Database group dropdown', () => {
  it("starts on the selected process's materials, or on All Groups without a process", () => {
    expect(initialMaterialGroup('Sand Casting')).toBe(PROCESS_MATERIALS);
    expect(initialMaterialGroup(null)).toBe('');
  });

  it("asks for the process's materials", () => {
    expect(materialPickerQuery({ processGroup: 'Sand Casting', group: PROCESS_MATERIALS })).toEqual({ limit: 1000, processGroup: 'Sand Casting' });
  });

  it('asks for every material on All Groups', () => {
    expect(materialPickerQuery({ processGroup: 'Sand Casting', group: '' })).toEqual({ limit: 1000 });
  });

  it('asks for one group when a group is chosen (the process does not narrow it further)', () => {
    expect(materialPickerQuery({ processGroup: 'Sand Casting', group: 'Aluminium' })).toEqual({ limit: 1000, materialGroup: 'Aluminium' });
  });

  it('keeps the class filter and the search', () => {
    expect(materialPickerQuery({ processGroup: 'Machining', group: PROCESS_MATERIALS, materialClass: 'Non-Ferrous', search: '6061' }))
      .toEqual({ limit: 1000, processGroup: 'Machining', materialClass: 'Non-Ferrous', search: '6061' });
  });
});
