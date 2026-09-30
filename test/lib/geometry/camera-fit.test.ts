import { describe, it, expect } from 'vitest';

import { fitCameraToBox, DEFAULT_FIT_DIRECTION, type FitCameraResult } from '@/lib/geometry/camera-fit';

/** Asserts `fit` resolved (every test box here is non-empty) and narrows the
 *  type via plain control flow, so the tests below never need a type
 *  assertion (`!` or `as`) to read its fields. */
function expectFit(fit: FitCameraResult | null): FitCameraResult {
  if (fit === null) throw new Error('expected fitCameraToBox to resolve to a fit, got null');
  return fit;
}

describe('fitCameraToBox', () => {
  it('returns null for an empty box — nothing loaded yet, not an error', () => {
    expect(fitCameraToBox({ min: [1, 1, 1], max: [-1, -1, -1] }, 50)).toBeNull();
  });

  it('centers on the box midpoint', () => {
    const fit = expectFit(fitCameraToBox({ min: [0, 0, 0], max: [10, 20, 30] }, 50));
    expect(fit.center).toEqual([5, 10, 15]);
  });

  // ROOT CAUSE regression: the old CameraFitter skipped any box with bounding
  // radius < 5 units, guessing it must be a helper/gizmo rather than the real
  // model — which just as easily stalled on a genuinely small-but-valid part
  // forever (see edrawings-viewer.tsx's CameraFitter doc comment). This
  // function must fit a tiny box exactly like a large one; "is this object
  // worth fitting to" is an identity question for the caller (userData tag),
  // never a size threshold in the math itself.
  it('fits a box far smaller than the old 5-unit skip threshold', () => {
    const fit = expectFit(fitCameraToBox({ min: [-0.05, -0.05, -0.05], max: [0.05, 0.05, 0.05] }, 50));
    expect(fit.radius).toBeGreaterThan(0);
    expect(fit.distance).toBeGreaterThan(0);
    expect(Number.isFinite(fit.distance)).toBe(true);
  });

  it('fits a large box the same way, only scaled', () => {
    const small = expectFit(fitCameraToBox({ min: [-1, -1, -1], max: [1, 1, 1] }, 50));
    const large = expectFit(fitCameraToBox({ min: [-100, -100, -100], max: [100, 100, 100] }, 50));
    expect(large.radius / small.radius).toBeCloseTo(100, 5);
    expect(large.distance / small.distance).toBeCloseTo(100, 5);
  });

  it('never divides by zero on a single-point (fully degenerate) box', () => {
    const fit = expectFit(fitCameraToBox({ min: [3, 3, 3], max: [3, 3, 3] }, 50));
    expect(Number.isFinite(fit.distance)).toBe(true);
    expect(fit.distance).toBeGreaterThan(0);
  });

  it('widens near/far clipping planes proportionally to distance, so a huge or tiny model never clips', () => {
    const fit = expectFit(fitCameraToBox({ min: [0, 0, 0], max: [1000, 1000, 1000] }, 50));
    expect(fit.near).toBeLessThan(fit.distance);
    expect(fit.far).toBeGreaterThan(fit.distance);
  });

  it('positions the camera along the given direction, at the computed distance from center', () => {
    const fit = expectFit(fitCameraToBox({ min: [-1, -1, -1], max: [1, 1, 1] }, 50, [1, 0, 0]));
    expect(fit.position).toEqual([fit.center[0] + fit.distance, fit.center[1], fit.center[2]]);
  });

  it('defaults to the isometric-ish (1, 0.7, 1) direction, normalised', () => {
    const [x, y, z] = DEFAULT_FIT_DIRECTION;
    const len = Math.sqrt(x * x + y * y + z * z);
    expect(len).toBeCloseTo(1, 10);
  });

  it('a narrower field of view needs more distance to frame the same box', () => {
    const wide = expectFit(fitCameraToBox({ min: [-5, -5, -5], max: [5, 5, 5] }, 90));
    const narrow = expectFit(fitCameraToBox({ min: [-5, -5, -5], max: [5, 5, 5] }, 20));
    expect(narrow.distance).toBeGreaterThan(wide.distance);
  });
});
