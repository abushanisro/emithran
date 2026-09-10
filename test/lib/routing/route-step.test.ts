import { describe, it, expect } from 'vitest';
import { chainCostDelta, computeChainTotals, type WorkflowRouteStep } from '@/lib/routing/route-step';

function step(overrides: Partial<WorkflowRouteStep> & Pick<WorkflowRouteStep, 'key'>): WorkflowRouteStep {
  return {
    process: overrides.key,
    machineClass: 'fiber_laser',
    machineName: 'NTC TLM-404 3300',
    hourlyRate: 19.83,
    cycleTimeMin: 1,
    totalCost: 1,
    isReal: true,
    ...overrides,
  };
}

describe('computeChainTotals', () => {
  it('sums the real per-line costs and cycle times of the steps actually in the chain', () => {
    const totals = computeChainTotals([
      step({ key: 'Laser Cutting', totalCost: 0.02, cycleTimeMin: 0.04 }),
      step({ key: 'Press Brake', totalCost: 0.16, cycleTimeMin: 0.2 }),
      step({ key: 'Deburring', totalCost: 0.25, cycleTimeMin: 0.3 }),
    ], 0.5);
    expect(totals.processCost).toBeCloseTo(0.43, 5);
    expect(totals.cycleTimeMin).toBeCloseTo(0.54, 5);
    expect(totals.total).toBeCloseTo(0.93, 5);
    expect(totals.isPartial).toBe(false);
  });

  it('drops a removed step out of the total — the whole point of recomputing', () => {
    const chain = [
      step({ key: 'Laser Cutting', totalCost: 0.02 }),
      step({ key: 'Press Brake', totalCost: 0.16 }),
      step({ key: 'Deburring', totalCost: 0.25 }),
    ];
    const before = computeChainTotals(chain, 0);
    const after = computeChainTotals(chain.filter((s) => s.key !== 'Deburring'), 0);
    expect(before.processCost).toBeCloseTo(0.43, 5);
    expect(after.processCost).toBeCloseTo(0.18, 5);
  });

  it('counts an unpriced catalog step instead of silently adding nothing', () => {
    const totals = computeChainTotals([
      step({ key: 'Press Brake', totalCost: 0.16 }),
      step({ key: 'PEM Insertion', totalCost: null, cycleTimeMin: 0, isReal: false }),
    ], 0.5);
    expect(totals.processCost).toBeCloseTo(0.16, 5);
    expect(totals.unpricedStepCount).toBe(1);
    expect(totals.isPartial).toBe(true);
  });

  it('reports no total at all when the route has no material cost, rather than pricing material at zero', () => {
    const totals = computeChainTotals([step({ key: 'Press Brake', totalCost: 0.16 })], null);
    expect(totals.materialCost).toBeNull();
    expect(totals.total).toBeNull();
    expect(totals.processCost).toBeCloseTo(0.16, 5);
  });

  it('handles an empty chain', () => {
    const totals = computeChainTotals([], 0.5);
    expect(totals.processCost).toBe(0);
    expect(totals.cycleTimeMin).toBe(0);
    expect(totals.total).toBeCloseTo(0.5, 5);
    expect(totals.isPartial).toBe(false);
  });
});

describe('chainCostDelta', () => {
  it('reports the difference once the chain no longer matches the backend route', () => {
    const totals = computeChainTotals([step({ key: 'Laser Cutting', totalCost: 0.02 })], 0.2);
    expect(chainCostDelta(totals, 0.47)).toBeCloseTo(-0.25, 5);
  });

  it('reports exactly zero for an untouched chain, so no spurious delta is shown', () => {
    const totals = computeChainTotals([
      step({ key: 'Laser Cutting', totalCost: 0.02 }),
      step({ key: 'Press Brake', totalCost: 0.16 }),
      step({ key: 'Deburring', totalCost: 0.25 }),
    ], 0.04);
    // 0.02 + 0.16 + 0.25 + 0.04 accumulates float noise well under a cent.
    expect(chainCostDelta(totals, 0.47)).toBe(0);
  });

  it('withholds a delta while the chain is partial, rather than comparing against an incomplete sum', () => {
    const totals = computeChainTotals([
      step({ key: 'Press Brake', totalCost: 0.16 }),
      step({ key: 'PEM Insertion', totalCost: null, isReal: false }),
    ], 0.04);
    expect(chainCostDelta(totals, 0.47)).toBeNull();
  });

  it('withholds a delta when either side is unknown', () => {
    const knownChain = computeChainTotals([step({ key: 'Press Brake', totalCost: 0.16 })], 0.04);
    expect(chainCostDelta(knownChain, null)).toBeNull();
    const unknownChain = computeChainTotals([step({ key: 'Press Brake', totalCost: 0.16 })], null);
    expect(chainCostDelta(unknownChain, 0.47)).toBeNull();
  });
});
