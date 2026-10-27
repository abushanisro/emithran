import { computePanelLayout, type PanelConfig } from './panel';

// Expected values below are worked by hand from the fit rule n*size + (n-1)*spacing <= usable.
const panel: PanelConfig = { lengthMm: 457, widthMm: 610, borderMm: 12.7, spacingMm: 2.54 };

describe('computePanelLayout', () => {
  it('picks the orientation that fits more boards and reports utilization', () => {
    // usable = 431.6 x 584.6
    // as drawn: floor((431.6+2.54)/(100+2.54)) = 4 across, floor((584.6+2.54)/(80+2.54)) = 7 down -> 28
    // rotated:  floor(434.14/82.54) = 5 across,           floor(587.14/102.54) = 5 down          -> 25
    const r = computePanelLayout({ lengthMm: 100, widthMm: 80 }, panel);
    expect(r.status).toBe('fits');
    if (r.status !== 'fits') return;
    expect(r.orientation).toBe('as_drawn');
    expect([r.boardsAcross, r.boardsDown, r.boardsPerPanel]).toEqual([4, 7, 28]);
    expect(r.panelAreaMm2).toBe(278770);
    expect(r.usablePanelAreaMm2).toBeCloseTo(431.6 * 584.6, 6);
    // 28 * 8000 / 278770
    expect(r.utilization).toBeCloseTo(0.80353, 4);
    expect(r.grossPanelAreaPerBoardMm2).toBeCloseTo(278770 / 28, 6);
    expect(r.netAreaBasis).toBe('bounding_box');
  });

  it('chooses the rotated orientation when it fits more', () => {
    // usable 100x100, no spacing: 40x90 board. as drawn 2x1=2, rotated 1x2... equal -> drawn; use 30x90:
    // as drawn: floor(100/30)=3 across, floor(100/90)=1 down -> 3 ; rotated: floor(100/90)=1, floor(100/30)=3 -> 3 (tie -> drawn)
    // 25x60 board on 100x130: as drawn 4 x 2 = 8 ; rotated floor(100/60)=1 x floor(130/25)=5 = 5 -> drawn.
    // 60x25 board on 100x130: as drawn 1 x 5 = 5 ; rotated floor(100/25)=4 x floor(130/60)=2 = 8 -> rotated.
    const r = computePanelLayout({ lengthMm: 60, widthMm: 25 }, { lengthMm: 100, widthMm: 130, borderMm: 0, spacingMm: 0 });
    expect(r.status).toBe('fits');
    if (r.status !== 'fits') return;
    expect(r.orientation).toBe('rotated');
    expect(r.boardsPerPanel).toBe(8);
    expect(r.utilization).toBeCloseTo((8 * 1500) / 13000, 10);
  });

  it('is deterministic on a tie, keeping the drawn orientation', () => {
    const r = computePanelLayout({ lengthMm: 30, widthMm: 90 }, { lengthMm: 100, widthMm: 100, borderMm: 0, spacingMm: 0 });
    expect(r.status === 'fits' && r.orientation).toBe('as_drawn');
  });

  it('uses the supplied outline area for the net area, not the bounding box', () => {
    // L-shaped board: bounding box 100x80 = 8000, real area 6500.
    const r = computePanelLayout({ lengthMm: 100, widthMm: 80, areaMm2: 6500 }, panel);
    expect(r.status === 'fits' && r.netAreaBasis).toBe('outline');
    expect(r.status === 'fits' && r.utilization).toBeCloseTo((28 * 6500) / 278770, 8);
  });

  it('counts spacing only between boards, not after the last one', () => {
    // 3 boards of 10 + 2 gaps of 5 = 40 exactly fits a 40 mm usable length.
    const r = computePanelLayout({ lengthMm: 10, widthMm: 10 }, { lengthMm: 40, widthMm: 10, borderMm: 0, spacingMm: 5 });
    expect(r.status === 'fits' && r.boardsAcross).toBe(3);
  });

  it('reports a board that does not fit instead of returning zero boards', () => {
    const r = computePanelLayout({ lengthMm: 500, widthMm: 500 }, panel);
    expect(r.status).toBe('does_not_fit');
  });

  it('reports borders that consume the whole panel', () => {
    const r = computePanelLayout({ lengthMm: 10, widthMm: 10 }, { lengthMm: 50, widthMm: 50, borderMm: 25, spacingMm: 0 });
    expect(r.status).toBe('does_not_fit');
  });

  it.each([
    [{ lengthMm: 0, widthMm: 10 }, panel],
    [{ lengthMm: 10, widthMm: NaN }, panel],
    [{ lengthMm: 10, widthMm: 10, areaMm2: -1 }, panel],
    [{ lengthMm: 10, widthMm: 10 }, { ...panel, borderMm: -1 }],
    [{ lengthMm: 10, widthMm: 10 }, { ...panel, lengthMm: 0 }],
  ])('rejects invalid input without guessing (%#)', (board, p) => {
    expect(() => computePanelLayout(board, p)).toThrow(RangeError);
  });
});
