import { describe, it, expect } from 'vitest';
import { groupRouteNodes, maxRouteCost, selectTopRoutes, sortRouteNodes, type RankableRoute } from '@/lib/routing/route-sort';
import type { RouteNode } from '@/lib/routing/route-tree';

function rankable(overrides: Partial<RankableRoute> & Pick<RankableRoute, 'routeId'>): RankableRoute {
  return {
    totalCost: 1,
    cycleTimes: { totalMin: 1 },
    capability: { overallCapable: true },
    dataComplete: true,
    isFeasible: true,
    ...overrides,
  };
}

function node(overrides: Partial<RouteNode> & Pick<RouteNode, 'id'>): RouteNode {
  return {
    label: overrides.id,
    kind: 'required',
    processFamily: 'cutting',
    selectable: true,
    selectionNote: null,
    toolingVolumeNote: null,
    feasible: true,
    infeasibleReason: null,
    cost: 1,
    cycleTimeMin: 1,
    machineName: null,
    hourlyRate: null,
    machineClass: null,
    badges: { lowestCost: false, fastest: false, bestQuality: false },
    children: [],
    ...overrides,
  };
}

describe('sortRouteNodes', () => {
  it('keeps the backend order when nothing else applies', () => {
    const nodes = [node({ id: 'c' }), node({ id: 'a' }), node({ id: 'b' })];
    expect(sortRouteNodes(nodes, 'recommended', []).map((n) => n.id)).toEqual(['c', 'a', 'b']);
  });

  it('pins the CAD-optimal route first in recommended mode, leaving the rest in backend order', () => {
    const nodes = [node({ id: 'laser' }), node({ id: 'turret' }), node({ id: 'waterjet' })];
    expect(sortRouteNodes(nodes, 'recommended', ['waterjet']).map((n) => n.id))
      .toEqual(['waterjet', 'laser', 'turret']);
  });

  it('pins up to 3 recommended routes in rank order, leaving the rest in backend order', () => {
    const nodes = [node({ id: 'laser' }), node({ id: 'turret' }), node({ id: 'waterjet' }), node({ id: 'plasma' })];
    expect(sortRouteNodes(nodes, 'recommended', ['plasma', 'turret', 'laser']).map((n) => n.id))
      .toEqual(['plasma', 'turret', 'laser', 'waterjet']);
  });

  it('does not invent a ranking for routes beyond the real recommended set', () => {
    // Three unscored routes must come back in exactly the order the backend
    // returned them — never reshuffled by a synthetic default score.
    const nodes = [node({ id: 'x', cost: 9 }), node({ id: 'y', cost: 1 }), node({ id: 'z', cost: 5 })];
    expect(sortRouteNodes(nodes, 'recommended', []).map((n) => n.id)).toEqual(['x', 'y', 'z']);
  });

  it('sorts by real cost ascending', () => {
    const nodes = [node({ id: 'a', cost: 2.02 }), node({ id: 'b', cost: 0.3 }), node({ id: 'c', cost: 0.95 })];
    expect(sortRouteNodes(nodes, 'cost', []).map((n) => n.id)).toEqual(['b', 'c', 'a']);
  });

  it('sorts by real cycle time ascending', () => {
    const nodes = [node({ id: 'a', cycleTimeMin: 1.9 }), node({ id: 'b', cycleTimeMin: 0.3 }), node({ id: 'c', cycleTimeMin: 0.6 })];
    expect(sortRouteNodes(nodes, 'time', []).map((n) => n.id)).toEqual(['b', 'c', 'a']);
  });

  it('puts routes with no cost last rather than treating a missing cost as free', () => {
    const nodes = [node({ id: 'unpriced', cost: null }), node({ id: 'cheap', cost: 0.3 })];
    expect(sortRouteNodes(nodes, 'cost', []).map((n) => n.id)).toEqual(['cheap', 'unpriced']);
  });

  it('sinks infeasible routes below every feasible one, even when they are cheapest', () => {
    const nodes = [
      node({ id: 'cheap-but-incapable', cost: 0.1, feasible: false }),
      node({ id: 'capable', cost: 5 }),
    ];
    expect(sortRouteNodes(nodes, 'cost', []).map((n) => n.id)).toEqual(['capable', 'cheap-but-incapable']);
  });

  it('sinks infeasible routes even when one is the CAD-optimal pick', () => {
    const nodes = [node({ id: 'ok' }), node({ id: 'best-but-incapable', feasible: false })];
    expect(sortRouteNodes(nodes, 'recommended', ['best-but-incapable']).map((n) => n.id))
      .toEqual(['ok', 'best-but-incapable']);
  });

  it('does not mutate the input array', () => {
    const nodes = [node({ id: 'a', cost: 9 }), node({ id: 'b', cost: 1 })];
    sortRouteNodes(nodes, 'cost', []);
    expect(nodes.map((n) => n.id)).toEqual(['a', 'b']);
  });
});

describe('groupRouteNodes', () => {
  it('separates cutting alternatives from single-operation forming routes', () => {
    const groups = groupRouteNodes([
      node({ id: 'laser' }),
      node({ id: 'prog-die', processFamily: 'forming' }),
      node({ id: 'turret' }),
    ]);
    expect(groups.map((g) => g.family)).toEqual(['cutting', 'forming']);
    expect(groups[0]!.nodes.map((n) => n.id)).toEqual(['laser', 'turret']);
    expect(groups[1]!.nodes.map((n) => n.id)).toEqual(['prog-die']);
  });

  it('emits no empty groups when only one family is present', () => {
    const groups = groupRouteNodes([node({ id: 'roll', processFamily: 'forming' })]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.family).toBe('forming');
  });

  it('orders groups by first appearance, not a fixed family list', () => {
    const groups = groupRouteNodes([node({ id: 'press', processFamily: 'forming' }), node({ id: 'laser' })]);
    expect(groups.map((g) => g.family)).toEqual(['forming', 'cutting']);
  });

  it('returns nothing for an empty route list', () => {
    expect(groupRouteNodes([])).toEqual([]);
  });
});

describe('selectTopRoutes', () => {
  it('picks the cheapest eligible route first, not array position', () => {
    // Root-caused regression: a naive `routes[0]` fallback always picked
    // whichever engine is registered first (Fiber Laser), regardless of the
    // part's real cost. This proves selection follows the real numbers.
    const routes = [
      rankable({ routeId: 'sm-laser', totalCost: 1.34 }),
      rankable({ routeId: 'sm-waterjet', totalCost: 2.27 }),
      rankable({ routeId: 'sm-plasma', totalCost: 0.9 }),
    ];
    expect(selectTopRoutes(routes, 1)[0]?.routeId).toBe('sm-plasma');
  });

  it('returns up to n cheapest eligible routes, most-recommended first', () => {
    const routes = [
      rankable({ routeId: 'sm-laser', totalCost: 1.34 }),
      rankable({ routeId: 'sm-standard-press', totalCost: 1.17 }),
      rankable({ routeId: 'sm-shear', totalCost: 1.39 }),
      rankable({ routeId: 'sm-tandem-press', totalCost: 1.63 }),
    ];
    expect(selectTopRoutes(routes, 3).map((r) => r.routeId))
      .toEqual(['sm-standard-press', 'sm-laser', 'sm-shear']);
  });

  it('excludes incapable, infeasible, non-blank-producing, or data-incomplete routes', () => {
    const routes = [
      rankable({ routeId: 'incapable', totalCost: 0.1, capability: { overallCapable: false } }),
      rankable({ routeId: 'infeasible', totalCost: 0.2, isFeasible: false }),
      rankable({ routeId: 'no-blank', totalCost: 0.3, producesBlank: false }),
      rankable({ routeId: 'incomplete', totalCost: 0.4, dataComplete: false }),
      rankable({ routeId: 'unpriced', totalCost: null }),
      rankable({ routeId: 'winner', totalCost: 0.5 }),
    ];
    expect(selectTopRoutes(routes, 3).map((r) => r.routeId)).toEqual(['winner']);
  });

  it('breaks a cost tie on cycle time, then on route id', () => {
    const tiedOnCost = [
      rankable({ routeId: 'slow', totalCost: 1, cycleTimes: { totalMin: 5 } }),
      rankable({ routeId: 'fast', totalCost: 1, cycleTimes: { totalMin: 2 } }),
    ];
    expect(selectTopRoutes(tiedOnCost, 1)[0]?.routeId).toBe('fast');

    const tiedOnBoth = [
      rankable({ routeId: 'z-route', totalCost: 1, cycleTimes: { totalMin: 2 } }),
      rankable({ routeId: 'a-route', totalCost: 1, cycleTimes: { totalMin: 2 } }),
    ];
    expect(selectTopRoutes(tiedOnBoth, 1)[0]?.routeId).toBe('a-route');
  });

  it('returns fewer than n rather than padding with an ineligible route', () => {
    const routes = [rankable({ routeId: 'only-one', totalCost: 1 })];
    expect(selectTopRoutes(routes, 3).map((r) => r.routeId)).toEqual(['only-one']);
  });

  it('returns an empty array when nothing qualifies, so the caller does not fabricate a choice', () => {
    expect(selectTopRoutes([], 3)).toEqual([]);
    expect(selectTopRoutes([rankable({ routeId: 'only', isFeasible: false })], 3)).toEqual([]);
  });
});

describe('maxRouteCost', () => {
  it('returns the largest real cost', () => {
    expect(maxRouteCost([node({ id: 'a', cost: 0.3 }), node({ id: 'b', cost: 2.02 })])).toBe(2.02);
  });

  it('ignores routes with no cost instead of scaling against a fabricated zero', () => {
    expect(maxRouteCost([node({ id: 'a', cost: null }), node({ id: 'b', cost: 1.5 })])).toBe(1.5);
  });

  it('returns null when nothing has a cost, so no bar is drawn', () => {
    expect(maxRouteCost([node({ id: 'a', cost: null })])).toBeNull();
    expect(maxRouteCost([])).toBeNull();
  });
});
