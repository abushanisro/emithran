import { join } from 'path';
import { CASTING_LOOKUP_KEYS, holeCastability, holeProximityCastability, resolveCastingReference } from '../../../../../modules/bom-items/costing/casting/casting-reference';
import { featureInstances, resolveFeatureRequirements, type ManualTolerance } from '../../../../../modules/bom-items/costing/shared/tolerance/feature-tolerances';
import { evaluateMachiningNeed, resolveOperationLinks } from '../../../../../modules/bom-items/costing/shared/tolerance/machining-need';
import { resolveCapabilityTable, resolveIsoTable } from '../../../../../modules/bom-items/costing/shared/tolerance/process-capability';

// Real data only, read from memory/ with the staging CSV reader.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { readCsv } = require('../../../../../../migrations/scripts/lib/memory-machine-seed.js');
const MEM = join(__dirname, '../../../../../../../memory');
const csv = (rel: string): Array<Record<string, any>> => readCsv(join(MEM, rel)).rows;

const capability = resolveCapabilityTable(csv('Machining/lookup/tblGtolProcessCapabilities.csv'));
const iso = resolveIsoTable(csv('Standards/lookup/iso286_standard_tolerances.csv'));
const links = resolveOperationLinks(csv('Machining/lookup/operation_capability_process.csv'));
const dc = resolveCastingReference({
  variables: csv('Die Casting/Die casting_variables.csv').map((r) => ({ key: String(r['Variable Name']), value: r['String Value'] })),
  lookups: Object.fromEntries(CASTING_LOOKUP_KEYS.map((k) => [k, csv(`Die Casting/Lookup/${k}.csv`)])),
}).reference!;
const HPDC = 'High Pressure Die Casting';

// Casting-extractor-shaped feature graph: a toleranced hole, a hole below the
// HPDC minimum diameter, a deep hole, a planar face, an untoleranced hole.
const graph = {
  features: [
    {
      feature_type: 'SimpleHole', variant: 'through', occurrences: [
        { face_ids: [1], source_face_stable_ids: ['a'], diameter_mm: 10, depth_mm: 20 },
        { face_ids: [2], source_face_stable_ids: ['b'], diameter_mm: 2, depth_mm: 4 },
        { face_ids: [3], source_face_stable_ids: ['c'], diameter_mm: 5, depth_mm: 40 },
        { face_ids: [4], source_face_stable_ids: ['d'], diameter_mm: 8, depth_mm: 10 },
      ],
    },
    { feature_type: 'PlanarFace', variant: 'default', occurrences: [{ face_ids: [0], source_face_stable_ids: ['p'], extent_mm: 50 }] },
  ],
};
const inst = featureInstances(graph);
const key = (label: string) => inst.find((i) => i.label === label)!.key!;
const manual: ManualTolerance[] = [
  { featureKey: key('SimpleHole:1'), category: 'diamTolerance', value: 0.009 }, // band 18 um @10 mm = IT7
  { featureKey: key('PlanarFace:1'), category: 'flatness', value: 0.03 },        // 30 um @50 mm = IT7
];
const resolved = resolveFeatureRequirements({ instances: inst, manual, policy: { mode: 'assume_achieved' }, callouts: [] });
const result = evaluateMachiningNeed({
  primaryProcess: HPDC, features: resolved.instances, capability, iso, links,
  formability: ({ instance }) => {
    if (instance.featureType !== 'SimpleHole') return null;
    const c = holeCastability(dc, HPDC, 'Aluminum', instance.sizeMm!, instance.depthMm);
    return { formable: c.castable, detail: c.detail } as any;
  },
});
const f = (label: string) => result.features.find((x) => x.label === label)!;
const ops = (label: string) => f(label).candidates.map((c) => c.operation);

describe('evaluateMachiningNeed (HPDC, real capability + castability data)', () => {
  it('an IT7 hole is beyond HPDC: reamed or bored, never just drilled', () => {
    expect(f('SimpleHole:1').verdict).toBe('needs_machining');
    expect(ops('SimpleHole:1')).toEqual(expect.arrayContaining(['Reaming', 'Boring']));
    expect(ops('SimpleHole:1')).not.toContain('Drilling');
    expect(f('SimpleHole:1').rejected.find((r) => r.operation === 'Drilling')!.reason).toMatch(/IT11/);
  });

  it('a hole below the HPDC minimum diameter is machined even with no tolerance', () => {
    expect(f('SimpleHole:2').verdict).toBe('needs_machining');
    expect(f('SimpleHole:2').reasons.join(' ')).toMatch(/minimum/);
    // Made from solid by drilling; no tolerance, so nothing finishes it.
    expect(f('SimpleHole:2').forming?.operation).toBe('Drilling');
    expect(ops('SimpleHole:2')).toEqual([]);
  });

  it('a hole deeper than tblMaxHoleDepth allows is machined', () => {
    expect(f('SimpleHole:3').verdict).toBe('needs_machining');
    expect(f('SimpleHole:3').reasons.join(' ')).toMatch(/max/);
  });

  it('an IT7 flat face is finished by fine milling or grinding, not plain milling', () => {
    expect(f('PlanarFace:1').verdict).toBe('needs_machining');
    const cands = f('PlanarFace:1').candidates.map((c) => c.capabilityProcess);
    expect(cands).toEqual(expect.arrayContaining(['Milling Fine', 'Surface Grinding']));
    expect(cands).not.toContain('Milling');
  });

  it('a castable hole with no requirement stays as cast, and machining is required overall', () => {
    expect(f('SimpleHole:4').verdict).toBe('as_primary');
    expect(f('SimpleHole:4').candidates).toEqual([]);
    expect(result.machiningRequired).toBe(true);
  });
});

describe('other casting features (real memory/Die Casting tables)', () => {
  const prox = csv('Die Casting/Lookup/tblHighPressureDieCastingProximity.csv');
  const min5 = Number([...prox].reverse().find((r) => Number(r['Hole Diameter (mm)']) <= 5)!['Minimum Distance (mm)']);
  const z: [number, number, number] = [0, 0, 1];
  const hole = (x: number) => ({ diameterMm: 5, centroidMm: [x, 0, 0] as [number, number, number], axis: z });

  it('two parallel holes closer than the HPDC minimum wall cannot both be cored', () => {
    // Axes 5.5 mm apart: wall = 5.5 - 2.5 - 2.5 = 0.5 mm.
    const c = holeProximityCastability(dc, HPDC, hole(0), [{ label: 'SimpleHole:9', ...hole(5.5) }]);
    expect(0.5).toBeLessThan(min5);
    expect(c.castable).toBe(false);
    expect(c.detail).toMatch(/SimpleHole:9/);
  });

  it('a wall at or above the minimum is castable; a perpendicular hole is not compared', () => {
    expect(holeProximityCastability(dc, HPDC, hole(0), [{ label: 'a', ...hole(10) }]).castable).toBe(true);
    const across = { label: 'b', diameterMm: 5, centroidMm: [5.5, 0, 0] as [number, number, number], axis: [1, 0, 0] as [number, number, number] };
    expect(holeProximityCastability(dc, HPDC, hole(0), [across]).castable).toBe(true);
  });

  it('no proximity rows for another process: undecided, not assumed', () => {
    expect(holeProximityCastability(dc, 'Sand Casting', hole(0), []).castable).toBeNull();
  });

  it('a stepped hole with a step below the casting minimum is formed by Step Drilling', () => {
    const stepped = featureInstances({ features: [{ id: 'msh', feature_type: 'MultiStepHole', variant: 'stepped', occurrences: [
      { face_ids: [1, 2, 3], source_face_stable_ids: ['s1', 's2', 's3'], max_diameter_mm: 8,
        steps: [{ diameter_mm: 8, depth_mm: 4 }, { diameter_mm: 5, depth_mm: 6 }, { diameter_mm: 2, depth_mm: 3 }] },
    ] }] });
    expect(stepped[0]!.steps!.map((s) => s.diameterMm)).toEqual([8, 5, 2]);
    const need = evaluateMachiningNeed({
      primaryProcess: HPDC,
      features: resolveFeatureRequirements({ instances: stepped, manual: [], policy: { mode: 'assume_achieved' }, callouts: [] }).instances,
      capability, iso, links,
      formability: ({ instance }) => {
        const checks = instance.steps!.map((st) => holeCastability(dc, HPDC, 'Aluminum', st.diameterMm, st.depthMm));
        return { formable: checks.some((c) => c.castable === false) ? false : true, detail: checks.map((c) => c.detail).join('; ') } as const;
      },
    });
    expect(need.features[0]!.verdict).toBe('needs_machining');
    expect(need.features[0]!.forming?.operation).toBe('Step Drilling');
  });
});
