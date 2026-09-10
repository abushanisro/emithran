import { describe, it, expect } from 'vitest';
import { groupRouteNodes, maxRouteCost, sortRouteNodes } from '@/lib/routing/route-sort';
import type { RouteNode } from '@/lib/routing/route-tree';

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
    expect(sortRouteNodes(nodes, 'recommended', null).map((n) => n.id)).toEqual(['c', 'a', 'b']);
  });

  it('pins the CAD-optimal route first in recommended mode, leaving the rest in backend order', () => {
    const nodes = [node({ id: 'laser' }), node({ id: 'turret' }), node({ id: 'waterjet' })];
    expect(sortRouteNodes(nodes, 'recommended', 'waterjet').map((n) => n.id))
      .toEqual(['waterjet', 'laser', 'turret']);
  });

  it('does not invent a ranking for routes beyond the one recommendation', () => {
    // Three unscored routes must come back in exactly the order the backend
    // returned them — never reshuffled by a synthetic default score.
    const nodes = [node({ id: 'x', cost: 9 }), node({ id: 'y', cost: 1 }), node({ id: 'z', cost: 5 })];
    expect(sortRouteNodes(nodes, 'recommended', null).map((n) => n.id)).toEqual(['x', 'y', 'z']);
  });

  it('sorts by real cost ascending', () => {
    const nodes = [node({ id: 'a', cost: 2.02 }), node({ id: 'b', cost: 0.3 }), node({ id: 'c', cost: 0.95 })];
    expect(sortRouteNodes(nodes, 'cost', null).map((n) => n.id)).toEqual(['b', 'c', 'a']);
  });

  it('sorts by real cycle time ascending', () => {
    const nodes = [node({ id: 'a', cycleTimeMin: 1.9 }), node({ id: 'b', cycleTimeMin: 0.3 }), node({ id: 'c', cycleTimeMin: 0.6 })];
    expect(sortRouteNodes(nodes, 'time', null).map((n) => n.id)).toEqual(['b', 'c', 'a']);
  });

  it('puts routes with no cost last rather than treating a missing cost as free', () => {
    const nodes = [node({ id: 'unpriced', cost: null }), node({ id: 'cheap', cost: 0.3 })];
    expect(sortRouteNodes(nodes, 'cost', null).map((n) => n.id)).toEqual(['cheap', 'unpriced']);
  });

  it('sinks infeasible routes below every feasible one, even when they are cheapest', () => {
    const nodes = [
      node({ id: 'cheap-but-incapable', cost: 0.1, feasible: false }),
      node({ id: 'capable', cost: 5 }),
    ];
    expect(sortRouteNodes(nodes, 'cost', null).map((n) => n.id)).toEqual(['capable', 'cheap-but-incapable']);
  });

  it('sinks infeasible routes even when one is the CAD-optimal pick', () => {
    const nodes = [node({ id: 'ok' }), node({ id: 'best-but-incapable', feasible: false })];
    expect(sortRouteNodes(nodes, 'recommended', 'best-but-incapable').map((n) => n.id))
      .toEqual(['ok', 'best-but-incapable']);
  });

  it('does not mutate the input array', () => {
    const nodes = [node({ id: 'a', cost: 9 }), node({ id: 'b', cost: 1 })];
    sortRouteNodes(nodes, 'cost', null);
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
