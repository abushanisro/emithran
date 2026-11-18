import { describe, expect, it } from 'vitest';

import { compositesOverrideCount, parsePlyCount, plyGroups } from '@/lib/costing/composites-view';
import { compositesRouteKeyOf } from '@/lib/routing/composites-route-id';

describe('the composites Cost Guide', () => {
  it('lists the ply stack by the region the plies cover: the whole part, then each drop-off', () => {
    const plies = [...Array.from({ length: 8 }, (_, i) => ({ index: i + 1, areaMm2: 60000, perimeterMm: 1000, level: 0 })),
      ...Array.from({ length: 4 }, (_, i) => ({ index: i + 9, areaMm2: 10000, perimeterMm: 400, level: 1 }))];
    expect(plyGroups(plies)).toEqual([{ level: 0, count: 8, areaMm2: 60000 }, { level: 1, count: 4, areaMm2: 10000 }]);
  });

  it('takes a whole, positive ply count, or an empty field for the laminate\'s own', () => {
    expect(parsePlyCount('')).toBeNull();
    expect(parsePlyCount('12')).toBe(12);
    expect(parsePlyCount('2.5')).toBe('invalid');
    expect(parsePlyCount('0')).toBe('invalid');
  });

  it('counts the settings set over the engine\'s, not the route picked in the Workflow Builder', () => {
    expect(compositesOverrideCount({ compositesPlyCount: 10, compositesCore: 'none', compositesRoute: 'tape_layup' })).toBe(2);
    expect(compositesOverrideCount({})).toBe(0);
  });

  it('a composites route id names its route key; any other route has none', () => {
    expect(compositesRouteKeyOf('composites-tape_layup')).toBe('tape_layup');
    expect(compositesRouteKeyOf('forging-closed_die_press')).toBeUndefined();
    expect(compositesRouteKeyOf('composites-')).toBeUndefined();
  });
});
