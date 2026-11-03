import { join } from 'path';
import {
  holeCastability,
  resolveSandCastabilityReference,
  SAND_CASTABILITY_LOOKUP_KEYS,
} from '../../../../../modules/bom-items/costing/casting/casting-reference';
import { featureInstances, resolveFeatureRequirements } from '../../../../../modules/bom-items/costing/shared/tolerance/feature-tolerances';
import { evaluateMachiningNeed, resolveOperationLinks } from '../../../../../modules/bom-items/costing/shared/tolerance/machining-need';
import { resolveCapabilityTable, resolveIsoTable } from '../../../../../modules/bom-items/costing/shared/tolerance/process-capability';

// Real data only, read from memory/ with the staging CSV reader: the sand-casting limits come from memory/Sand casting, never from
// the die-casting numbers.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { readCsv } = require('../../../../../../migrations/scripts/lib/memory-machine-seed.js');
const MEM = join(__dirname, '../../../../../../../memory');
const csv = (rel: string): Array<Record<string, any>> => readCsv(join(MEM, rel)).rows;

const SAND = 'Sand Casting';
const sandLookups = Object.fromEntries(SAND_CASTABILITY_LOOKUP_KEYS.map((k) => [k, csv(`Sand casting/Lookup/${k}.csv`)]));
const { reference: sand, missing } = resolveSandCastabilityReference(sandLookups);

describe('resolveSandCastabilityReference (memory/Sand casting)', () => {
  it('reads the minimum hole diameters and wall limits, and has no die-casting-only limit tables', () => {
    expect(missing).toEqual([]);
    expect(sand!.minHoleDiameter.length).toBe(csv('Sand casting/Lookup/lookupTables_Component_tblMinHoleDiameter.csv').length);
    expect(sand!.minHoleDiameter.every((r) => r.process === SAND && Number.isFinite(r.diameterMm))).toBe(true);
    expect(sand!.wallLimits.length).toBeGreaterThan(0);
    expect(sand!.maxHoleDepth).toEqual([]);
    expect(sand!.holeProximity).toEqual([]);
  });

  it('names a table that is not staged instead of resolving without it', () => {
    const none = resolveSandCastabilityReference({ [SAND_CASTABILITY_LOOKUP_KEYS[0]]: sandLookups[SAND_CASTABILITY_LOOKUP_KEYS[0]] });
    expect(none.reference).toBeNull();
    expect(none.missing).toEqual([expect.stringContaining('tblWallThickness')]);
  });
});

describe('holeCastability on the sand-casting reference', () => {
  const minAluminum = sand!.minHoleDiameter.find((r) => r.materialType === 'Aluminum')!.diameterMm;

  it('a hole below the sand-casting minimum for its material is not castable', () => {
    const c = holeCastability(sand!, SAND, 'Aluminum', minAluminum - 0.1, 10);
    expect(c.castable).toBe(false);
    expect(c.detail).toMatch(/tblMinHoleDiameter/);
  });

  it('a hole at or above the minimum is castable, and the missing depth table decides nothing', () => {
    const c = holeCastability(sand!, SAND, 'Aluminum', minAluminum, 200);
    expect(c.castable).toBe(true);
    expect(c.detail).toMatch(/no depth limit/);
  });

  it('a material type with no row is undecided, never guessed', () => {
    expect(holeCastability(sand!, SAND, 'Unobtainium', 10, 10).castable).toBeNull();
    expect(holeCastability(sand!, SAND, null, 10, 10).castable).toBeNull();
  });
});

describe('evaluateMachiningNeed for a sand casting', () => {
  const capability = resolveCapabilityTable(csv('machining/lookup/tblGtolProcessCapabilities.csv'));
  const iso = resolveIsoTable(csv('Standards/lookup/iso286_standard_tolerances.csv'));
  const links = resolveOperationLinks(csv('machining/lookup/operation_capability_process.csv'));
  const graph = {
    features: [
      {
        feature_type: 'SimpleHole', variant: 'through', occurrences: [
          { face_ids: [1], source_face_stable_ids: ['a'], diameter_mm: 10, depth_mm: 20 },
          { face_ids: [2], source_face_stable_ids: ['b'], diameter_mm: 2, depth_mm: 4 },
        ],
      },
    ],
  };
  const instances = featureInstances(graph);
  const resolved = resolveFeatureRequirements({ instances, manual: [], policy: { mode: 'assume_achieved' }, callouts: [] });
  const result = evaluateMachiningNeed({
    primaryProcess: SAND, features: resolved.instances, capability, iso, links,
    formability: ({ instance }) => {
      if (instance.featureType !== 'SimpleHole') return null;
      const c = holeCastability(sand!, SAND, 'Aluminum', instance.sizeMm!, instance.depthMm);
      return { formable: c.castable, detail: c.detail } as any;
    },
  });
  const f = (label: string) => result.features.find((x) => x.label === label)!;

  it('a hole the sand process can core needs no machining when nothing requires a tolerance', () => {
    expect(f('SimpleHole:1').verdict).not.toBe('needs_machining');
  });

  it('a hole below the sand-casting minimum is drilled from solid: machining is added', () => {
    expect(f('SimpleHole:2').verdict).toBe('needs_machining');
    expect(f('SimpleHole:2').reasons.join(' ')).toMatch(/minimum/);
    expect(f('SimpleHole:2').forming?.operation).toBe('Drilling');
  });
});
