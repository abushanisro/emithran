import { directionalHoleFormability, forgedHoleFormability, PRESSED_HOLES } from '../../../../../modules/bom-items/costing/forging/forging-hole-formability';

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

// A powder metal part: a core rod forms a hole along the press direction, at least minPressableHoleDiameter (1.5 mm, memory/Powder metal) wide.
describe('a powder metal hole: pressed or drilled', () => {
  const pressed = (sizeMm: number, axis: number[]) => directionalHoleFormability(PRESSED_HOLES, { featureType: 'SimpleHole', sizeMm, axis }, 1.5, Z);
  it('a hole along the press direction is pressed by a core rod; a cross hole or a pin hole is drilled after pressing', () => {
    expect(pressed(6, Z)).toEqual({ formable: true, detail: 'pressed by a core rod along the press direction (Ø6 mm, at least 1.5 mm)' });
    expect(pressed(6, [1, 0, 0])).toEqual({ formable: false, detail: 'across the press direction: no core rod can form it, it is drilled after pressing' });
    expect(pressed(1, Z)!.detail).toMatch(/under the least pressable hole \(minPressableHoleDiameter 1.5 mm\): drilled after pressing/);
  });
});
