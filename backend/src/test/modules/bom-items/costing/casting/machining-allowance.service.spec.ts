import { MachiningAllowanceService } from '../../../../../modules/bom-items/costing/casting/machining-allowance.service';
import type { MachiningNeedView } from '../../../../../modules/bom-items/services/feature-tolerance.service';

// The service reads, as the user, the part's geometry hash, its current decisions, its organization's licensed datasets and approved
// profiles (migration 1002), and hands them to the resolver. Rows come back as Postgres numerics (strings); only the latest approved
// version of a profile counts.
const TABLES: Record<string, any> = {
  bom_items: { organization_id: 'org1', geometry_hash: 'geo-1' },
  bom_item_machining_allowances: [
    { id: 'd1', feature_key: 'PlanarFace:p1', machined: true, allowance_mm: '2.5', sides: 1, basis: 'engineering_estimate', reason: 'sealing face',
      geometry_hash: 'geo-1', set_by_email: 'eng@example.com', set_at: '2026-11-13T10:00:00Z' },
  ],
  machining_allowance_datasets: [],
  machining_allowance_profiles: [
    { id: 'p2', name: 'Foundry A', kind: 'foundry', version: 2, basis: 'rev 4', reviewed_at: 'x',
      machining_allowance_profile_values: [{ material_family: null, moulding_method: null, size_over_mm: '0', size_upto_mm: '250', allowance_mm: '2' }] },
    { id: 'p1', name: 'Foundry A', kind: 'foundry', version: 1, basis: 'rev 3', reviewed_at: 'x',
      machining_allowance_profile_values: [{ material_family: null, moulding_method: null, size_over_mm: '0', size_upto_mm: '250', allowance_mm: '9' }] },
  ],
};

function service(failing?: string) {
  const client = {
    from: (table: string) => {
      const result = table === failing ? { data: null, error: { message: 'relation does not exist' } } : { data: TABLES[table], error: null };
      const q: any = { select: () => q, eq: () => q, is: () => q, order: () => q, single: () => Promise.resolve(result), then: (f: any, r: any) => Promise.resolve(result).then(f, r) };
      return q;
    },
  };
  return new MachiningAllowanceService({ getClient: () => client } as any);
}

const feature = (key: string, type: string, verdict: 'needs_machining' | 'as_primary') => ({
  featureKey: key, label: key, featureType: type, faceIds: [1], featureId: key, occurrenceIndex: 0, verdict,
  reasons: [], requirements: [], forming: null, candidates: [], rejected: [],
});
const need = {
  assessed: true, reason: null, missing: [],
  result: { primaryProcess: 'Sand Casting', machiningRequired: true, features: [feature('SimpleHole:h1', 'SimpleHole', 'needs_machining'), feature('PlanarFace:p1', 'PlanarFace', 'as_primary')] },
  instances: [{ key: 'SimpleHole:h1', sizeMm: 20 }, { key: 'PlanarFace:p1', sizeMm: null }],
} as unknown as MachiningNeedView;
const args = { bomItemId: 'i1', accessToken: 't', need, largestDimensionMm: 150, materialFamily: 'Gray Iron', mouldingMethod: 'machine' as const, rmag: null };

describe('MachiningAllowanceService', () => {
  it('resolves each machined feature from the stored data: the latest approved profile, and the engineer\'s decision', async () => {
    const { result, warnings } = await service().resolve(args);
    expect(warnings).toEqual([]);
    expect(result!.costed).toBe(false);
    const [h, p] = result!.features;
    expect(h).toMatchObject({ featureKey: 'SimpleHole:h1', status: 'foundry_profile_derived', allowanceMm: 2, sides: 2, asCast: { asCastMm: 16 } });
    expect(h!.source.ref).toContain('Foundry A v2');
    expect(p).toMatchObject({ featureKey: 'PlanarFace:p1', status: 'foundry_profile_derived', allowanceMm: 2 });
    expect(p!.notes.join(' ')).toMatch(/estimate of 2.5 mm/);
  });

  it('shows nothing when machining need was not assessed', async () => {
    expect(await service().resolve({ ...args, need: { ...need, assessed: false, result: null } })).toEqual({ result: null, warnings: [] });
  });

  it('says why when the allowance data cannot be read, and shows no value', async () => {
    const r = await service('machining_allowance_profiles').resolve(args);
    expect(r.result).toBeNull();
    expect(r.warnings[0]).toMatch(/relation does not exist/);
  });
});
