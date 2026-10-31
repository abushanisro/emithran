import { describe, expect, it } from 'vitest';

import { aggregateBomCosts, costResultFromAnalysis } from '@/lib/services/cost-engine';

const analysis = {
  rawMaterialCost: 40,
  processCost: 30,
  toolingCost: 5,
  packagingCost: 0,
  procuredPartCost: 10,
  manufacturingCost: 85,
  sgaCost: 0,
  profitCost: 8.5,
  sellingPrice: 93.5,
};

describe('costResultFromAnalysis', () => {
  it('takes every value from the backend, including real zeros', () => {
    const { breakdown } = costResultFromAnalysis('item-1', analysis);
    expect(breakdown).toEqual({
      rawMaterialCost: 40,
      processCost: 30,
      toolingCost: 5,
      packagingLogisticsCost: 0,
      procuredPartsCost: 10,
      sgaCost: 0, // a real 0 stays 0, not total * 12.5%
      profitAmount: 8.5,
      totalCost: 85,
      sellingPrice: 93.5,
    });
  });

  it('leaves a value the backend did not return as null instead of estimating it', () => {
    const { breakdown } = costResultFromAnalysis('item-1', { manufacturingCost: 85 });
    expect(breakdown.totalCost).toBe(85);
    expect(breakdown.sgaCost).toBeNull();
    expect(breakdown.profitAmount).toBeNull();
    expect(breakdown.sellingPrice).toBeNull();
    expect(breakdown.rawMaterialCost).toBeNull();
  });

  it('treats non-numeric values as unknown', () => {
    const { breakdown } = costResultFromAnalysis('item-1', { processCost: '12', toolingCost: Number.NaN });
    expect(breakdown.processCost).toBeNull();
    expect(breakdown.toolingCost).toBeNull();
  });
});

describe('aggregateBomCosts', () => {
  it('sums known values and derives percentages from them', () => {
    const a = costResultFromAnalysis('a', analysis);
    const b = costResultFromAnalysis('b', { ...analysis, sgaCost: 10, sellingPrice: 103.5 });
    const agg = aggregateBomCosts([a, b]);
    expect(agg.totalCost).toBe(170);
    expect(agg.totalSellingPrice).toBe(197);
    expect(agg.totalSgaCost).toBe(10);
    expect(agg.totalMargin).toBe(27);
    expect(agg.averageSgaPercentage).toBeCloseTo((10 / 170) * 100);
    expect(agg.averageProfitPercentage).toBeCloseTo((17 / 197) * 100);
    expect(agg.itemCount).toBe(2);
  });

  it('makes a total unknown when any item is missing that value', () => {
    const agg = aggregateBomCosts([
      costResultFromAnalysis('a', analysis),
      costResultFromAnalysis('b', { manufacturingCost: 10 }),
    ]);
    expect(agg.totalCost).toBe(95);
    expect(agg.totalSellingPrice).toBeNull();
    expect(agg.totalMargin).toBeNull();
    expect(agg.averageProfitPercentage).toBeNull();
  });

  it('gives no percentage for a zero total', () => {
    const agg = aggregateBomCosts([costResultFromAnalysis('a', { ...analysis, manufacturingCost: 0 })]);
    expect(agg.averageSgaPercentage).toBeNull();
  });
});
