import {
  resolveStockAllowanceRule,
  stockAllowancePerSideMm,
} from '../../../../../modules/bom-items/costing/machining/stock-allowance';

// Rows as staged from memory/Stock Maching/variables.csv (migration 816).
const REFERENCE_ROWS = [
  { key: 'percentStockAllowance', value: '5' },
  { key: 'minStockAllowance', value: '0.79375' },
  { key: 'maxStockAllowance', value: '3.175' },
];

describe('resolveStockAllowanceRule', () => {
  it('reads the three reference variables', () => {
    expect(resolveStockAllowanceRule(REFERENCE_ROWS).rule).toEqual({
      percentOfMaxCrossSection: 5, minMm: 0.79375, maxMm: 3.175,
    });
  });

  it('returns no rule, naming what is missing, when a variable is absent', () => {
    const r = resolveStockAllowanceRule(REFERENCE_ROWS.slice(0, 2));
    expect(r.rule).toBeNull();
    expect(r.missing).toEqual(['maxStockAllowance']);
    expect(resolveStockAllowanceRule(null).missing).toHaveLength(3);
  });
});

describe('stockAllowancePerSideMm — percent of the max cross-section, clamped', () => {
  const rule = resolveStockAllowanceRule(REFERENCE_ROWS).rule!;

  it('takes 5% of the larger cross-section dimension (the middle of the three)', () => {
    // Length 100 is the bar axis; cross-section 50 x 20 -> max 50 -> 2.5 mm
    expect(stockAllowancePerSideMm(rule, { length: 100, width: 50, height: 20 })).toBeCloseTo(2.5, 9);
    // Orientation does not matter
    expect(stockAllowancePerSideMm(rule, { length: 20, width: 100, height: 50 })).toBeCloseTo(2.5, 9);
  });

  it('never goes below minStockAllowance on a small part', () => {
    expect(stockAllowancePerSideMm(rule, { length: 20, width: 8, height: 5 })).toBe(0.79375);
  });

  it('never goes above maxStockAllowance on a large part', () => {
    expect(stockAllowancePerSideMm(rule, { length: 500, width: 300, height: 200 })).toBe(3.175);
  });
});
