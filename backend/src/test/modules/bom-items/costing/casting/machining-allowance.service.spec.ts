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

  it("uses the drawing's stored allowance callout before the profile, quoting the drawing", async () => {
    const saved = TABLES.bom_items;
    TABLES.bom_items = { ...saved, drawing_intelligence: { drawing_number: '4471', drawing_revision: 'B',
      machining_allowance: { text: 'MACHINING ALLOWANCE 3 MM', allowance_mm: 3, rmag: null, dctg: null } } };
    try {
      const [h] = (await service().resolve(args)).result!.features;
      expect(h).toMatchObject({ status: 'specified', allowanceMm: 3, sides: 2, asCast: { asCastMm: 14 } });
      expect(h!.source.ref).toBe('drawing 4471 rev B: "MACHINING ALLOWANCE 3 MM"');
    } finally {
      TABLES.bom_items = saved;
    }
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

// An engineer's decision is written by set_machining_allowance() (migration 1002), which checks the role and binds the geometry; the
// service checks the shape first so the caller gets a precise error, and maps the database's refusals.
describe('MachiningAllowanceService.decide', () => {
  const rpcService = (rpcResult: { data?: unknown; error: { message: string; code?: string } | null }) => {
    const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
    const client = { rpc: (fn: string, args: Record<string, unknown>) => { calls.push({ fn, args }); return Promise.resolve(rpcResult); } };
    return { calls, s: new MachiningAllowanceService({ getClient: () => client } as any) };
  };
  const ok = { featureKey: 'SimpleHole:h1', machined: true, allowanceMm: 1.5, sides: 2, basis: 'engineering_drawing', reason: 'drawing note 4' };

  it('writes a machined decision through the database function', async () => {
    const { calls, s } = rpcService({ data: {}, error: null });
    await s.decide('i1', 't', ok);
    expect(calls).toEqual([{ fn: 'set_machining_allowance', args: {
      p_bom_item_id: 'i1', p_feature_key: 'SimpleHole:h1', p_machined: true, p_allowance_mm: 1.5, p_sides: 2, p_basis: 'engineering_drawing', p_reason: 'drawing note 4',
    } }]);
  });

  it('writes "not machined" with no allowance', async () => {
    const { calls, s } = rpcService({ data: {}, error: null });
    await s.decide('i1', 't', { featureKey: 'PlanarFace:p1', machined: false, reason: 'cast to size' });
    expect(calls[0]!.args).toMatchObject({ p_machined: false, p_allowance_mm: null, p_sides: null, p_basis: 'not_machined' });
  });

  it.each([
    [{ ...ok, reason: ' ' }, /reason/],
    [{ ...ok, allowanceMm: 0 }, /allowance/],
    [{ ...ok, sides: 3 }, /sides/],
    [{ ...ok, basis: 'guess' }, /basis/],
    [{ ...ok, featureKey: '' }, /featureKey/],
  ])('refuses a malformed decision before writing (%#)', async (body, message) => {
    const { calls, s } = rpcService({ data: {}, error: null });
    await expect(s.decide('i1', 't', body as any)).rejects.toThrow(message);
    expect(calls).toEqual([]);
  });

  it('maps the database refusals: not a member, no analysed geometry', async () => {
    await expect(rpcService({ error: { message: 'not a member of organization x', code: '42501' } }).s.decide('i1', 't', ok)).rejects.toMatchObject({ status: 403 });
    await expect(rpcService({ error: { message: 'the part has no analysed geometry yet', code: '22023' } }).s.decide('i1', 't', ok)).rejects.toMatchObject({ status: 422 });
    await expect(rpcService({ error: { message: 'item_not_found', code: 'P0002' } }).s.decide('i1', 't', ok)).rejects.toMatchObject({ status: 404 });
  });
});
