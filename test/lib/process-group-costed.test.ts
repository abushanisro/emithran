import { describe, expect, it } from 'vitest';

import { isCostedProcessGroup, processGroupOptionLabel, processGroupToFamilyHint, routingFamilyOf } from '@/lib/features/process-group';

// A Process with no cost model is not costed (the backend's familiesOfProcessGroup), so the Process fields mark it instead of offering it blind:
// a part whose Process had none was priced as whatever it was last analysed as.
describe('process groups with a cost model', () => {
  it.each(['Sheet Metal', 'Machining', 'Plastic Molding', 'Die Casting', 'Sand Casting', 'Casting Investment', 'Sheet Metal - Hydroforming', 'Casting', 'Forging', 'Powder Metal', 'Additive Manufacturing', 'Bar and Tube Fabrication', 'Assembly', 'Assembly Molding', 'Part Assembly'])('%s is costed', (group) => {
    expect(isCostedProcessGroup(group)).toBe(true);
    expect(processGroupOptionLabel(group)).toBe(group);
  });

  it.each(['Rapid Prototyping', 'Roto & Blow Molding'])('%s is not, and its option says so', (group) => {
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
    expect(processGroupToFamilyHint('Forging')).toBe('forged');
    expect(processGroupToFamilyHint('Powder Metal')).toBe('powder_metal');
    expect(processGroupToFamilyHint('Composites')).toBe('composite');
    expect(processGroupToFamilyHint('Additive Manufacturing')).toBe('additive');
    expect(processGroupToFamilyHint('Bar and Tube Fabrication')).toBe('bar_tube');
    expect(processGroupToFamilyHint('Rapid Prototyping')).toBeUndefined();
    // An assembly and a weldment are costed from their children and the Cost Guide: there is no CAD extractor to force for them.
    expect(processGroupToFamilyHint('Assembly')).toBeUndefined();
    expect(processGroupToFamilyHint('Part Assembly')).toBeUndefined();
    // Insert molding is analysed as the molded plastic part it is.
    expect(processGroupToFamilyHint('Assembly Molding')).toBe('plastic_molded');
  });

  it('the Workflow Builder lists an assembly\'s or a weldment\'s routes by the family it is costed as, any other part\'s by its CAD family', () => {
    // A part analysed as milled whose Process is now Part Assembly; an assembly with no model at all.
    expect(routingFamilyOf('milled', 'part_assembly')).toBe('part_assembly');
    expect(routingFamilyOf(null, 'assembly')).toBe('assembly');
    // Every other part keeps its CAD family, as before (and none while its cost is loading).
    expect(routingFamilyOf('die_cast', 'sand_cast')).toBe('die_cast');
    expect(routingFamilyOf('milled', undefined)).toBe('milled');
    expect(routingFamilyOf(undefined, undefined)).toBeNull();
  });
});
