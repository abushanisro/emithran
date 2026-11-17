import { describe, expect, it } from 'vitest';

import { isCostedProcessGroup, processGroupOptionLabel, processGroupToFamilyHint } from '@/lib/features/process-group';

// A Process with no cost model is not costed (the backend's familiesOfProcessGroup), so the Process fields mark it instead of offering it blind:
// a part whose Process had none was priced as whatever it was last analysed as.
describe('process groups with a cost model', () => {
  it.each(['Sheet Metal', 'Machining', 'Plastic Molding', 'Die Casting', 'Sand Casting', 'Casting Investment', 'Sheet Metal - Hydroforming', 'Casting'])('%s is costed', (group) => {
    expect(isCostedProcessGroup(group)).toBe(true);
    expect(processGroupOptionLabel(group)).toBe(group);
  });

  it.each(['Forging', 'Powder Metal', 'Part Assembly'])('%s is not, and its option says so', (group) => {
    expect(isCostedProcessGroup(group)).toBe(false);
    expect(processGroupOptionLabel(group)).toBe(`${group} (not costed yet)`);
  });

  it('no process chosen is not a costed one', () => {
    expect(isCostedProcessGroup(null)).toBe(false);
    expect(isCostedProcessGroup('')).toBe(false);
  });

  it('a Casting part is analysed as a die casting, a hydroformed one as sheet metal; a process with no cost model as nothing', () => {
    expect(processGroupToFamilyHint('Casting')).toBe('die_cast');
    expect(processGroupToFamilyHint('Sheet Metal - Hydroforming')).toBe('sheet_metal');
    expect(processGroupToFamilyHint('Sand Casting')).toBe('sand_cast');
    expect(processGroupToFamilyHint('Forging')).toBeUndefined();
  });
});
