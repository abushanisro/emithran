import { ConflictException } from '@nestjs/common';

import { ScenarioApplicationService } from '../../../modules/bom-items/services/scenario-application.service';

const READY = { cad: 'ready', drawing: 'not_required', casting: 'not_required', ready: true, missing: [] };

function build(over: {
  analysis?: object;
  begin?: { data?: unknown; error?: { message: string } };
  routeError?: Error;
  notes?: Array<{ notes: string | null }>;
  /** The active records once the route step has run (the route service can remove a route of the part's previous process). */
  notesAfterRoute?: Array<{ notes: string | null }>;
  machine?: jest.Mock;
  /** The material the cost summary priced ('' = the part's grade, as an unpriced summary says). */
  pricedGrade?: string;
  /** What the route could not cost, as RouteApplicationService reports it. */
  noCostFeatures?: string[];
  /** The part's BOM children, and whether its cost summary says its material is its parts' (an assembly or weldment of them). */
  children?: object[];
  materialOfParts?: boolean;
} = {}) {
  const calls: string[] = [];
  const patches: Array<Record<string, unknown>> = [];
  const bomItems = {
    update: jest.fn().mockImplementation(() => { calls.push('item.update'); return Promise.resolve({}); }),
    patchScenarioOverrides: jest.fn().mockImplementation((_id: string, patch: Record<string, unknown>) => { calls.push('overrides'); patches.push(patch); return Promise.resolve({}); }),
    findOne: jest.fn().mockResolvedValue({ id: 'i1', name: 'Frame', volume: 10, weight: 1 }),
    findChildren: jest.fn().mockResolvedValue(over.children ?? []),
    getCostSummary: jest.fn().mockImplementation(() => { calls.push('cost-summary'); return Promise.resolve({ grossWeightKg: 1, materialGrade: over.pricedGrade ?? '', ...(over.materialOfParts ? { materialOfParts: true } : {}) }); }),
    setMachineOverride: over.machine ?? jest.fn().mockResolvedValue({}),
  };
  let routeRan = false;
  const chain = { select: () => chain, eq: () => chain, then: (r: (v: unknown) => void) => r({ data: (routeRan ? over.notesAfterRoute ?? over.notes : over.notes) ?? [], error: null }) };
  const database = {
    getUserClient: () => ({
      rpc: jest.fn().mockImplementation(() => { calls.push('begin'); return Promise.resolve(over.begin ?? { data: 3, error: null }); }),
      from: () => chain,
    }),
  };
  const materials = {
    ensure: jest.fn().mockImplementation(() => { calls.push('material'); return Promise.resolve({ action: 'replaced', recordId: 'r1', usage: null }); }),
    retireOwnMaterial: jest.fn().mockImplementation(() => { calls.push('material.retire'); return Promise.resolve(1); }),
  };
  const toolingCosts = {
    ensure: jest.fn().mockImplementation(() => { calls.push('tooling'); return Promise.resolve({ action: 'replaced', items: ['Injection mold'] }); }),
    retire: jest.fn().mockImplementation(() => { calls.push('tooling.retire'); return Promise.resolve(['Forging dies (1 set)']); }),
  };
  const status = (over.analysis ?? READY) as { ready: boolean; missing: string[] };
  const routes = {
    // The one rule (RouteApplicationService.requireAnalysis): the status is read, never made current here.
    requireAnalysis: jest.fn().mockImplementation(() => {
      calls.push('analysis');
      return status.ready ? Promise.resolve() : Promise.reject(new ConflictException({ code: 'analysis_not_ready', missing: status.missing }));
    }),
    applyRoute: jest.fn().mockImplementation(() => {
      calls.push('route');
      routeRan = true;
      return over.routeError ? Promise.reject(over.routeError)
        : Promise.resolve({ created: 5, operations: ['a'], routeLabel: 'Auto', routeId: 'im-standard-200t', ...(over.noCostFeatures ? { noCostFeatures: over.noCostFeatures } : {}) });
    }),
    applyCustomRoute: jest.fn().mockImplementation(() => { calls.push('custom-route'); return Promise.resolve({ created: 2, operations: ['x'], routeLabel: 'Custom', needsManualCycleTime: [] }); }),
  };
  const audit = { recordBestEffort: jest.fn().mockResolvedValue(undefined) };
  const svc = new ScenarioApplicationService(bomItems as never, bomItems as never, bomItems as never, database as never, materials as never, toolingCosts as never, routes as never, audit as never);
  return { svc, calls, patches, bomItems, materials, toolingCosts, routes, audit };
}
const input = (request: object) => ({ bomItemId: 'i1', userId: 'u', organizationId: 'o', token: 't', request: { location: 'USA', route: { mode: 'auto' }, ...request } as never });
const stateWritten = (patches: Array<Record<string, unknown>>) => patches.map((p) => p['appliedScenario']).filter(Boolean) as Array<Record<string, unknown>>;

describe('ScenarioApplicationService.apply', () => {
  it('runs the steps in order: the analysis check, begin, fields, material, route, tooling, then the applied state', async () => {
    const { svc, calls } = build();
    await svc.apply(input({ materialGrade: 'ABS', annualVolume: 5000 }));
    expect(calls).toEqual(['analysis', 'begin', 'item.update', 'overrides', 'cost-summary', 'material', 'route', 'cost-summary', 'tooling', 'overrides']);
  });

  it('returns the canonical result: revision + 1, the material and the route', async () => {
    const { svc } = build();
    const r = await svc.apply(input({ materialGrade: 'ABS' }));
    expect(r.scenario).toMatchObject({ revision: 4, status: 'applied' });
    expect(r.material).toEqual({ grade: 'ABS', action: 'replaced', recordId: 'r1' });
    expect(r.route).toMatchObject({ mode: 'auto', routeId: 'im-standard-200t', created: 5 });
    expect(r.tooling).toEqual({ action: 'replaced', items: ['Injection mold'] });
  });

  it('a grade that is not a material of the part\'s process: the record holds the material the summary priced, and the result says so', async () => {
    const { svc, materials } = build({ pricedGrade: 'Aluminum, ANSI 6061' });
    const r = await svc.apply(input({ materialGrade: 'Generic PETG Copol' }));
    expect(materials.ensure).toHaveBeenCalledWith(expect.objectContaining({ grade: 'Aluminum, ANSI 6061' }));
    expect(r.material).toEqual({ grade: 'Aluminum, ANSI 6061', action: 'replaced', recordId: 'r1' });
    expect(r.warnings).toContain('"Generic PETG Copol" is priced as "Aluminum, ANSI 6061", a material of the part\'s process (the cost summary says why).');
  });

  it('an assembly or a weldment with parts under it keeps no material record of its own: an earlier one is retired, with or without a grade', async () => {
    {
      const withGrade = build({ children: [{ id: 'a' }, { id: 'b' }], materialOfParts: true });
      const r = await withGrade.svc.apply(input({ materialGrade: 'Steel, Cold Worked, AISI 1020' }));
      expect(withGrade.materials.ensure).not.toHaveBeenCalled();
      expect(withGrade.materials.retireOwnMaterial).toHaveBeenCalledWith('i1', 'u', 't');
      expect(r.material).toBeNull();
      expect(r.warnings).toContain("Frame's material is its parts' (each part's is in the BOM roll-up): its own material record was retired.");
      // No grade sent: a record from an older Apply, or from the part's previous process, is retired all the same.
      const noGrade = build({ children: [{ id: 'a' }], materialOfParts: true });
      await noGrade.svc.apply(input({}));
      expect(noGrade.materials.retireOwnMaterial).toHaveBeenCalled();
    }
  });

  it('one with no parts under it is its own one component and keeps its own; a part of another process with parts under it is priced as before', async () => {
    const alone = build();
    expect((await alone.svc.apply(input({ materialGrade: 'ABS' }))).material).toMatchObject({ grade: 'ABS', action: 'replaced' });
    expect(alone.materials.retireOwnMaterial).not.toHaveBeenCalled();
    const machined = build({ children: [{ id: 'a' }] });
    expect((await machined.svc.apply(input({ materialGrade: 'ABS' }))).material).toMatchObject({ grade: 'ABS', action: 'replaced' });
    // Nothing to price and nothing it could have: no grade and no parts leaves the material step out.
    const bare = build();
    await bare.svc.apply(input({}));
    expect(bare.bomItems.getCostSummary).toHaveBeenCalledTimes(1);
  });

  it('what the route could not cost is applied as No Cost Features, each said in the warnings (Apply never fails)', async () => {
    const { svc } = build({ noCostFeatures: ['Insert Pick and Place: the part has no inserts'] });
    const r = await svc.apply(input({ materialGrade: 'ABS' }));
    expect(r.scenario).toMatchObject({ status: 'applied' });
    expect(r.warnings).toContain('No Cost Feature (not costed, $0): Insert Pick and Place: the part has no inserts');
  });

  it('writes every scenario key in one merge, and the grade as a manual pick', async () => {
    const { svc, patches, bomItems } = build();
    await svc.apply(input({ materialGrade: ' ABS ', batchSize: 500, productionLifeYears: 4, scenarioPatch: { processRouting: 'auto' } }));
    expect(patches[0]).toEqual({ location: 'USA', batchSize: 500, productionLifeYears: 4, processRouting: 'auto' });
    expect(bomItems.update).toHaveBeenCalledWith('i1', { materialGrade: 'ABS', materialSource: 'manual' }, 'u', 't');
  });

  it('the grade the part is already costed as keeps its source: Apply does not turn a drawing-read grade into a manual pick', async () => {
    const { svc, bomItems } = build();
    bomItems.findOne.mockResolvedValue({ id: 'i1', volume: 10, weight: 1, materialGrade: 'ABS', materialSource: 'drawing' });
    await svc.apply({ bomItemId: 'i1', userId: 'u', organizationId: 'o', token: 't', request: { location: 'USA', materialGrade: 'ABS', route: { mode: 'auto' } } as never });
    expect(bomItems.update).not.toHaveBeenCalled();
  });

  it('batchSize null clears the override; omitted leaves it', async () => {
    const a = build(); await a.svc.apply(input({ batchSize: null }));
    expect(a.patches[0]).toMatchObject({ batchSize: null });
    const b = build(); await b.svc.apply(input({}));
    expect(b.patches[0]).not.toHaveProperty('batchSize');
  });

  it('refuses a part that is not analysed, without running the analysis: nothing is written and no state moves (Refresh analysis runs it)', async () => {
    const { svc, calls, patches } = build({ analysis: { ...READY, cad: 'none', ready: false, missing: ['cad_features'] } });
    await expect(svc.apply(input({}))).rejects.toMatchObject({ response: { code: 'analysis_not_ready' } });
    expect(calls).toEqual(['analysis']);
    expect(patches).toEqual([]);
  });

  it('turns the database refusals into 409s the caller can act on', async () => {
    const stale = build({ begin: { error: { message: 'scenario_revision_conflict: the scenario is at revision 5, not 3' } } });
    await expect(stale.svc.apply(input({ expectedRevision: 3 }))).rejects.toMatchObject({ response: { code: 'scenario_revision_conflict', message: 'the scenario is at revision 5, not 3' } });
    const busy = build({ begin: { error: { message: 'scenario_apply_in_progress: another apply of this scenario started at 12:00' } } });
    await expect(busy.svc.apply(input({}))).rejects.toBeInstanceOf(ConflictException);
    expect(stale.calls).toEqual(['analysis', 'begin']); // nothing was written
  });

  it('records a failed route on the item, keeps the revision, and rethrows: the page can no longer show "applied" over a refused route', async () => {
    const { svc, patches } = build({ routeError: new Error('No route is both feasible and fully costed for this part') });
    await expect(svc.apply(input({}))).rejects.toThrow('No route is both feasible');
    const states = stateWritten(patches);
    expect(states[states.length - 1]).toMatchObject({ status: 'failed', revision: 3, error: 'No route is both feasible and fully costed for this part' });
    expect(states.some((s) => s['status'] === 'applied')).toBe(false);
  });

  it('a refused route that took the earlier route of another process with it takes that route\'s tooling too (Carriage Mount: forging dies)', async () => {
    const { svc, calls, toolingCosts } = build({
      routeError: new Error("The part's process has no route to apply."),
      notes: [{ notes: 'auto_fill_from_route:forging-closed_die_hammer' }],
      notesAfterRoute: [],
    });
    await expect(svc.apply(input({}))).rejects.toThrow("The part's process has no route to apply.");
    expect(toolingCosts.retire).toHaveBeenCalledWith({ bomItemId: 'i1', userId: 'u', token: 't' });
    expect(calls).toContain('tooling.retire');
  });

  it('a refused route that leaves the applied route in place leaves its tooling', async () => {
    const kept = build({ routeError: new Error('refused'), notes: [{ notes: 'auto_fill_from_route:im-standard-200t' }] });
    await expect(kept.svc.apply(input({}))).rejects.toThrow();
    const never = build({ routeError: new Error('refused') });
    await expect(never.svc.apply(input({}))).rejects.toThrow();
    expect(kept.toolingCosts.retire).not.toHaveBeenCalled();
    expect(never.toolingCosts.retire).not.toHaveBeenCalled();
  });

  it('applying again after a failure converges: the second apply succeeds from the same revision', async () => {
    const first = build({ routeError: new Error('refused') });
    await expect(first.svc.apply(input({}))).rejects.toThrow();
    const second = build(); // the revision is still 3: the failure did not move it
    expect((await second.svc.apply(input({}))).scenario.revision).toBe(4);
  });

  it('applies a chosen route, a Workflow Builder route, and keeps the one already applied (the recommendation when there is none)', async () => {
    const chosen = build(); await chosen.svc.apply(input({ route: { mode: 'route', routeId: 'im-small-50t' } }));
    expect(chosen.routes.applyRoute).toHaveBeenCalledWith('i1', { routeId: 'im-small-50t', location: 'USA' }, expect.anything(), 't');

    const custom = build();
    const r = await custom.svc.apply(input({ route: { mode: 'custom', baseCuttingRouteId: 'fiber-laser', steps: [{ process: 'Deburring' }] } }));
    expect(custom.calls).toContain('custom-route');
    expect(r.route).toMatchObject({ mode: 'custom', routeLabel: 'Custom', created: 2 });

    const keep = build({ notes: [{ notes: 'x' }, { notes: 'auto_fill_from_route:im-large-500t' }] });
    await keep.svc.apply(input({ route: { mode: 'keep' } }));
    // Kept, unless it is no longer a route for the part (its process changed): then the recommendation, said in a warning.
    expect(keep.routes.applyRoute).toHaveBeenCalledWith('i1', { routeId: 'im-large-500t', location: 'USA' }, expect.anything(), 't', { fallbackToRecommended: true });

    const none = build();
    const k = await none.svc.apply(input({ route: { mode: 'keep' } }));
    expect(none.routes.applyRoute).toHaveBeenCalledWith('i1', { routeId: 'auto', location: 'USA' }, expect.anything(), 't');
    expect(k.warnings.join(' ')).toMatch(/No route was applied yet/);
  });

  it('says so when the kept route was replaced because the part has changed process', async () => {
    const moved = build({ notes: [{ notes: 'auto_fill_from_route:sm-laser' }] });
    moved.routes.applyRoute.mockResolvedValueOnce({ created: 14, operations: ['Melting'], routeLabel: 'Sand casting', routeId: 'sand-casting', replacedRouteId: 'sm-laser' });
    const r = await moved.svc.apply(input({ route: { mode: 'keep' } }));
    expect(r.route).toMatchObject({ routeId: 'sand-casting', created: 14 });
    expect(r.warnings.join(' ')).toMatch(/sm-laser is not a route for this part any more.*Sand casting/);
  });

  it('a machine that cannot be saved is reported and does not undo the route', async () => {
    const machine = jest.fn().mockRejectedValueOnce(new Error('no such machine')).mockResolvedValueOnce({});
    const { svc } = build({ machine });
    const r = await svc.apply(input({ machineOverrides: [{ processKey: 'laser', mhrRecordId: 'm1' }, { processKey: 'bend', mhrRecordId: null }] }));
    expect(r.machineOverrides).toEqual({ saved: 1, failed: [{ processKey: 'laser', message: 'no such machine' }] });
    expect(r.scenario.status).toBe('applied');
  });

  it('refuses a patch that tries to set the state it owns', async () => {
    const { svc, calls } = build();
    await expect(svc.apply(input({ scenarioPatch: { appliedScenario: { revision: 99 } } }))).rejects.toThrow(/owns it/);
    expect(calls).toEqual([]);
  });

  it('refuses to run without an organization context: a record written without one is invisible to its own organization', async () => {
    const { svc, calls } = build();
    await expect(svc.apply({ ...input({}), organizationId: '' })).rejects.toThrow(/No organization context/);
    expect(calls).toEqual([]);
  });

  it('audits an applied scenario', async () => {
    const { svc, audit } = build();
    await svc.apply(input({ materialGrade: 'ABS' }));
    expect(audit.recordBestEffort).toHaveBeenCalledWith(expect.objectContaining({ action: 'scenario_application.applied', meta: { revision: 4, route: 'im-standard-200t', material: 'ABS' } }));
  });
});
