import { ConflictException } from '@nestjs/common';

import { RouteApplicationService } from '../../../modules/bom-items/services/route-application.service';

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
      bomItemsService: { findOne: jest.fn().mockResolvedValue({ id: 'i', file3dPath: 'p.step' }), getRouteComparison },
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

/** Automatic routing never falls back: with every route ruled out by an incompatible feature, it says so and chooses nothing. */
describe('applying "auto" when every route is incompatible', () => {
  const ready = { cad: 'ready', drawing: 'not_required', casting: 'not_required', ready: true, missing: [] };
  const incompatible = (label: string) => ({
    routeId: label, routeLabel: label, isFeasible: true,
    compatibility: { status: 'incompatible', notAssessed: [], warnings: [], incompatibilities: [{ featureType: 'SlideBundle', variant: '', count: 2, featureIds: ['s'], kind: 'not_in_process_vocabulary', reason: 'The reference lists no SlideBundle for it.' }] },
  });

  function service(comparison: object) {
    const getRouteComparison = jest.fn().mockResolvedValue(comparison);
    const c = Object.create(RouteApplicationService.prototype) as RouteApplicationService;
    Object.assign(c, {
      bomItemsService: { findOne: jest.fn().mockResolvedValue({ id: 'i', file3dPath: 'p.step' }), getRouteComparison },
      analysisStatusService: { forItem: jest.fn().mockResolvedValue(ready) },
      audit: { auditedRowChange: (_t: string, _id: string, _a: string, fn: () => Promise<unknown>) => fn() },
    });
    return c;
  }
  const dto = { routeId: 'auto', location: 'USA' } as never;
  const user = { id: 'u' } as never;

  it('refuses with the product message and each route\'s exact feature and reason', async () => {
    const c = service({ resolvedInputs: { batchSize: 1 }, recommendedRouteId: null, noCompatibleProcessMessage: 'No compatible manufacturing process found.', routes: [incompatible('Compression Molding'), incompatible('Other')] });
    const error = await c.applyRoute('i', dto, user, 't').catch((e: unknown) => e) as Error;
    expect(error.message).toContain('No compatible manufacturing process found.');
    expect(error.message).toContain('Compression Molding: 2 x SlideBundle (The reference lists no SlideBundle for it.)');
  });

  it('a null recommendation for another reason keeps its own message', async () => {
    const c = service({ resolvedInputs: { batchSize: 1 }, recommendedRouteId: null, noCompatibleProcessMessage: null, routes: [] });
    const error = await c.applyRoute('i', dto, user, 't').catch((e: unknown) => e) as Error;
    expect(error.message).toContain('No route is both feasible and fully costed');
  });
});
