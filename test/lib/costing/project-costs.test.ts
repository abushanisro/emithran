import { describe, expect, it } from 'vitest';
import { formatProjectMoney, projectSavings, summarizeProjectCosts } from '@/lib/costing/project-costs';

describe('project financial display', () => {
  it('does not turn unknown costs into zero or 100% savings', () => {
    expect(summarizeProjectCosts([{ actualCost: null, targetBomCost: 100 }])).toEqual({
      actual: null, target: 100, savings: null, savingsPercent: null,
    });
    expect(projectSavings({ actualCost: null, targetBomCost: 100 })).toBeNull();
    expect(formatProjectMoney(null)).toBe('—');
    expect(formatProjectMoney(undefined)).toBe('—');
  });
  it('keeps the whole portfolio unresolved if one project is unresolved', () => {
    expect(summarizeProjectCosts([{ actualCost: 70, targetBomCost: 100 }, { actualCost: null, targetBomCost: 200 }]).actual).toBeNull();
  });
  it('preserves verified zero costs', () => {
    expect(formatProjectMoney(0)).toBe('$0.00');
    expect(summarizeProjectCosts([{ actualCost: 0, targetBomCost: 100 }]).savingsPercent).toBe(100);
  });
  it('does not sum or compare unlike currencies', () => {
    expect(projectSavings({ actualCost: 70, actualCostCurrency: 'USD', targetBomCost: 100, targetBomCostCurrency: 'INR' })).toBeNull();
    expect(summarizeProjectCosts([{ actualCost: 70, actualCostCurrency: 'USD', targetBomCost: 100, targetBomCostCurrency: 'INR' }]).savings).toBeNull();
    expect(summarizeProjectCosts([{ actualCost: 70, actualCostCurrency: 'INR', targetBomCost: 100 }]).actual).toBeNull();
  });
  it('requires an actual target rather than treating a missing budget as zero', () => {
    expect(projectSavings({ actualCost: 70 })).toBeNull();
    expect(summarizeProjectCosts([{ actualCost: 70 }]).target).toBeNull();
  });
  it('computes complete portfolio savings', () => {
    expect(summarizeProjectCosts([{ actualCost: 70, targetBomCost: 100 }])).toEqual({ actual: 70, target: 100, savings: 30, savingsPercent: 30 });
  });
});
