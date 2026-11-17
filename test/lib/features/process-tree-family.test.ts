import { describe, it, expect } from 'vitest';

import { firstStepHoldsUnclaimedFeatures, isMachiningTreeFamily, showsCatalogOperations, showsStepTextRows } from '@/lib/features/process-tree-family';

describe('process-tree-family', () => {
  it('sheet metal, plastic molding and sand casting show catalog operations; the others the machining tree', () => {
    for (const f of ['sheet_metal', 'plastic_molded', 'sand_cast']) {
      expect(showsCatalogOperations(f)).toBe(true);
      expect(isMachiningTreeFamily(f)).toBe(false);
    }
    expect(isMachiningTreeFamily('machined')).toBe(true);
    expect(isMachiningTreeFamily('')).toBe(false);
  });

  it('a sand-casting step lists only features (its time is on the cost tab, not a row in the tree)', () => {
    expect(showsStepTextRows('sand_cast')).toBe(false);
    expect(showsStepTextRows('sheet_metal')).toBe(true);
    expect(showsStepTextRows('machined')).toBe(true);
  });
});

describe('the features no step claims', () => {
  it('sit under the first step of a machined part, which machines it', () => {
    for (const f of ['milled', 'turned', 'mill_turn']) expect(firstStepHoldsUnclaimedFeatures(f)).toBe(true);
  });
  it('are not put under the first step of a cast or forged part (melting, a wax pattern, sawing the bar)', () => {
    for (const f of ['die_cast', 'investment_cast', 'forged', 'sand_cast', '']) expect(firstStepHoldsUnclaimedFeatures(f)).toBe(false);
  });
});
