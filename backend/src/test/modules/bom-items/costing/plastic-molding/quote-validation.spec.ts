import { buildQuoteValidation } from '../../../../../modules/bom-items/costing/plastic-molding/quote-validation';

describe('buildQuoteValidation', () => {
  it('is VALIDATED and complete only when every formula used is VALIDATED and nothing is left out', () => {
    const v = buildQuoteValidation(['F-02', 'F-05', 'F-07'], []);
    expect(v).toMatchObject({ state: 'VALIDATED', complete: true, assumptions: [], unsupported: [] });
    expect(v.formulas.map((f) => f.id)).toEqual(['F-02', 'F-05', 'F-07']);
  });

  it('takes the weakest state of the formulas used, and lists each assumed formula\'s assumptions under its id', () => {
    const v = buildQuoteValidation(['F-02', 'F-03'], []);
    expect(v.state).toBe('ASSUMED');
    expect(v.assumptions.every((a) => a.startsWith('F-03: '))).toBe(true);
    expect(v.assumptions.length).toBeGreaterThan(0);
  });

  it('carries each formula\'s registered version, and a repeated id once', () => {
    const v = buildQuoteValidation(['F-04', 'F-04'], []);
    expect(v.formulas).toEqual([{ id: 'F-04', version: 1, name: 'Cooling time (Menges)', state: 'ASSUMED' }]);
  });

  it('a quote that leaves out what a real quote needs is not complete, and says what and which data is staged', () => {
    const v = buildQuoteValidation(['F-02'], ['G-03']);
    expect(v.complete).toBe(false);
    expect(v.state).toBe('VALIDATED'); // the formulas used are sound; the quote is partial
    expect(v.unsupported).toEqual([expect.objectContaining({ id: 'G-03', name: 'Slides and lifters', stagedData: expect.stringContaining('tblSlideSizes') })]);
  });

  it('an unregistered formula id is a programming error, not a silent omission', () => {
    expect(() => buildQuoteValidation(['F-99'], [])).toThrow('F-99');
    expect(() => buildQuoteValidation([], ['G-99'])).toThrow('G-99');
  });
});
