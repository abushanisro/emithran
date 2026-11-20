// The holes and threads of a machined part from the CAD engine's machining features (feature-holes.ts), on the hole features the recognizer
// reported for the motor side gear shaft (FusionComponent, 14 x 25.5 x 14 mm): two radial Ø2.53 holes, two Ø4 holes off the axis, a bolt
// circle of two M2 tapped Ø1.6 holes, and the Ø6 through bore. The bolt circle was neither drilled nor tapped: read like a single hole,
// its diameter (hole_diameter_mm) and its thread (tap_spec) were not found.
import { liveToolHoles } from '../../../../../modules/bom-items/costing/machining/capability/live-tooling';
import {
  holeGroupsOfFeatures, normalizeThreadSpecs, tappedHolesOfFeatures, type MachiningFeatureLike,
} from '../../../../../modules/bom-items/costing/machining/feature-holes';
import { timeHoleGroups, timeThreadGroups } from '../../../../../modules/bom-items/costing/multi-spindle/multi-spindle-cost.service';
import { multiSpindleWork } from '../../../../../modules/bom-items/costing/multi-spindle/multi-spindle-work';

const SHAFT: MachiningFeatureLike[] = [
  { type: 'SimpleHole', variant: 'cross', params: { centroid: [0, -7.5, 0], depth_mm: 4.518, ld_ratio: 1.79, angle_deg: 5.2, diameter_mm: 2.529, distance_from_axis_mm: 0.003 } },
  { type: 'SimpleHole', variant: 'cross', params: { centroid: [0, -20.5, 0], depth_mm: 3.516, ld_ratio: 1.39, angle_deg: 5.2, diameter_mm: 2.529, distance_from_axis_mm: 0.003 } },
  { type: 'SimpleHole', variant: 'cross', params: { centroid: [0, -16.5, 6.8], depth_mm: 1.976, ld_ratio: 0.49, angle_deg: 270, diameter_mm: 4, distance_from_axis_mm: 6.8 } },
  { type: 'SimpleHole', variant: 'cross', params: { centroid: [0, -10.5, 6.8], depth_mm: 2.98, ld_ratio: 0.74, angle_deg: 270, diameter_mm: 4, distance_from_axis_mm: 6.8 } },
  { type: 'SimpleHole', variant: 'pcd_pattern', params: { pcd_mm: 8, depth_mm: 5.012, tap_spec: 'M2×0.4', hole_type: 'tapped', hole_count: 2, hole_diameter_mm: 1.6 } },
  { type: 'SimpleHole', variant: 'through', params: { centroid: [0, -5, 0], depth_mm: 25.051, ld_ratio: 4.18, deep_hole: true, diameter_mm: 6, distance_from_axis_mm: 0.003 } },
];
const noOccurrences = () => [];

describe('holeGroupsOfFeatures', () => {
  it('drills a bolt circle as its holes: hole_count holes of hole_diameter_mm at its depth', () => {
    expect(holeGroupsOfFeatures(SHAFT, noOccurrences)).toEqual([
      { diameter_mm: 2.5, count: 2, depth_mm: 4.518 },
      { diameter_mm: 4, count: 2, depth_mm: 2.98 },
      { diameter_mm: 1.6, count: 2, depth_mm: 5.012 },
      { diameter_mm: 6, count: 1, depth_mm: 25.051 },
    ]);
  });

  it('a bolt circle of radial holes the recognizer gives no depth stays without one (drilling names it, nothing is assumed)', () => {
    expect(holeGroupsOfFeatures([{ type: 'SimpleHole', variant: 'pcd_pattern', params: { pcd_mm: 20, hole_count: 4, hole_diameter_mm: 3 } }], noOccurrences))
      .toEqual([{ diameter_mm: 3, count: 4 }]);
  });
});

describe('tappedHolesOfFeatures', () => {
  it('taps a tapped bolt circle: its thread, its holes and their depth, all with a live tool (off the turning centreline)', () => {
    expect(tappedHolesOfFeatures(SHAFT, noOccurrences)).toEqual([
      { size: 'M2×0.4', count: 2, depthMm: 5.012, isThrough: false, occurrences: [], liveCount: 2 },
    ]);
  });

  it('a threaded hole on the centreline is tapped from an end slide, one off it with a live tool', () => {
    const threaded = (distance: number): MachiningFeatureLike => ({ type: 'SimpleHole', variant: 'threaded', params: { spec: 'M5x0.8', depth_mm: 8, distance_from_axis_mm: distance, through: false } });
    expect(tappedHolesOfFeatures([threaded(0.002), threaded(6)], noOccurrences).map((t) => t.liveCount)).toEqual([0, 1]);
  });
});

describe('normalizeThreadSpecs', () => {
  it('groups by size with the pitch from the spec, and adds up the live-tool threads', () => {
    expect(normalizeThreadSpecs([
      { size: 'M2×0.4', count: 2, depthMm: 5.012, isThrough: false, occurrences: [], liveCount: 2 },
      { size: 'm2x0.4 - 6H', count: 1, depthMm: 5, isThrough: false, liveCount: 0 },
    ])).toEqual([{ size: 'M2', count: 3, pitchMm: 0.4, depthMm: 5.01, isThrough: false, liveCount: 2 }]);
  });

  it('drawing threads carry no geometry: no live-tool count; a size given as spec and a count given as text are read', () => {
    expect(normalizeThreadSpecs([{ size: 'M6', count: 4 }])).toEqual([{ size: 'M6', count: 4 }]);
    expect(normalizeThreadSpecs([{ spec: 'M8x1.25', count: '2' }])).toEqual([{ size: 'M8', count: 2, pitchMm: 1.25 }]);
  });
});

describe('the shaft on a multi-spindle', () => {
  it('drills and taps the bolt circle with the live tool, and leaves nothing untimed', () => {
    // Stand-in calculators: 1 s per mm of hole depth, 1.5 s per thread.
    const holes = timeHoleGroups({
      groups: holeGroupsOfFeatures(SHAFT, noOccurrences), liveHoles: liveToolHoles(SHAFT),
      drill: (_d, depth, n) => (depth == null ? { sec: null, missing: ['Drilling: Hole Depth'] } : { sec: depth * n, missing: [] }),
    });
    const threads = timeThreadGroups({ threads: normalizeThreadSpecs(tappedHolesOfFeatures(SHAFT, noOccurrences)), tap: (_t, n) => ({ sec: 1.5 * n, missing: [] }) });
    const w = multiSpindleWork({
      lines: [], holes, threads, partLengthMm: 25.5, partVolumeMm3: 2038.34, turnedDiameterMm: 14, turnedLengthMm: 25.5,
      barSectionAreaMm2: (Math.PI / 4) * 15.875 ** 2, stockLengthMm: 26.29,
    });
    expect(w.gaps).toEqual([]);
    expect(w.ops.map((o) => [o.name, o.slide])).toEqual([
      ['Live-tool drilling Ø2.5 mm x 2', 'live'],
      ['Live-tool drilling Ø4 mm x 2', 'live'],
      ['Live-tool drilling Ø1.6 mm x 2', 'live'],
      ['Drilling Ø6 mm x 1', 'end'],
      ['Live-tool tapping M2 x 2', 'live'],
    ]);
  });
});
