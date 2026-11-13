import { describe, expect, it } from 'vitest';

import { isMachiningTreeFamily, showsCatalogOperations } from '@/lib/features/process-tree-family';

// The process tree: which families show each step's catalog operations (operation -> the features it makes, from the backend's
// catalogOperations) and which show machining feature breakdowns. A sand casting is the first kind: its moulding and coring steps carry the
// sand catalog operations ("As Cast", "Sand Casting", "No Bake // SimpleHole -> As Cored"). Counting it as machining hung every feature
// under the first step.
describe('process tree family rules', () => {
  it.each(['sheet_metal', 'plastic_molded', 'sand_cast'])('%s shows catalog operations and is not machining', (family) => {
    expect(showsCatalogOperations(family)).toBe(true);
    expect(isMachiningTreeFamily(family)).toBe(false);
  });
  it.each(['milled', 'turned', 'mill_turn', 'die_cast'])('%s is a machining-tree family', (family) => {
    expect(isMachiningTreeFamily(family)).toBe(true);
    expect(showsCatalogOperations(family)).toBe(false);
  });
  it('no family is neither', () => {
    expect(isMachiningTreeFamily('')).toBe(false);
    expect(showsCatalogOperations('')).toBe(false);
  });
});
