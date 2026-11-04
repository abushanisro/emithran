import { describe, expect, it } from 'vitest';
import { gatingSolids, type SandGatingLayout } from '@/lib/casting/gating-layout';

/** Round numbers: runner 12 x 6, ingate 16 x 4 x 10, sprue 20 x 125, well 40 x 12, risers 30 x 45. */
const G: SandGatingLayout = {
  sprueDiameterMm: 20, sprueHeightMm: 125, wellDiameterMm: 40, wellDepthMm: 12, runnerWidthMm: 12, runnerHeightMm: 6, runnerLengthMm: 110,
  ingates: 2, ingateWidthMm: 16, ingateHeightMm: 4, ingateLengthMm: 10, risers: 2, riserDiameterMm: 30, riserHeightMm: 45,
};

describe('gatingSolids', () => {
  it('lays the system out around a 100 x 50 x 20 part drawn along z, parted at z 10 (hand-worked)', () => {
    const s = gatingSolids(G, [0, 0, 0], [100, 50, 20], 'z', 10);
    expect(s.map((x) => x.name)).toEqual(['Runner', 'Ingate 1', 'Ingate 2', 'Sprue', 'Sprue well', 'Riser 1', 'Riser 2']);
    // The runner along x (the longer side), an ingate length (10 mm) beyond the part's side y 50, its top at the parting plane: x -10..100, y 60..72, z 4..10.
    expect(s[0]).toEqual({ name: 'Runner', box: { min: [-10, 60, 4], max: [100, 72, 10] } });
    // Two ingates at a quarter and three quarters of the length (x 25 and 75), 16 wide, bridging y 50..60, 4 deep under the parting plane.
    expect(s[1]).toEqual({ name: 'Ingate 1', box: { min: [17, 50, 6], max: [33, 60, 10] } });
    expect(s[2]).toEqual({ name: 'Ingate 2', box: { min: [67, 50, 6], max: [83, 60, 10] } });
    // The sprue at the runner's far end (x -10 + 20 / 2 = 0, y 66 = the runner's middle), up through the cope from the parting plane; the well below it.
    expect(s[3]).toEqual({ name: 'Sprue', cylinder: { base: [0, 66, 10], axis: 2, radius: 10, length: 125 } });
    expect(s[4]).toEqual({ name: 'Sprue well', cylinder: { base: [0, 66, -2], axis: 2, radius: 20, length: 12 } });
    // Risers on the part's top (z 20), above the ingates, across its middle (y 25).
    expect(s[5]).toEqual({ name: 'Riser 1', cylinder: { base: [25, 25, 20], axis: 2, radius: 15, length: 45 } });
    expect(s[6]).toEqual({ name: 'Riser 2', cylinder: { base: [75, 25, 20], axis: 2, radius: 15, length: 45 } });
  });

  it('follows the draw axis and the longer side; without a parting line, the middle of the draw depth', () => {
    // Drawn along x; across it y is 30 and z 80, so the runner runs along z, beside the side y 30.
    const s = gatingSolids({ ...G, ingates: 1, risers: 1 }, [0, 0, 0], [40, 30, 80], 'x', null);
    expect(s[0]).toEqual({ name: 'Runner', box: { min: [14, 40, -10], max: [20, 52, 80] } });
    expect(s[2]).toMatchObject({ name: 'Sprue', cylinder: { base: [20, 46, 0], axis: 0 } });
    expect(s[4]).toMatchObject({ name: 'Riser 1', cylinder: { base: [40, 15, 40], axis: 0 } });
  });

  it('draws as many ingates and risers as the design has, none when it has none', () => {
    expect(gatingSolids({ ...G, ingates: 4, risers: 3 }, [0, 0, 0], [100, 50, 20], 'z', 10).map((x) => x.name).filter((n) => n.startsWith('Ingate'))).toHaveLength(4);
    const none = gatingSolids({ ...G, ingates: 0, risers: 0 }, [0, 0, 0], [100, 50, 20], 'z', 10);
    expect(none.map((x) => x.name)).toEqual(['Runner', 'Sprue', 'Sprue well']);
  });

  it('every solid has positive extent', () => {
    for (const solid of gatingSolids(G, [0, 0, 0], [100, 50, 20], 'z', 10)) {
      if ('box' in solid) for (let i = 0; i < 3; i++) expect(solid.box.max[i]! - solid.box.min[i]!).toBeGreaterThan(0);
      else expect(solid.cylinder.radius * solid.cylinder.length).toBeGreaterThan(0);
    }
  });
});

import { toGlbShape } from '@/lib/casting/gating-layout';

describe('toGlbShape: the part\'s Z-up millimetres in the GLB\'s Y-up metres', () => {
  it('a box: corners keep x and z (z becomes up) and swap on y (y becomes -z)', () => {
    // part box x 0..100, y 60..72, z 4..10 mm -> glb x 0..0.1, y 0.004..0.010, z -0.072..-0.060 m
    const s = toGlbShape({ name: 'Runner', box: { min: [0, 60, 4], max: [100, 72, 10] } });
    expect(s.kind).toBe('box');
    if (s.kind !== 'box') return;
    expect(s.center[0]).toBeCloseTo(0.05, 12);
    expect(s.center[1]).toBeCloseTo(0.007, 12);
    expect(s.center[2]).toBeCloseTo(-0.066, 12);
    expect(s.size[0]).toBeCloseTo(0.1, 12);
    expect(s.size[1]).toBeCloseTo(0.006, 12);
    expect(s.size[2]).toBeCloseTo(0.012, 12);
  });

  it('a cylinder along each part axis points along that axis in the GLB frame, from its base, its centre half its length on', () => {
    const base = [10, 20, 30] as const;
    const z = toGlbShape({ name: 'z', cylinder: { base, axis: 2, radius: 5, length: 40 } });
    const x = toGlbShape({ name: 'x', cylinder: { base, axis: 0, radius: 5, length: 40 } });
    const y = toGlbShape({ name: 'y', cylinder: { base, axis: 1, radius: 5, length: 40 } });
    if (z.kind !== 'cylinder' || x.kind !== 'cylinder' || y.kind !== 'cylinder') throw new Error('cylinders expected');
    // base (10, 20, 30) mm is glb (0.01, 0.03, -0.02) m
    expect(z.direction).toEqual([0, 1, 0]);
    expect(z.center[0]).toBeCloseTo(0.01, 12);
    expect(z.center[1]).toBeCloseTo(0.03 + 0.02, 12);
    expect(z.center[2]).toBeCloseTo(-0.02, 12);
    expect(x.direction).toEqual([1, 0, 0]);
    expect(x.center[0]).toBeCloseTo(0.01 + 0.02, 12);
    expect(y.direction).toEqual([0, 0, -1]);
    expect(y.center[2]).toBeCloseTo(-0.02 - 0.02, 12);
    expect(z.radius).toBeCloseTo(0.005, 12);
    expect(z.length).toBeCloseTo(0.04, 12);
  });
});
