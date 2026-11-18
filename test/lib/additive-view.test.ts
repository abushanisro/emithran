import { describe, expect, it } from 'vitest';

import { buildDirectionOf, directionLabel, BUILD_DIRECTIONS } from '@/lib/costing/additive-view';
import { additiveRouteKeyOf } from '@/lib/routing/additive-route-id';

describe('the additive Cost Guide', () => {
  it('reads the build direction set in the Cost Guide, and nothing else as one', () => {
    expect(buildDirectionOf({ additiveBuildDirection: '-x' })).toBe('-x');
    expect(buildDirectionOf({ additiveBuildDirection: 'sideways' })).toBeNull();
    expect(buildDirectionOf(undefined)).toBeNull();
    expect(BUILD_DIRECTIONS).toEqual(['+z', '-z', '+x', '-x', '+y', '-y']);
  });

  it('names a direction as the engineer reads it', () => {
    expect(directionLabel('+z')).toBe('+z (Z up)');
    expect(directionLabel('-x')).toBe('-x (X down)');
  });

  it('reads an additive route id as its route key, any other route as none', () => {
    expect(additiveRouteKeyOf('additive-resin_curing')).toBe('resin_curing');
    expect(additiveRouteKeyOf('composites-hand_layup')).toBeUndefined();
    expect(additiveRouteKeyOf('additive-')).toBeUndefined();
  });
});
