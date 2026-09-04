import { describe, it, expect } from 'vitest';
import { adaptRoutesToTree, RouteTreeValidationError } from '@/lib/routing/route-tree';
import type { RouteResultDto } from '@/lib/api/hooks/useBOMItems';

function route(overrides: Partial<RouteResultDto> = {}): RouteResultDto {
  return {
    routeId: 'sm-laser',
    routeLabel: 'Fiber Laser + Press Brake',
    processFamily: 'cutting',
    toolingVolumeNote: null,
    processLines: [
      { process: 'Laser Cutting', machineClass: 'fiber_laser', machineName: 'Trumpf TruLaser 5030', hourlyRate: 45, totalCost: 120, cycleTimeMin: 8, setupCost: 10, runCost: 110, rateSource: 'mhr_database' },
      { process: 'Press Brake', machineClass: 'press_brake', machineName: 'Amada HG 1003', hourlyRate: 38, totalCost: 60, cycleTimeMin: 4, setupCost: 5, runCost: 55, rateSource: 'mhr_database' },
    ] as any,
    materialCost: 30, abrasiveCost: 0, totalProcessCost: 180, totalCost: 210,
    isFeasible: true,
    cycleTimes: { cuttingMin: 8, pressBrakeMin: 4, tappingMin: 0, deburrMin: 0, totalMin: 12 },
    badges: { lowestCost: true, fastest: false, bestQuality: false },
    capability: { cuttingCapable: true, pressBrakeCapable: true, overallCapable: true, confidence: 'high', estimatedTonnage: null, reasonCodes: [], warnings: [] },
    warnings: [],
    ratesSource: 'mhr_database',
    ...overrides,
  } as RouteResultDto;
}

describe('adaptRoutesToTree', () => {
  it('produces one top-level node per real route, with real cost/time/badges carried through unmodified', () => {
    const routes = [route(), route({ routeId: 'sm-turret', routeLabel: 'Turret Punch + Press Brake', totalCost: 250, badges: { lowestCost: false, fastest: true, bestQuality: false } })];
    const tree = adaptRoutesToTree(routes);
    expect(tree).toHaveLength(2);
    expect(tree[0]!.id).toBe('sm-laser');
    expect(tree[0]!.cost).toBe(210);
    expect(tree[0]!.badges).toEqual({ lowestCost: true, fastest: false, bestQuality: false });
    expect(tree[1]!.id).toBe('sm-turret');
    expect(tree[1]!.badges.fastest).toBe(true);
  });

  it('builds real children from processLines, in order, with stable IDs derived from routeId + index (never array index alone across routes)', () => {
    const tree = adaptRoutesToTree([route()]);
    expect(tree[0]!.children).toHaveLength(2);
    expect(tree[0]!.children[0]).toMatchObject({ id: 'sm-laser:0', label: 'Laser Cutting', cost: 120, cycleTimeMin: 8, machineName: 'Trumpf TruLaser 5030' });
    expect(tree[0]!.children[1]).toMatchObject({ id: 'sm-laser:1', label: 'Press Brake', cost: 60 });
  });

  it('an infeasible route surfaces its real capability warnings as infeasibleReason, never a generic placeholder when real warnings exist', () => {
    const tree = adaptRoutesToTree([route({
      isFeasible: false,
      capability: { cuttingCapable: false, pressBrakeCapable: true, overallCapable: false, confidence: 'high', estimatedTonnage: null, reasonCodes: ['DIMENSIONS_UNAVAILABLE'], warnings: ['Part thickness 12mm exceeds machine limit 8mm'] },
    })]);
    expect(tree[0]!.feasible).toBe(false);
    expect(tree[0]!.infeasibleReason).toBe('Part thickness 12mm exceeds machine limit 8mm');
  });

  it('an infeasible route with no real warnings on file gets an honest fallback reason, not a fabricated specific one', () => {
    const tree = adaptRoutesToTree([route({
      isFeasible: false,
      capability: { cuttingCapable: false, pressBrakeCapable: true, overallCapable: false, confidence: 'low', estimatedTonnage: null, reasonCodes: [], warnings: [] },
    })]);
    expect(tree[0]!.infeasibleReason).toBe('Not capable for this part');
  });

  it('every node defaults to kind "required" — this adapter has no real optional/repeated branch data to represent yet', () => {
    const tree = adaptRoutesToTree([route()]);
    expect(tree[0]!.kind).toBe('required');
    expect(tree[0]!.children[0]!.kind).toBe('required');
  });

  it('an empty route list produces an empty tree, never a crash', () => {
    expect(adaptRoutesToTree([])).toEqual([]);
  });

  it('rejects a malformed route (missing routeLabel) loudly instead of silently producing a broken tree', () => {
    const malformed = [{ ...route(), routeLabel: undefined }] as unknown as RouteResultDto[];
    expect(() => adaptRoutesToTree(malformed)).toThrow(RouteTreeValidationError);
  });

  it('includes real forming-family routes (Standard/Tandem/Progressive-Die Press, Roll Bending) as real, visible, selectable rows — matching route5.png\'s reference structure — now that apply-route.dto.ts accepts applying one', () => {
    const routes = [
      route(),
      route({ routeId: 'sm-standard-press', routeLabel: 'Standard Press', processFamily: 'forming', processLines: [] }),
      route({ routeId: 'sm-roll-bending-2', routeLabel: '2 Roll Bending', processFamily: 'forming', processLines: [] }),
    ];
    const tree = adaptRoutesToTree(routes);
    expect(tree).toHaveLength(3);
    expect(tree[0]).toMatchObject({ id: 'sm-laser', processFamily: 'cutting', selectable: true, selectionNote: null });
    expect(tree[1]).toMatchObject({ id: 'sm-standard-press', processFamily: 'forming', selectable: true, selectionNote: null });
    expect(tree[2]).toMatchObject({ id: 'sm-roll-bending-2', processFamily: 'forming', selectable: true, selectionNote: null });
  });

  it('an all-forming route list still produces real, visible, selectable rows, never an empty tree that looks like "no routes at all"', () => {
    const routes = [route({ routeId: 'sm-tandem-press', routeLabel: 'Tandem Press', processFamily: 'forming', processLines: [] })];
    const tree = adaptRoutesToTree(routes);
    expect(tree).toHaveLength(1);
    expect(tree[0]!.selectable).toBe(true);
  });

  it('carries a real, database-driven tooling-volume-economics note through unmodified for a gated forming class', () => {
    const tree = adaptRoutesToTree([route({
      routeId: 'sm-progressive-die', routeLabel: 'Progressive die', processFamily: 'forming', processLines: [],
      toolingVolumeNote: 'Economical at this volume — 500,000/yr meets the 15,000/yr minimum for progressive die tooling to pay off.',
    })]);
    expect(tree[0]!.toolingVolumeNote).toBe('Economical at this volume — 500,000/yr meets the 15,000/yr minimum for progressive die tooling to pay off.');
  });

  it('a route with no sourced tooling-economics threshold (e.g. a cutting route, or Standard Press) carries a real null, never a fabricated note', () => {
    const tree = adaptRoutesToTree([route()]);
    expect(tree[0]!.toolingVolumeNote).toBeNull();
  });
});
