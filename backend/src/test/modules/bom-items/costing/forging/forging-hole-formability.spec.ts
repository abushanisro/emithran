import { forgedHoleFormability } from '../../../../../modules/bom-items/costing/forging/forging-hole-formability';

// Which holes of a forging are pierced in the dies and which are drilled after forging (the machining after forging).
const Z = [0, 0, 1];
const hole = (sizeMm: number | null, axis: number[] | null = Z) => ({ featureType: 'SimpleHole', sizeMm, axis });

describe('a forging hole: pierced or drilled', () => {
  it('a hole along the die direction, at least the least forgeable diameter, is pierced', () => {
    expect(forgedHoleFormability(hole(30), 10, Z)!.formable).toBe(true);
    expect(forgedHoleFormability(hole(30, [0, 0, -1]), 10, Z)!.formable).toBe(true); // either die half
    const tilt = (deg: number) => [Math.sin((deg * Math.PI) / 180), 0, Math.cos((deg * Math.PI) / 180)];
    expect(forgedHoleFormability(hole(30, tilt(4)), 10, Z)!.formable).toBe(true);
    expect(forgedHoleFormability(hole(30, tilt(6)), 10, Z)!.formable).toBe(false);
  });

  it('a hole under the least forgeable diameter, or across the die direction, is drilled after forging', () => {
    expect(forgedHoleFormability(hole(8), 10, Z)).toEqual({ formable: false, detail: expect.stringMatching(/minForgeableHoleDiameter 10 mm/) });
    expect(forgedHoleFormability(hole(30, [1, 0, 0]), 10, Z)).toEqual({ formable: false, detail: expect.stringMatching(/across the die direction/) });
  });

  it('is not decided on a measurement it does not have, and says which', () => {
    expect(forgedHoleFormability(hole(30), null, Z)!.detail).toMatch(/minForgeableHoleDiameter is not staged/);
    expect(forgedHoleFormability(hole(null), 10, Z)!.formable).toBeNull();
    expect(forgedHoleFormability(hole(30), 10, null)!.detail).toMatch(/Refresh analysis/);
  });

  it('a feature that is not a hole is judged by its tolerances alone', () => {
    expect(forgedHoleFormability({ featureType: 'Pocket', sizeMm: 30, axis: Z }, 10, Z)).toBeNull();
  });
});
