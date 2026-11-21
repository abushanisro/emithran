import { describe, expect, it } from 'vitest';

import { countOf, rotoBlowRouteOf, volumeLabel } from '@/lib/costing/roto-blow-view';
import { rotoBlowRouteKeyOf } from '@/lib/routing/roto-blow-route-id';

describe('the Roto & Blow Molding Cost Guide', () => {
  it('reads the route set in the Cost Guide, and nothing else as one', () => {
    expect(rotoBlowRouteOf({ rotoBlowRoute: 'roto' })).toBe('roto');
    expect(rotoBlowRouteOf({ rotoBlowRoute: 'injection' })).toBeNull();
    expect(rotoBlowRouteOf(undefined)).toBeNull();
  });

  it('reads a count set in the Cost Guide, none when unset or not a count', () => {
    expect(countOf({ rotoBlowLabels: 2 }, 'rotoBlowLabels')).toBe(2);
    expect(countOf({ rotoBlowLabels: '' }, 'rotoBlowLabels')).toBeNull();
    expect(countOf({}, 'rotoBlowLabels')).toBeNull();
    expect(countOf({ rotoBlowLabels: -1 }, 'rotoBlowLabels')).toBeNull();
  });

  it('names a volume in litres or cm³', () => {
    expect(volumeLabel(7960000)).toBe('7.96 L');
    expect(volumeLabel(435000)).toBe('435 cm³');
  });

  it('reads a Roto & Blow Molding route id as its key, any other route as none', () => {
    expect(rotoBlowRouteKeyOf('roto-blow-blow')).toBe('blow');
    expect(rotoBlowRouteKeyOf('bar-tube-saw')).toBeUndefined();
  });
});
