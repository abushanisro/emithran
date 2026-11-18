import { describe, expect, it } from 'vitest';

import { insertEntryOf, insertEntryPatch, insertRouteRows, isInsertMoldingItem, shotCycleOf } from '@/lib/costing/insert-molding-view';
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
  const option = (route: string, label: string, totalCost: number | null, reason: string | null = null) => ({ route, label, complete: totalCost != null, totalCost, reason });
  // Back cover: 4 x M3 inserts on an Arburg with no table, quoted on the 3-axis robot.
  const im = {
    route: 'im-insert-3-axis',
    options: [
      option('im-insert-manual', 'Insert molding · manual load', 2.16),
      option('im-insert-3-axis', 'Insert molding · 3-axis robot', 1.3712),
      option('im-insert-6-axis', 'Insert molding · 6-axis robot', 1.3749),
    ],
  };

  it('lists each load method once, without repeating "Insert molding", and marks the quoted one', () => {
    const rows = insertRouteRows(im);
    expect(rows.map((r) => r.method)).toEqual(['manual load', '3-axis robot', '6-axis robot']);
    expect(rows.filter((r) => r.quoted).map((r) => r.route)).toEqual(['im-insert-3-axis']);
  });

  it('says when a route not quoted costs the same to the cent (the 6-axis tie that read as an unexplained choice)', () => {
    expect(insertRouteRows(im).map((r) => r.sameAsQuoted)).toEqual([false, false, true]);
  });

  it('keeps the reason of a route that could not be costed', () => {
    const rows = insertRouteRows({ ...im, options: [...im.options, option('im-insert-x', 'Insert molding · x', null, 'no robot takes a 0.2 kg insert')] });
    expect(rows.at(-1)).toMatchObject({ cost: null, reason: 'no robot takes a 0.2 kg insert', sameAsQuoted: false });
  });

  it('explains the shot: overlapped on a table press, in series without one', () => {
    expect(shotCycleOf({ press: { name: 'p', tableConfiguration: 'Rotary', tablePress: true, reasons: [] } }).rule).toBe('longer of loading and molding');
    expect(shotCycleOf({ press: { name: 'p', tableConfiguration: null, tablePress: false, reasons: [] } }).rule).toBe('loading + molding');
  });
});
