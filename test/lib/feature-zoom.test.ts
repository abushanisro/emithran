import { describe, expect, it } from 'vitest';

import { centreOf, zoomOnto } from '@/lib/viewer/feature-zoom';

// Selecting a feature brought it into view by putting the camera straight above the part (+Z) aimed at height 0: the engineer's rotation was
// lost on every pick, and a feature off the Z=0 plane was missed.
describe('bringing a feature into view', () => {
  it('keeps the direction the engineer is looking: only the aim and the distance change', () => {
    // Looking at the origin from (10, 10, 10); the feature is at (5, 0, 20).
    const { position, target } = zoomOnto([10, 10, 10], [0, 0, 0], [5, 0, 20], Math.sqrt(3) * 2);
    expect(target).toEqual([5, 0, 20]);
    position.forEach((c, i) => expect(c).toBeCloseTo([7, 2, 22][i]!, 6)); // the same (1,1,1) direction, 2√3 away
  });

  it('a camera on its own target looks from +Z', () => {
    expect(zoomOnto([1, 1, 1], [1, 1, 1], [0, 0, 0], 5).position).toEqual([0, 0, 5]);
  });

  it("aims at the occurrences' centre in 3D, not their plan at Z = 0", () => {
    expect(centreOf([{ centroid: [0, 0, 10] }, { centroid: [4, 2, 30] }])).toEqual([2, 1, 20]);
    expect(centreOf([{ centroid: null }])).toBeNull();
  });
});
