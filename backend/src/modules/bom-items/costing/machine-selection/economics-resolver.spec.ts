import {
  resolveMachineEconomics,
  type MachineEconomicsRow,
} from './economics-resolver';

function row(overrides: Partial<MachineEconomicsRow> = {}): MachineEconomicsRow {
  return {
    direct_overhead_rate: null,
    direct_overhead_source: null,
    indirect_overhead_rate: null,
    indirect_overhead_source: null,
    usd_lhr_total: null,
    labor_rate_source: null,
    benchmark_direct_overhead_rate_usd_hr: null,
    benchmark_indirect_overhead_rate_usd_hr: null,
    benchmark_labor_rate_usd_hr: null,
    ...overrides,
  };
}

describe('resolveMachineEconomics — tier priority', () => {
  it('a real shop_override value always wins, even over a benchmark on the same row', () => {
    const result = resolveMachineEconomics(row({
      direct_overhead_rate: 19.6, direct_overhead_source: 'shop_override',
      benchmark_direct_overhead_rate_usd_hr: 6.35,
    }));
    expect(result.directOverheadRate).toEqual({ value: 19.6, source: 'shop_override', confidence: 'high', reason: null });
  });

  it('a real imported value wins over a benchmark, same as shop_override', () => {
    const result = resolveMachineEconomics(row({
      indirect_overhead_rate: 14.6, indirect_overhead_source: 'imported',
      benchmark_indirect_overhead_rate_usd_hr: 8.4,
    }));
    expect(result.indirectOverheadRate).toEqual({ value: 14.6, source: 'imported', confidence: 'high', reason: null });
  });

  it('a real numeric value with no source tag defensively defaults to imported (predates this initiative)', () => {
    const result = resolveMachineEconomics(row({ usd_lhr_total: 2.16, labor_rate_source: null }));
    expect(result.laborRateUsdHr.source).toBe('imported');
    expect(result.laborRateUsdHr.confidence).toBe('high');
  });

  it('falls back to the industry benchmark when no real value is on file', () => {
    const result = resolveMachineEconomics(row({ benchmark_direct_overhead_rate_usd_hr: 6.35 }));
    expect(result.directOverheadRate.value).toBe(6.35);
    expect(result.directOverheadRate.source).toBe('benchmark');
    expect(result.directOverheadRate.confidence).toBe('medium');
    expect(result.directOverheadRate.reason).toMatch(/industry benchmark/i);
  });

  it('resolves to null/no_rate — never a fabricated number — when neither a real value nor a benchmark exists', () => {
    const result = resolveMachineEconomics(row());
    expect(result.directOverheadRate).toEqual({
      value: null, source: 'no_rate', confidence: 'low',
      reason: expect.stringContaining('No direct overhead rate on file'),
    });
    expect(result.laborRateUsdHr).toEqual({
      value: null, source: 'no_rate', confidence: 'low',
      reason: expect.stringContaining('No labor rate on file'),
    });
  });

  it('resolves each of the three fields independently within the same row', () => {
    const result = resolveMachineEconomics(row({
      direct_overhead_rate: 19.6, direct_overhead_source: 'shop_override',
      benchmark_indirect_overhead_rate_usd_hr: 8.4,
      // labor: nothing on file at all
    }));
    expect(result.directOverheadRate.source).toBe('shop_override');
    expect(result.indirectOverheadRate.source).toBe('benchmark');
    expect(result.laborRateUsdHr.source).toBe('no_rate');
    expect(result.laborRateUsdHr.value).toBeNull();
  });
});
