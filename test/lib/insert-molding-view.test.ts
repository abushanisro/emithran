import { describe, expect, it } from 'vitest';

import { insertEntryOf, insertEntryPatch, isInsertMoldingItem, shotCycleOf } from '@/lib/costing/insert-molding-view';
import { insertMoldingRouteKeyOf } from '@/lib/routing/insert-molding-route-id';
import { moldingRouteSelectability } from '@/lib/routing/molding-route-selectability';

describe('the insert molding Cost Guide', () => {
  it('a part is insert molded by its Process', () => {
    expect(isInsertMoldingItem({ scenarioOverrides: { processGroup: 'Assembly Molding' } })).toBe(true);
    expect(isInsertMoldingItem({ scenarioOverrides: { processGroup: 'Plastic Molding' } })).toBe(false);
    expect(isInsertMoldingItem({})).toBe(false);
  });

  it('reads the entered inserts defensively and writes them back, a missing count clearing the entry', () => {
    expect(insertEntryOf({ insertMoldingInserts: { count: 2, weightKg: 0.005, name: 'Pin' } })).toEqual({ count: 2, weightKg: 0.005, name: 'Pin' });
    expect(insertEntryOf({ insertMoldingInserts: { count: -1, weightKg: 'x' } })).toEqual({ count: null, weightKg: null, name: '' });
    expect(insertEntryPatch({ count: 2.4, weightKg: 0.005, name: ' Pin ' })).toEqual({ insertMoldingInserts: { count: 2, weightKg: 0.005, name: 'Pin' } });
    expect(insertEntryPatch({ count: null, weightKg: 1, name: '' })).toEqual({ insertMoldingInserts: null });
  });

  it('reads an insert molding route id as its load method key, any other route as none', () => {
    expect(insertMoldingRouteKeyOf('im-insert-manual')).toBe('manual');
    expect(insertMoldingRouteKeyOf('im-insert-3-axis')).toBe('3_axis');
    expect(insertMoldingRouteKeyOf('im-structural-foam-molding')).toBeUndefined();
  });

  it('an insert molding route can be set in the Workflow Builder when it is priced', () => {
    const route = { routeId: 'im-insert-6-axis', isFeasible: true, warnings: [], capability: { warnings: [] } } as never;
    expect(moldingRouteSelectability(route)).toEqual({ selectable: true, note: 'Insert molding with this load method: the Cost tab quotes it once it is applied.' });
  });
});

describe('the insert molding panel', () => {
  it('explains the shot: overlapped on a table press, in series without one', () => {
    expect(shotCycleOf({ press: { name: 'p', tableConfiguration: 'Rotary', tablePress: true, reasons: [] } }).rule).toBe('longer of loading and molding');
    expect(shotCycleOf({ press: { name: 'p', tableConfiguration: null, tablePress: false, reasons: [] } }).rule).toBe('loading + molding');
  });
});
