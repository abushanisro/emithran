import { erf } from 'mathjs';
import { erfInverse } from '../../../modules/calculators/calculator-formula-evaluator';

describe('erfInverse (ERFINV in calculator formulas)', () => {
  // Tabulated values: erf(0.5) = 0.5204998778, erf(1) = 0.8427007929, erf(0.3) = 0.3286267595 (Abramowitz and Stegun table 7.1).
  it.each([[0.5204998778, 0.5], [0.8427007929, 1], [0.3286267595, 0.3]])('erfinv(%f) = %f', (y, x) => {
    expect(erfInverse(y)).toBeCloseTo(x, 8);
  });

  it('is odd, zero at zero, and the inverse of erf across the range', () => {
    expect(erfInverse(0)).toBe(0);
    expect(erfInverse(-0.5)).toBeCloseTo(-erfInverse(0.5), 14);
    for (const y of [-0.999, -0.9, -0.3, 0.01, 0.4222, 0.6444, 0.9, 0.999999]) {
      expect(erf(erfInverse(y)) as number).toBeCloseTo(y, 12);
    }
  });

  it('refuses a value outside (-1, 1) rather than returning a number', () => {
    for (const y of [1, -1, 1.5, NaN, Infinity]) expect(() => erfInverse(y)).toThrow(/strictly between/);
  });
});
