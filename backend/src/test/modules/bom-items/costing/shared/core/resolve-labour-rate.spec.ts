// Pure unit tests of resolveLabourRate's 3-tier precedence — extracted from
// bom-items.service.ts's buildOutput() specifically so this precedence
// (real machine rate > wage-grade bucket average > process-group fallback)
// is testable without any DB stubbing. No mocks needed: every input is a
// plain value, every assertion is on the pure function's return value.
import { resolveLabourRate } from '../../../../../../modules/bom-items/costing/shared/core/cost-engine';

describe('resolveLabourRate', () => {
  it('A: a real machine-specific rate wins even when a wage-grade bucket and a process-group rate both exist', () => {
    const result = resolveLabourRate(34.48, 28.0, { rate: 20.0, source: 'lhr_database' });
    expect(result).toEqual({ rate: 34.48, source: 'mhr_machine_specific' });
  });

  it('B: with no machine-specific rate, a real wage-grade bucket average is used over the process-group fallback', () => {
    const result = resolveLabourRate(null, 28.0, { rate: 20.0, source: 'lhr_database' });
    expect(result).toEqual({ rate: 28.0, source: 'wage_grade_bucket' });
  });

  it('D: with no machine-specific rate and no wage-grade bucket, the existing process-group fallback is used unchanged', () => {
    const result = resolveLabourRate(null, null, { rate: 20.0, source: 'lhr_benchmark' });
    expect(result).toEqual({ rate: 20.0, source: 'lhr_benchmark' });
  });

  it('F: with nothing resolved at any tier, no rate is fabricated — stays null with no_lhr_rate', () => {
    const result = resolveLabourRate(null, null, null);
    expect(result).toEqual({ rate: null, source: 'no_lhr_rate' });
  });

  it('F: undefined inputs (a class never present in any resolved map) behave identically to null, never fabricating a rate', () => {
    const result = resolveLabourRate(undefined, undefined, undefined);
    expect(result).toEqual({ rate: null, source: 'no_lhr_rate' });
  });

  it('a machine-specific rate of exactly 0 is a real resolved value, not treated as "missing"', () => {
    // 0 is a legitimate (if unusual) real rate — only null/undefined mean "no data".
    const result = resolveLabourRate(0, 28.0, { rate: 20.0, source: 'lhr_database' });
    expect(result).toEqual({ rate: 0, source: 'mhr_machine_specific' });
  });
});
