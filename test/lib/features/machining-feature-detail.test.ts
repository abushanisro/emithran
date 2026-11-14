import { describe, it, expect } from 'vitest';

import { featureInstances, machiningCostDrivers, operationCosts } from '@/lib/features/machining-feature-detail';
import type { FeatureNodeV2 } from '@/lib/types/manufacturing';

const feat = (id: string, type: string, variant: string, occurrences: object[], extra: object = {}): FeatureNodeV2 =>
  ({ id, feature_type: type, variant, occurrences: occurrences.map((o) => ({ centroid: [0, 0, 0], face_ids: [], ...o })), ...extra }) as unknown as FeatureNodeV2;

const pocket = feat('p', 'PocketV2', 'default', [
  { extents_mm: [40, 20, 0], material_removed_mm3: 8000 },
  { extents_mm: [30, 2, 0], material_removed_mm3: 600 },
]);
const tapped = feat('t', 'SimpleHole', 'threaded', [{ spec: 'M3×0.5', depth_mm: 5, ld_ratio: 2 }, { spec: 'M3×0.5', depth_mm: 5, ld_ratio: 2 }], { diameter_mm: 2.5 });
const deep = feat('d', 'SimpleHole', 'blind', [{ depth_mm: 30 }], { diameter_mm: 4 });
const face = feat('f', 'PlanarFace', 'default', [{ area_mm2: 120, extents_mm: [20, 6, 0] }]);

describe('featureInstances', () => {
  it('reads each instance: a pocket depth is its removed volume over its floor', () => {
    const [a, b] = featureInstances([pocket]);
    expect(a).toMatchObject({ index: 1, lengthMm: 40, widthMm: 20, depthMm: 10, removedMm3: 8000 });
    expect(b).toMatchObject({ index: 2, widthMm: 2, depthMm: 10 });
  });

  it('a hole carries its diameter, depth, depth to diameter and thread; one with no ratio reported has it worked out', () => {
    expect(featureInstances([tapped])[0]).toMatchObject({ diameterMm: 2.5, depthMm: 5, depthToDiameter: 2, thread: 'M3×0.5' });
    expect(featureInstances([deep])[0]?.depthToDiameter).toBe(7.5);
  });

  it('a measurement the CAD engine did not report is absent, not zero', () => {
    const [row] = featureInstances([face]);
    expect(row).toMatchObject({ areaMm2: 120 });
    expect(Object.keys(row ?? {})).not.toEqual(expect.arrayContaining(['depthMm']));
    expect(Object.keys(row ?? {})).not.toContain('removedMm3');
  });
});

describe('featureInstances: how a feature is reached', () => {
  it('carries the corner radius (0 = sharp), the wall behind it and the tool axis the CAD analysis measured', () => {
    const measured = feat('m', 'PocketV2', 'default', [
      { extents_mm: [40, 20, 0], corner_radius_mm: 0, min_wall_mm: 1.2, tool_axis: [0, 0, 1], tool_axis_bidirectional: false },
      { extents_mm: [40, 20, 0], tool_axis: [0, 0.6428, 0.766], tool_axis_bidirectional: true },
    ]);
    const [a, b] = featureInstances([measured]);
    expect(a).toMatchObject({ cornerRadiusMm: 0, minWallMm: 1.2, toolAxis: '0, 0, 1' });
    expect(b).toMatchObject({ toolAxis: '0, 0.64, 0.77 (either way)' });
    expect(Object.keys(b ?? {})).not.toContain('cornerRadiusMm');
  });
});

describe('operationCosts', () => {
  const lines = [
    { process: '3 Axis Mill', machineName: 'Makino V22', hourlyRate: 72, featureBreakdown: [
      { name: 'Rough Milling', timeSec: 100, count: 2, featureIds: ['p'] },
      { name: 'Fine Finish Milling', timeSec: 50, count: 2, featureIds: ['p'] },
      { name: 'Drilling', timeSec: 30, count: 3, featureIds: ['t', 'd'] },
    ] },
    { process: 'Tapping', machineName: 'Makino V22', hourlyRate: 72, featureBreakdown: [{ name: 'Rigid Tapping', timeSec: 3, count: 2, featureIds: ['t'] }] },
  ];

  it('prices each operation at its line rate, longest first', () => {
    const all = operationCosts(lines);
    expect(all.map((o) => o.operation)).toEqual(['Rough Milling', 'Fine Finish Milling', 'Drilling', 'Rigid Tapping']);
    expect(all[0]?.cost).toBeCloseTo(2, 6);
  });

  it('keeps only the operations that machine the selected feature', () => {
    expect(operationCosts(lines, ['t']).map((o) => o.operation)).toEqual(['Drilling', 'Rigid Tapping']);
    expect(operationCosts(lines, ['f'])).toEqual([]);
  });
});

describe('machiningCostDrivers', () => {
  const drivers = machiningCostDrivers([pocket, tapped, deep, face]);
  const value = (name: string) => drivers.find((d) => d.name === name)?.value;

  it('states the removal, hole, thread and surface drivers of the part', () => {
    expect(value('Volume removed by features')).toBe('8.6 cm³');
    expect(value('Narrowest pocket')).toBe('2 mm');
    expect(value('Highest pocket depth to width')).toBe('5 : 1');
    expect(value('Hole diameters')).toBe('Ø2.5, Ø4');
    expect(value('Deepest hole, depth to diameter')).toBe('7.5 : 1');
    expect(value('Tapped holes')).toBe('2 (M3×0.5)');
    expect(value('Planar faces to finish')).toBe('1 face, 120 mm²');
  });

  it('an open step does not set the narrowest pocket or the reach: its width does not limit the cutter', () => {
    const step = feat('s', 'PocketV2', 'default', [{ extents_mm: [45, 0.8, 0], depth_mm: 20, width_confined: false }]);
    const withStep = machiningCostDrivers([pocket, step]);
    expect(withStep.find((d) => d.name === 'Narrowest pocket')?.value).toBe('2 mm');
    expect(withStep.find((d) => d.name === 'Deepest pocket')?.value).toBe('20 mm');
  });

  it('leaves out a driver the part does not have, and every driver says why it matters', () => {
    expect(value('Free-form surface')).toBeUndefined();
    expect(value('Rounded edges')).toBeUndefined();
    expect(drivers.every((d) => d.why.length > 0)).toBe(true);
  });
});
