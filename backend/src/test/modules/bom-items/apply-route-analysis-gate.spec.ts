import { ConflictException } from '@nestjs/common';

import { RouteApplicationService } from '../../../modules/bom-items/services/route-application.service';

/** The part's active process records, by their notes; a delete removes the rows its filters match. */
function recordsDb(notes: Array<string | null>) {
  const rows = notes.map((n) => ({ notes: n }));
  const deleted: string[] = [];
  const query = (del: boolean) => {
    const filters: Record<string, unknown> = {};
    const q = {
      select: () => q,
      delete: () => query(true),
      eq: (col: string, val: unknown) => { filters[col] = val; return q; },
      then: (resolve: (v: unknown) => void) => {
        if (del) { const n = filters['notes'] as string; deleted.push(n); rows.splice(0, rows.length, ...rows.filter((r) => r.notes !== n)); }
        resolve({ data: del ? null : [...rows], error: null });
      },
    };
    return q;
  };
  return { databaseService: { getClient: () => ({ from: () => query(false) }) }, rows, deleted };
}

/**
 * Applying a route writes cost records from the part's analysis. Until the analyses the part needs are finished and current, the
 * apply is refused (409 analysis_not_ready) before anything is computed or written.
 */
describe('applying a route requires the part to be analysed', () => {
  const ready = { cad: 'ready', drawing: 'not_required', casting: 'not_required', ready: true, missing: [] };
  const notReady = { cad: 'none', drawing: 'not_required', casting: 'not_required', ready: false, missing: ['cad_features'] };

  function controller(status: object) {
    const getRouteComparison = jest.fn().mockRejectedValue(new Error('reached the route comparison'));
    const c = Object.create(RouteApplicationService.prototype) as RouteApplicationService;
    Object.assign(c, {
      bomItemsService: { findOne: jest.fn().mockResolvedValue({ id: 'i', file3dPath: 'p.step' }) },
      costing: { getRouteComparison },
      analysisStatusService: { forItem: jest.fn().mockResolvedValue(status) },
      audit: { auditedRowChange: (_t: string, _id: string, _a: string, fn: () => Promise<unknown>) => fn() },
    });
    return { c, getRouteComparison };
  }
  const dto = { routeId: 'auto', location: 'USA' } as never;
  const user = { id: 'u' } as never;

  it.each([
    ['route-applications', (c: RouteApplicationService) => c.applyRoute('i', dto, user, 't')],
    ['custom-route-applications', (c: RouteApplicationService) => c.applyCustomRoute('i', { location: 'USA' } as never, user, 't')],
  ])('%s is refused with analysis_not_ready, before the route is computed', async (_name, apply) => {
    const { c, getRouteComparison } = controller(notReady);
    const error = await apply(c).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictException);
    expect((error as ConflictException).getResponse()).toMatchObject({
      code: 'analysis_not_ready',
      missing: ['cad_features'],
      message: expect.stringContaining('Refresh analysis does this'),
    });
    expect(getRouteComparison).not.toHaveBeenCalled();
  });

  it('goes on to the route comparison once the part is analysed', async () => {
    const { c, getRouteComparison } = controller(ready);
    await expect(c.applyRoute('i', dto, user, 't')).rejects.toThrow('reached the route comparison');
    expect(getRouteComparison).toHaveBeenCalled();
  });
});

/**
 * Apply never fails (the user's decision 2026-11-20, memory failNotSupportedGcds false): with no route both feasible and fully costed, the best route
 * there is is applied (selectAppliableRoute) and what it cannot make or cost is written as a No Cost Feature.
 */
describe('applying "auto" when no route is both feasible and fully costed', () => {
  const ready = { cad: 'ready', drawing: 'not_required', casting: 'not_required', ready: true, missing: [] };
  const base = { capability: { overallCapable: true, warnings: [] as string[] }, cycleTimes: { totalMin: 1 }, dataComplete: true, dataGaps: [] as unknown[] };
  const incompatible = (label: string, totalCost: number) => ({
    ...base, routeId: label, routeLabel: label, isFeasible: true, totalCost,
    compatibility: { status: 'incompatible', notAssessed: [], warnings: [], incompatibilities: [{ featureType: 'SlideBundle', variant: '', count: 2, featureIds: ['s'], kind: 'not_in_process_vocabulary', reason: 'The reference lists no SlideBundle for it.' }] },
  });

  /** The records the apply writes: the lines it hands to the writer (the database write itself is the writer's own spec). */
  function service(comparison: object) {
    const getRouteComparison = jest.fn().mockResolvedValue(comparison);
    const write = jest.fn().mockImplementation((_id: string, lines: Array<{ process: string }>) => Promise.resolve(lines.map((l) => l.process)));
    const c = Object.create(RouteApplicationService.prototype) as RouteApplicationService;
    Object.assign(c, {
      bomItemsService: { findOne: jest.fn().mockResolvedValue({ id: 'i', file3dPath: 'p.step' }) },
      costing: { getRouteComparison },
      analysisStatusService: { forItem: jest.fn().mockResolvedValue(ready) },
      audit: { auditedRowChange: (_t: string, _id: string, _a: string, fn: () => Promise<unknown>) => fn() },
      databaseService: recordsDb([]).databaseService,
      logger: { log: jest.fn() },
      writeProcessLinesAsRecords: write,
    });
    return { c, write };
  }
  const dto = { routeId: 'auto', location: 'USA' } as never;
  const user = { id: 'u' } as never;
  const written = (write: jest.Mock) => (write.mock.calls[0]![1] as Array<{ process: string; operation?: string; totalCost: number }>);

  it('every route incompatible: the cheapest is applied, not refused, and the features its process cannot make are written as No Cost Features', async () => {
    const { c, write } = service({ resolvedInputs: { batchSize: 1 }, recommendedRouteId: null, noCompatibleProcessMessage: 'No compatible manufacturing process found.', routes: [incompatible('Compression Molding', 2), incompatible('Other', 1)] });
    const r = await c.applyRoute('i', dto, user, 't');
    expect(r.routeId).toBe('Other');
    expect(r.noCostFeatures).toEqual(['2 x SlideBundle: The reference lists no SlideBundle for it.']);
    expect(written(write)).toEqual([expect.objectContaining({ process: 'No Cost Feature', operation: '2 x SlideBundle: The reference lists no SlideBundle for it.', totalCost: 0 })]);
  });

  it('no route feasible (Cannula Holder Right: no inserts): the cheapest is applied, the fewest operations not costed first', async () => {
    const noInserts = 'Insert Pick and Place: The part has no inserts.';
    const route = (routeLabel: string, totalCost: number, gaps: number) => ({
      ...base, routeId: routeLabel, routeLabel, isFeasible: false, totalCost, capability: { overallCapable: true, reasonCodes: [], warnings: [noInserts] }, dataComplete: gaps === 0, dataGaps: Array(gaps).fill({}),
    });
    const { c } = service({ resolvedInputs: { batchSize: 1 }, recommendedRouteId: null, noCompatibleProcessMessage: null, routes: [route('Manual', 1, 2), route('3-axis', 3, 1), route('6-axis', 2, 1)] });
    const r = await c.applyRoute('i', dto, user, 't');
    expect(r.routeId).toBe('6-axis');
    expect(r.noCostFeatures).toEqual([`6-axis is not feasible for this part: ${noInserts}`]);
  });

  it('no material grade (Linear Bracket, Roto & Blow Molding): the route is applied as not costed for the missing grade, not as infeasible', async () => {
    const noGrade = 'the part has no material grade (choose one in Material Grade, then Apply)';
    const route = (routeLabel: string) => ({
      ...base, routeId: routeLabel, routeLabel, isFeasible: false, totalCost: null,
      capability: { overallCapable: false, reasonCodes: ['INPUT_MISSING'], warnings: [noGrade] }, dataComplete: true, dataGaps: [], processLines: [],
    });
    const { c, write } = service({ resolvedInputs: { batchSize: 1 }, recommendedRouteId: null, noCompatibleProcessMessage: null, routes: [route('Extrusion blow molding'), route('Rotational molding')] });
    const r = await c.applyRoute('i', dto, user, 't');
    expect(r.noCostFeatures).toEqual([`Extrusion blow molding is not costed: ${noGrade}`]);
    expect(written(write)).toEqual([expect.objectContaining({ process: 'No Cost Feature', operation: `Extrusion blow molding is not costed: ${noGrade}`, totalCost: 0 })]);
  });

  it('a feasible route is applied before an infeasible one, whatever their costs', async () => {
    const route = (routeLabel: string, isFeasible: boolean, totalCost: number) => ({ ...base, routeId: routeLabel, routeLabel, isFeasible, totalCost, dataComplete: false, dataGaps: [{}] });
    const { c } = service({ resolvedInputs: { batchSize: 1 }, recommendedRouteId: null, noCompatibleProcessMessage: null, routes: [route('Cheap', false, 1), route('Feasible', true, 9)] });
    expect((await c.applyRoute('i', dto, user, 't')).routeId).toBe('Feasible');
  });

  it('a route with no operations (a 2-Model part its source supplies whole) is applied as one $0 record that says so', async () => {
    const { c, write } = service({ resolvedInputs: { batchSize: 1 }, recommendedRouteId: 'two-model-machining', noCompatibleProcessMessage: null,
      routes: [{ ...base, routeId: 'two-model-machining', routeLabel: '2-Model Machining', isFeasible: true, totalCost: 1.32, dataComplete: true, processLines: [] }] });
    const r = await c.applyRoute('i', dto, user, 't');
    expect(r.routeId).toBe('two-model-machining');
    expect(written(write)).toEqual([expect.objectContaining({ process: 'No Cost Feature', operation: '2-Model Machining: no operations to cost on this part (its cost is the material)' })]);
  });

  it('display lines with no factory-currency twin are never written in their place', async () => {
    const { c } = service({ resolvedInputs: { batchSize: 1 }, recommendedRouteId: 'x', noCompatibleProcessMessage: null,
      routes: [{ ...base, routeId: 'x', routeLabel: 'X', isFeasible: true, totalCost: 1, processLines: [{ process: 'Saw' }] }] });
    await expect(c.applyRoute('i', dto, user, 't')).rejects.toThrow("Route 'x' produced no pre-conversion process lines");
  });

  it('only a part whose process has no route at all is refused', async () => {
    const { c } = service({ resolvedInputs: { batchSize: 1 }, recommendedRouteId: null, noCompatibleProcessMessage: null, routes: [] });
    await expect(c.applyRoute('i', dto, user, 't')).rejects.toThrow("The part's process has no route to apply.");
  });
});

/**
 * Apply Scenario's "keep" re-applies the route the active records came from. When the part's process changed (sheet metal -> sand casting), that
 * route is no longer one of the part's routes: keep falls back to the engine's recommendation, from the same comparison, and says which route it
 * replaced. A route the caller chose by id is never swapped: it stays an error.
 */
describe('a kept route that is no longer a route for the part', () => {
  const ready = { cad: 'ready', drawing: 'not_required', casting: 'not_required', ready: true, missing: [] };
  const comparison = {
    resolvedInputs: { batchSize: 100 }, recommendedRouteId: 'sand-casting',
    routes: [{ routeId: 'sand-casting', routeLabel: 'Sand casting', isFeasible: true, processLines: [], capability: { overallCapable: true, warnings: [] } }],
  };
  function service() {
    const c = Object.create(RouteApplicationService.prototype) as RouteApplicationService;
    Object.assign(c, {
      bomItemsService: { findOne: jest.fn().mockResolvedValue({ id: 'i', file3dPath: 'p.step' }) },
      costing: { getRouteComparison: jest.fn().mockResolvedValue(comparison) },
      analysisStatusService: { forItem: jest.fn().mockResolvedValue(ready) },
      audit: { auditedRowChange: (_t: string, _id: string, _a: string, fn: () => Promise<unknown>) => fn() },
      logger: { log: jest.fn() },
      writeProcessLinesAsRecords: jest.fn().mockResolvedValue([]),
    });
    return c;
  }
  const user = { id: 'u' } as never;

  it('falls back to the recommended route when asked (keep): it goes on with sand-casting, not the old sheet-metal route', async () => {
    const r = await service().applyRoute('i', { routeId: 'sm-laser', location: 'USA' } as never, user, 't', { fallbackToRecommended: true });
    expect(r).toMatchObject({ routeId: 'sand-casting', replacedRouteId: 'sm-laser' });
  });

  it('refuses a route chosen by id that the part does not have', async () => {
    await expect(service().applyRoute('i', { routeId: 'sm-laser', location: 'USA' } as never, user, 't'))
      .rejects.toThrow("Route 'sm-laser' not available for this part. Available: sand-casting");
  });
});

/**
 * A part whose process has no route at all, after it changed process: the operations of its earlier process's route price a process the part is no
 * longer made by, so they are removed with the refusal, not left in its total. Hand-added rows stay. (A part with any route has it applied, which
 * replaces them.)
 */
describe('a refused apply after the part changed process', () => {
  const ready = { cad: 'ready', drawing: 'not_required', casting: 'not_required', ready: true, missing: [] };
  function service(notes: Array<string | null>) {
    const db = recordsDb(notes);
    const c = Object.create(RouteApplicationService.prototype) as RouteApplicationService;
    Object.assign(c, {
      bomItemsService: { findOne: jest.fn().mockResolvedValue({ id: 'i', file3dPath: 'p.step' }) },
      costing: { getRouteComparison: jest.fn().mockResolvedValue({ resolvedInputs: { batchSize: 250 }, recommendedRouteId: null, noCompatibleProcessMessage: null, routes: [] }) },
      analysisStatusService: { forItem: jest.fn().mockResolvedValue(ready) },
      audit: { auditedRowChange: (_t: string, _id: string, _a: string, fn: () => Promise<unknown>) => fn() },
      logger: { log: jest.fn() },
      databaseService: db.databaseService,
    });
    return { c, db };
  }
  const user = { id: 'u' } as never;

  it('removes the earlier route\'s operations, keeps a hand-added one, and says so after the reason', async () => {
    const { c, db } = service(['auto_fill_from_route:forging-closed_die_hammer', 'auto_fill_from_route:forging-closed_die_hammer', null]);
    const error = await c.applyRoute('i', { routeId: 'auto', location: 'USA' } as never, user, 't').catch((e: unknown) => e) as Error;
    expect(error.message).toBe("The part's process has no route to apply. The operations of the earlier route forging-closed_die_hammer were removed: they priced the part's previous process.");
    expect(db.deleted).toEqual(['auto_fill_from_route:forging-closed_die_hammer']);
    expect(db.rows).toEqual([{ notes: null }]);
  });
});
