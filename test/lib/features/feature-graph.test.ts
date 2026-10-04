import { describe, it, expect } from 'vitest';
import { featureKey, isPlainHole, isExtrudedHole, isBend, isBlankProfile } from '@/lib/features/feature-graph';

describe('featureKey', () => {
  it('joins feature_type and variant, defaulting variant to "default"', () => {
    expect(featureKey({ feature_type: 'SimpleHole', variant: 'through' })).toBe('SimpleHole:through');
    expect(featureKey({ feature_type: 'PlanarFace' })).toBe('PlanarFace:default');
  });
});

describe('sheet metal / machining predicates (unchanged)', () => {
  it('isPlainHole/isExtrudedHole distinguish SimpleHole variants', () => {
    expect(isPlainHole({ feature_type: 'SimpleHole', variant: 'through' })).toBe(true);
    expect(isPlainHole({ feature_type: 'SimpleHole', variant: 'extruded' })).toBe(false);
    expect(isExtrudedHole({ feature_type: 'SimpleHole', variant: 'extruded' })).toBe(true);
  });

  it('isBend/isBlankProfile match their own feature_type only', () => {
    expect(isBend({ feature_type: 'StraightBend' })).toBe(true);
    expect(isBend({ feature_type: 'Blank' })).toBe(false);
    expect(isBlankProfile({ feature_type: 'Blank' })).toBe(true);
  });
});

