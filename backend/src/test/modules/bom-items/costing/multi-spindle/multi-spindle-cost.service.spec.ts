// The pure parts of MultiSpindleCostService: the part size a bar is sized from, and the hole groups timed apart for the end and live-tool slides.
import { BAR_FORM_OF_STOCK, partOutsideMm, timeHoleGroups, timeThreadGroups } from '../../../../../modules/bom-items/costing/multi-spindle/multi-spindle-cost.service';

describe('partOutsideMm', () => {
  // A hex part 21 mm across flats (24.25 mm across corners) and 32 mm long: its box is 32 x 24.25 x 21 in some order.
  const turned = { diameterMm: 24.25, lengthMm: 32 };
  it('round bar: the turned diameter; hex bar: the across flats (the smaller side across the axis); square bar: the larger side', () => {
    expect(partOutsideMm('round', turned, [24.25, 32, 21])).toBe(24.25);
    expect(partOutsideMm('hex', turned, [24.25, 32, 21])).toBe(21);
    expect(partOutsideMm('square', turned, [21, 24.25, 32])).toBe(24.25);
  });

  it('the scenario stock forms a bar feeder takes', () => {
    expect(BAR_FORM_OF_STOCK).toEqual({ round_bar: 'round', hex_bar: 'hex', square_bar: 'square' });
  });
});

describe('timeHoleGroups', () => {
  // A stand-in drilling calculator: 2 s per hole, depth recorded.
  const calls: [number, number | null, number][] = [];
  const drill = (d: number, depth: number | null, n: number) => {
    calls.push([d, depth, n]);
    return { sec: depth == null ? null : 2 * n, missing: depth == null ? [`Hole Depth (Ø${d} mm)`] : [] };
  };

  it('gives a group\'s live-tool holes (cross, off-axis, matched by diameter) to the live tool and the rest to the end slide', () => {
    calls.length = 0;
    const groups = timeHoleGroups({
      groups: [{ diameter_mm: 6, count: 3, depth_mm: 20 }, { diameter_mm: 10, count: 1, depth_mm: 30 }],
      liveHoles: [{ diameterMm: 6.02, count: 1, why: 'cross' }],
      drill,
    });
    expect(groups).toEqual([
      { diameterMm: 6, depthMm: 20, endCount: 2, endSec: 4, liveCount: 1, liveSec: 2, missing: [] },
      { diameterMm: 10, depthMm: 30, endCount: 1, endSec: 2, liveCount: 0, liveSec: 0, missing: [] },
    ]);
    expect(calls).toEqual([[6, 20, 2], [6, 20, 1], [10, 30, 1]]);
  });

  it('drills the hole groups only: a live-tool hole of no group says which slide, it is never drilled again with no depth', () => {
    calls.length = 0;
    expect(timeHoleGroups({ groups: [], liveHoles: [{ diameterMm: 3, count: 2, why: 'off_axis' }], drill })).toEqual([]);
    expect(calls).toEqual([]);
  });
});

describe('timeThreadGroups', () => {
  // A stand-in tapping calculator: 1.6 s per thread.
  const tap = (_t: unknown, count: number) => ({ sec: 1.6 * count, missing: [] as string[] });

  it('taps each size\'s live-tool threads (off the centreline) apart from those tapped from an end slide', () => {
    expect(timeThreadGroups({ threads: [{ size: 'M2', count: 2, liveCount: 2 }, { size: 'M6', count: 3, liveCount: 1 }, { size: 'M8', count: 1 }], tap })).toEqual([
      { size: 'M2', endCount: 0, endSec: 0, liveCount: 2, liveSec: 3.2, missing: [] },
      { size: 'M6', endCount: 2, endSec: 3.2, liveCount: 1, liveSec: 1.6, missing: [] },
      { size: 'M8', endCount: 1, endSec: 1.6, liveCount: 0, liveSec: 0, missing: [] },
    ]);
  });

  it('names what the tapping calculator lacks for a size', () => {
    const groups = timeThreadGroups({ threads: [{ size: 'size not given', count: 2 }], tap: () => ({ sec: null, missing: ['a metric thread size (got "size not given")'] }) });
    expect(groups).toEqual([{ size: 'size not given', endCount: 2, endSec: 0, liveCount: 0, liveSec: 0, missing: ['a metric thread size (got "size not given")'] }]);
  });
});
