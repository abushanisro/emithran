import { describe, it, expect } from 'vitest';
import { processesForMaterialGroups } from '@/lib/features/process-group';

// The links as migration 879 seeds them (process_material_groups).
const links = [
  { processGroup: 'Die Casting', materialGroup: 'Die Casting' },
  { processGroup: 'Sand Casting', materialGroup: 'Sand Casting' },
  { processGroup: 'Casting', materialGroup: 'Casting' },
  { processGroup: 'Machining', materialGroup: 'Machining' },
  { processGroup: 'Machining', materialGroup: 'Ferrous & Non-Ferrous' },
  { processGroup: 'Stock Machining', materialGroup: 'Ferrous & Non-Ferrous' },
  { processGroup: 'Sheet Metal', materialGroup: 'Ferrous & Non-Ferrous' },
  { processGroup: 'Plastic Molding', materialGroup: 'Plastic & Rubber' },
];
const selectable = ['Die Casting', 'Sand Casting', 'Casting', 'Machining', 'Stock Machining', 'Sheet Metal', 'Plastic Molding'];

describe('processesForMaterialGroups', () => {
  it('a die-casting alloy gives exactly Die Casting', () => {
    expect(processesForMaterialGroups(['Die Casting'], links, selectable)).toEqual(['Die Casting']);
  });

  it('a bar / sheet grade gives every process its group feeds: the engineer picks', () => {
    expect(processesForMaterialGroups(['Ferrous & Non-Ferrous'], links, selectable)).toEqual(['Machining', 'Sheet Metal', 'Stock Machining']);
  });

  it('a name in several groups gives the union; only selectable processes count', () => {
    expect(processesForMaterialGroups(['Die Casting', 'Sand Casting'], links, ['Die Casting'])).toEqual(['Die Casting']);
    expect(processesForMaterialGroups(['Die Casting', 'Sand Casting'], links, selectable)).toEqual(['Die Casting', 'Sand Casting']);
  });

  it('an unknown group gives none', () => {
    expect(processesForMaterialGroups(['Composites'], links, selectable)).toEqual([]);
  });
});
