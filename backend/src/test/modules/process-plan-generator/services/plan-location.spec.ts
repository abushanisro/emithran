import { RetrievalService, densityWithDisclosure } from '../../../../modules/process-plan-generator/services/retrieval.service';
import { appliedPlanLocation } from '../../../../modules/process-plan-generator/services/persistence.service';

function retrieval(): any {
  return new (RetrievalService as any)({}, {}, {}, {}, {}, {}, {}, {}, {});
}

function orgClient(result: { data: unknown; error: { message: string } | null }) {
  const calls: Array<[string, unknown]> = [];
  const q: any = {
    from: () => q,
    select: () => q,
    eq: (col: string, v: unknown) => { calls.push([col, v]); return q; },
    maybeSingle: async () => result,
  };
  return { client: q, calls };
}

describe('RetrievalService.resolveOrgLocation — never a guessed city', () => {
  it("uses the item's own scenario location first", async () => {
    const { client } = orgClient({ data: null, error: null });
    await expect(retrieval().resolveOrgLocation(client, { scenario_overrides: { location: 'USA' }, organization_id: 'o1' }))
      .resolves.toEqual({ location: 'USA', source: 'scenario_override' });
  });

  it("reads the item's organization by id (not by a user_id column it does not have)", async () => {
    const { client, calls } = orgClient({ data: { country: 'Germany' }, error: null });
    await expect(retrieval().resolveOrgLocation(client, { organization_id: 'o1' }))
      .resolves.toEqual({ location: 'Germany', source: 'organization' });
    expect(calls).toEqual([['id', 'o1']]);
  });

  it('returns no location and a warning when nothing is known — not India-Bangalore', async () => {
    const { client } = orgClient({ data: { country: null }, error: null });
    const r = await retrieval().resolveOrgLocation(client, { organization_id: 'o1' });
    expect(r.location).toBeNull();
    expect(r.source).toBe('unknown');
    expect(r.warning).toContain('No factory location');
  });

  it('warns when the organization country is not a Digital Factory location', async () => {
    const { client } = orgClient({ data: { country: 'Atlantis' }, error: null });
    const r = await retrieval().resolveOrgLocation(client, { organization_id: 'o1' });
    expect(r.location).toBeNull();
    expect(r.warning).toContain('"Atlantis" is not a Digital Factory location');
  });

  it('throws when the organization cannot be read', async () => {
    const { client } = orgClient({ data: null, error: { message: 'denied' } });
    await expect(retrieval().resolveOrgLocation(client, { organization_id: 'o1' })).rejects.toThrow('denied');
  });
});

describe('densityWithDisclosure', () => {
  it('returns a matched density with no warning', () => {
    const warnings: string[] = [];
    expect(densityWithDisclosure('AL6061-T6', warnings)).toBe(2700);
    expect(warnings).toEqual([]);
  });

  it('discloses the assumed steel density once', () => {
    const warnings: string[] = [];
    expect(densityWithDisclosure('Unobtainium', warnings)).toBe(7850);
    expect(densityWithDisclosure('Unobtainium', warnings)).toBe(7850);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('ASSUMED');
  });
});

describe('appliedPlanLocation', () => {
  it('uses a brief location that records a real source', () => {
    expect(appliedPlanLocation({ context: { organizationLocation: 'USA', locationSource: 'organization' } })).toBe('USA');
  });

  it('ignores an unknown or legacy (hard-coded) brief location', () => {
    expect(appliedPlanLocation({ context: { organizationLocation: 'India-Bangalore' } })).toBeNull();
    expect(appliedPlanLocation({ context: { organizationLocation: null, locationSource: 'unknown' } })).toBeNull();
    expect(appliedPlanLocation(null)).toBeNull();
  });
});
