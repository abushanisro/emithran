import { describe, expect, it } from 'vitest';

import { additiveSectionTitle, buildDirectionOf, cleaningSizeLabel, directionLabel, BUILD_DIRECTIONS, type AdditiveSummary } from '@/lib/costing/additive-view';
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

  it('titles the section with the process group the part is priced in', () => {
    expect(additiveSectionTitle({ processGroup: 'Rapid Prototyping' } as AdditiveSummary, 'Additive Manufacturing')).toBe('Rapid Prototyping');
    // Before a quote: the part's own Process.
    expect(additiveSectionTitle(undefined, 'Rapid Prototyping')).toBe('Rapid Prototyping');
    expect(additiveSectionTitle(undefined, undefined)).toBe('Additive Manufacturing');
  });

  it('names a cleaned hole by its diameter and a void by its volume', () => {
    expect(cleaningSizeLabel({ measure: 'diameter', size: 5.04 })).toBe('Ø 5 mm');
    expect(cleaningSizeLabel({ measure: 'volume', size: 3000.4 })).toBe('3,000 mm³');
  });
});
