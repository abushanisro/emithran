import { fetchMachinePool } from '../../../../../../modules/bom-items/costing/shared/capability/machine-selection/selector';
import { liveToolHoles, liveToolingVerdict } from '../../../../../../modules/bom-items/costing/machining/capability/live-tooling';

// R_M-0230-032 lead nut housing, its machining_features as the CAD engine stored them (local database). The two bores on the turning axis
// need no driven tool; the cross holes do. The off-axis axial bores carry distance_from_axis_mm once the CAD engine exports it for them.
const leadNut = [
  { type: 'SimpleHole', variant: 'through', params: { diameter_mm: 20, centroid: [0, 0, 0] } },
  { type: 'SimpleHole', variant: 'blind', params: { diameter_mm: 16, centroid: [0, 30, 0] } },
  { type: 'SimpleHole', variant: 'cross', params: { diameter_mm: 2, distance_from_axis_mm: 11.385 } },
  { type: 'SimpleHole', variant: 'cross', params: { diameter_mm: 3.2, distance_from_axis_mm: 9.801 } },
  { type: 'SimpleHole', variant: 'cross', params: { diameter_mm: 3.2, distance_from_axis_mm: 9.801 } },
  { type: 'SimpleHole', variant: 'cross', params: { diameter_mm: 6, distance_from_axis_mm: 13.966 } },
  { type: 'SimpleHole', variant: 'cross', params: { diameter_mm: 6, distance_from_axis_mm: 13.966 } },
  { type: 'Edge', variant: 'chamfer', params: { diameter_mm: 1.623 } },
];
const offAxis = [
  { type: 'SimpleHole', variant: 'blind', params: { diameter_mm: 8, distance_from_axis_mm: 6.0 } },
  { type: 'SimpleHole', variant: 'threaded', params: { diameter_mm: 1.623, distance_from_axis_mm: 11.88, spec: 'M2×0.4' } },
  { type: 'SimpleHole', variant: 'blind', params: { diameter_mm: 16, distance_from_axis_mm: 0 } },
];

describe('liveToolHoles: the holes a lathe drills only with a driven tool', () => {
  it('counts the cross holes, by diameter, and not the bores on the turning axis or the chamfers', () => {
    expect(liveToolHoles(leadNut)).toEqual([
      { diameterMm: 2, count: 1, why: 'cross' },
      { diameterMm: 3.2, count: 2, why: 'cross' },
      { diameterMm: 6, count: 2, why: 'cross' },
    ]);
  });

  it('counts an axial bore more than 3 mm off the axis (the CAD engine\'s central-bore limit), not one on it', () => {
    expect(liveToolHoles(offAxis)).toEqual([
      { diameterMm: 1.623, count: 1, why: 'off_axis' },
      { diameterMm: 8, count: 1, why: 'off_axis' },
    ]);
  });

  it('counts a hole pattern on a pitch circle (always off the axis) by its hole count', () => {
    expect(liveToolHoles([{ type: 'SimpleHole', variant: 'pcd_pattern', params: { pcd_mm: 40, hole_count: 6, hole_diameter_mm: 5 } }]))
      .toEqual([{ diameterMm: 5, count: 6, why: 'off_axis' }]);
  });

  it('is empty for no features', () => {
    expect(liveToolHoles(undefined)).toEqual([]);
    expect(liveToolHoles([])).toEqual([]);
  });
});

describe('liveToolingVerdict: can this lathe drill them?', () => {
  const holes = liveToolHoles(leadNut);

  it('a machine with no live-tool spindle (0 kW) cannot, and says which holes', () => {
    const v = liveToolingVerdict(holes, { liveToolingPowerKw: 0 }, 'Haas DS-30 with BAR3010SS Feeder');
    expect(v.capable).toBe(false);
    expect(v.warnings[0]).toContain('Haas DS-30 with BAR3010SS Feeder has no live-tool spindle');
    expect(v.warnings[0]).toContain('5 cross holes');
  });

  it('a machine with one can', () => {
    expect(liveToolingVerdict(holes, { liveToolingPowerKw: 14.9 }, 'Haas DS-30Y with BAR3010SS Feeder')).toEqual({ capable: true, warnings: [] });
  });

  it('a machine whose live tooling is not on file is not ruled out, and says so (unknown is never assumed either way)', () => {
    const v = liveToolingVerdict(holes, { liveToolingPowerKw: null }, 'Lathe X');
    expect(v.capable).toBe(true);
    expect(v.warnings[0]).toContain('not on file');
  });

  it('a part with no such holes needs no live tooling on any machine', () => {
    expect(liveToolingVerdict([], { liveToolingPowerKw: 0 }, 'Haas DS-30')).toEqual({ capable: true, warnings: [] });
  });
});

// The machine pool reads each lathe's own live-tool spindle (mhr_records.live_tooling_power_kw, migration 1043). It is a fact of the machine,
// carried with whichever limits it has: it neither makes a record "staged" nor is replaced by a seed or a class default.
describe('fetchMachinePool carries each machine\'s live-tool spindle', () => {
  const row = (id: string, name: string, cls: string, kw: number | null) => ({
    id, machine_name: name, machine_class: cls, process_group: 'Machining', total_machine_hour_rate: 60, live_tooling_power_kw: kw,
  });
  const rows = [
    row('a', 'Haas DS-30 with BAR3010SS Feeder', '2_axis_bar_feed_lathe_with_sub_spindle', 0),
    row('b', 'Haas DS-30Y with BAR3010SS Feeder', '3_axis_bar_feed_lathe_with_sub_spindle', 14.9),
    row('c', 'Lathe with nothing on file', '2_axis_lathe', null),
  ];
  const client = {
    from: () => ({ select: () => ({ eq: () => ({ order: () => ({ range: async () => ({ data: rows, error: null }) }) }) }) }),
  };

  it('reads 0 and 14.9 kW as they are, and null as not known', async () => {
    const pool = await fetchMachinePool(client as never, `live-tooling-test-${Date.now()}`);
    const kw = (name: string) => pool.find((c) => c.machineName === name)?.capability.liveToolingPowerKw;
    expect(kw('Haas DS-30 with BAR3010SS Feeder')).toBe(0);
    expect(kw('Haas DS-30Y with BAR3010SS Feeder')).toBe(14.9);
    expect(kw('Lathe with nothing on file')).toBeNull();
  });

  it('does not make a lathe\'s limits "staged": its capability source is what it was without the column', async () => {
    const withColumn = await fetchMachinePool(client as never, `live-tooling-src-${Date.now()}`);
    const without = { from: () => ({ select: () => ({ eq: () => ({ order: () => ({ range: async () => ({ data: rows.map(({ live_tooling_power_kw: _, ...r }) => r), error: null }) }) }) }) }) };
    const before = await fetchMachinePool(without as never, `live-tooling-src-before-${Date.now()}`);
    for (const c of withColumn) expect(c.capabilitySource).toBe(before.find((b) => b.machineName === c.machineName)!.capabilitySource);
  });
});
