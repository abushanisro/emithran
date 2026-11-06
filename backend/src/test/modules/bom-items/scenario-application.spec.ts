import { ConflictException } from '@nestjs/common';

import { ScenarioApplicationService } from '../../../modules/bom-items/services/scenario-application.service';

const READY = { cad: 'ready', drawing: 'not_required', casting: 'not_required', ready: true, missing: [] };

function build(over: {
  analysis?: object;
  begin?: { data?: unknown; error?: { message: string } };
  routeError?: Error;
  notes?: Array<{ notes: string | null }>;
  machine?: jest.Mock;
} = {}) {
  const calls: string[] = [];
  const patches: Array<Record<string, unknown>> = [];
  const bomItems = {
    update: jest.fn().mockImplementation(() => { calls.push('item.update'); return Promise.resolve({}); }),
    patchScenarioOverrides: jest.fn().mockImplementation((_id: string, patch: Record<string, unknown>) => { calls.push('overrides'); patches.push(patch); return Promise.resolve({}); }),
    findOne: jest.fn().mockResolvedValue({ id: 'i1', volume: 10, weight: 1 }),
    getCostSummary: jest.fn().mockImplementation(() => { calls.push('cost-summary'); return Promise.resolve({ grossWeightKg: 1 }); }),
    setMachineOverride: over.machine ?? jest.fn().mockResolvedValue({}),
  };
  const chain = { select: () => chain, eq: () => chain, then: (r: (v: unknown) => void) => r({ data: over.notes ?? [], error: null }) };
  const database = {
    getUserClient: () => ({
      rpc: jest.fn().mockImplementation(() => { calls.push('begin'); return Promise.resolve(over.begin ?? { data: 3, error: null }); }),
      from: () => chain,
    }),
  };
  const analysisRuns = { ensureCurrent: jest.fn().mockImplementation(() => { calls.push('analysis'); return Promise.resolve({ ran: ['cad_features'], status: over.analysis ?? READY }); }) };
  const materials = { ensure: jest.fn().mockImplementation(() => { calls.push('material'); return Promise.resolve({ action: 'replaced', recordId: 'r1', usage: null }); }) };
  const routes = {
    applyRoute: jest.fn().mockImplementation(() => {
      calls.push('route');
      return over.routeError ? Promise.reject(over.routeError) : Promise.resolve({ created: 5, operations: ['a'], routeLabel: 'Auto', routeId: 'im-standard-200t' });
    }),
    applyCustomRoute: jest.fn().mockImplementation(() => { calls.push('custom-route'); return Promise.resolve({ created: 2, operations: ['x'], routeLabel: 'Custom', needsManualCycleTime: [] }); }),
  };
  const audit = { recordBestEffort: jest.fn().mockResolvedValue(undefined) };
  const svc = new ScenarioApplicationService(bomItems as never, database as never, analysisRuns as never, materials as never, routes as never, audit as never);
  return { svc, calls, patches, bomItems, materials, routes, audit, analysisRuns };
}
const input = (request: object) => ({ bomItemId: 'i1', userId: 'u', organizationId: 'o', token: 't', request: { location: 'USA', route: { mode: 'auto' }, ...request } as never });
const stateWritten = (patches: Array<Record<string, unknown>>) => patches.map((p) => p['appliedScenario']).filter(Boolean) as Array<Record<string, unknown>>;

describe('ScenarioApplicationService.apply', () => {
  it('runs the steps in order: analysis, begin, fields, material, route, then the applied state', async () => {
    const { svc, calls } = build();
    await svc.apply(input({ materialGrade: 'ABS', annualVolume: 5000 }));
    expect(calls).toEqual(['analysis', 'begin', 'item.update', 'overrides', 'cost-summary', 'material', 'route', 'overrides']);
  });

  it('returns the canonical result: revision + 1, what ran, the material and the route', async () => {
    const { svc } = build();
    const r = await svc.apply(input({ materialGrade: 'ABS' }));
    expect(r.scenario).toMatchObject({ revision: 4, status: 'applied' });
    expect(r.analysis.ran).toEqual(['cad_features']);
    expect(r.material).toEqual({ grade: 'ABS', action: 'replaced', recordId: 'r1' });
    expect(r.route).toMatchObject({ mode: 'auto', routeId: 'im-standard-200t', created: 5 });
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

  it('does not touch the part when the analysis cannot be made ready: nothing is written and no state moves', async () => {
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
    expect(keep.routes.applyRoute).toHaveBeenCalledWith('i1', { routeId: 'im-large-500t', location: 'USA' }, expect.anything(), 't');

    const none = build();
    const k = await none.svc.apply(input({ route: { mode: 'keep' } }));
    expect(none.routes.applyRoute).toHaveBeenCalledWith('i1', { routeId: 'auto', location: 'USA' }, expect.anything(), 't');
    expect(k.warnings.join(' ')).toMatch(/No route was applied yet/);
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
