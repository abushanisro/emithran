import {
  resolveEffective, resolveEffectiveSheetThicknessMm,
  resolveScenarioCurrency, resolveScenarioFxSnapshot, resolveScenarioAskPrice,
} from '../../../../../../modules/bom-items/costing/shared/physics/scenario-overrides';

describe('resolveEffective', () => {
  it('prefers the override when present', () => {
    expect(resolveEffective(2, 1.5, 0)).toBe(2);
  });
  it('falls through to the detected value when no override', () => {
    expect(resolveEffective(null, 1.5, 0)).toBe(1.5);
    expect(resolveEffective(undefined, 1.5, 0)).toBe(1.5);
  });
  it('falls through to the fallback when neither override nor detected value exist', () => {
    expect(resolveEffective(null, null, 3)).toBe(3);
    expect(resolveEffective(undefined, undefined, 3)).toBe(3);
  });
});

describe('resolveEffectiveSheetThicknessMm', () => {
  it('uses the manual override from scenarioOverrides when present', () => {
    expect(resolveEffectiveSheetThicknessMm({ sheetThicknessMm: 2 }, 1.5, 0)).toBe(2);
  });
  it('falls through to the real CAD-detected thickness when no override is set', () => {
    expect(resolveEffectiveSheetThicknessMm({}, 1.5, 0)).toBe(1.5);
    expect(resolveEffectiveSheetThicknessMm(undefined, 1.5, 0)).toBe(1.5);
    expect(resolveEffectiveSheetThicknessMm(null, 1.5, 0)).toBe(1.5);
  });
  it('falls through to the bom_items fallback column when neither an override nor CAD data exist', () => {
    expect(resolveEffectiveSheetThicknessMm({}, null, 3)).toBe(3);
    expect(resolveEffectiveSheetThicknessMm({}, undefined, 3)).toBe(3);
  });
  it('preserves an explicit CAD-detected 0 rather than treating it as absent (matches the original ?? chain)', () => {
    expect(resolveEffectiveSheetThicknessMm({}, 0, 3)).toBe(0);
  });
  it('ignores a non-numeric or non-positive override value rather than costing on garbage', () => {
    expect(resolveEffectiveSheetThicknessMm({ sheetThicknessMm: 'thick' as any }, 1.5, 0)).toBe(1.5);
    expect(resolveEffectiveSheetThicknessMm({ sheetThicknessMm: -1 }, 1.5, 0)).toBe(1.5);
    expect(resolveEffectiveSheetThicknessMm({ sheetThicknessMm: 0 }, 1.5, 0)).toBe(1.5);
  });
});

describe('resolveScenarioCurrency', () => {
  it('reads a valid ISO 4217-shaped code', () => {
    expect(resolveScenarioCurrency({ scenarioCurrency: 'EUR' })).toBe('EUR');
  });
  it('returns null rather than guessing when unset, malformed, or lowercase', () => {
    expect(resolveScenarioCurrency(null)).toBeNull();
    expect(resolveScenarioCurrency({})).toBeNull();
    expect(resolveScenarioCurrency({ scenarioCurrency: 'eur' })).toBeNull();
    expect(resolveScenarioCurrency({ scenarioCurrency: 'EURO' })).toBeNull();
    expect(resolveScenarioCurrency({ scenarioCurrency: 123 as any })).toBeNull();
  });
});

describe('resolveScenarioFxSnapshot', () => {
  const WELL_FORMED = {
    factoryCurrency: 'INR', scenarioCurrency: 'USD',
    provider: 'frankfurter', source: 'ECB reference rates', rate: 0.012,
    rateDate: '2026-08-17', rateType: 'reference', retrievedAt: '2026-08-17T10:00:00Z',
  };

  it('parses a well-formed snapshot verbatim', () => {
    expect(resolveScenarioFxSnapshot({ fxSnapshot: WELL_FORMED })).toEqual(WELL_FORMED);
  });
  it('returns null rather than guessing when absent or malformed — never fabricates a rate', () => {
    expect(resolveScenarioFxSnapshot(null)).toBeNull();
    expect(resolveScenarioFxSnapshot({})).toBeNull();
    expect(resolveScenarioFxSnapshot({ fxSnapshot: 'not-an-object' })).toBeNull();
    expect(resolveScenarioFxSnapshot({ fxSnapshot: { ...WELL_FORMED, rate: -1 } })).toBeNull();
    expect(resolveScenarioFxSnapshot({ fxSnapshot: { ...WELL_FORMED, rate: 'fast' } })).toBeNull();
    expect(resolveScenarioFxSnapshot({ fxSnapshot: { scenarioCurrency: 'USD', rate: 1 } })).toBeNull(); // missing factoryCurrency
  });
  it('defaults an unrecognized rateType to reference rather than throwing', () => {
    const result = resolveScenarioFxSnapshot({ fxSnapshot: { ...WELL_FORMED, rateType: 'bogus' } });
    expect(result?.rateType).toBe('reference');
  });
  it('preserves a custom rate\'s reason', () => {
    const result = resolveScenarioFxSnapshot({
      fxSnapshot: { ...WELL_FORMED, rateType: 'custom', customReason: 'Contract-locked Q3 rate' },
    });
    expect(result?.rateType).toBe('custom');
    expect(result?.customReason).toBe('Contract-locked Q3 rate');
  });
});

describe('resolveScenarioAskPrice', () => {
  it('parses a well-formed ask price', () => {
    expect(resolveScenarioAskPrice({ askPrice: { amount: 12.5, currency: 'USD' } }))
      .toEqual({ amount: 12.5, currency: 'USD' });
  });
  it('returns null rather than guessing when absent or malformed', () => {
    expect(resolveScenarioAskPrice(null)).toBeNull();
    expect(resolveScenarioAskPrice({})).toBeNull();
    expect(resolveScenarioAskPrice({ askPrice: { amount: -1, currency: 'USD' } })).toBeNull();
    expect(resolveScenarioAskPrice({ askPrice: { amount: 'lots', currency: 'USD' } })).toBeNull();
    expect(resolveScenarioAskPrice({ askPrice: { amount: 12.5 } })).toBeNull(); // missing currency
  });
  it('allows a zero ask price (not yet quoted) without treating it as absent', () => {
    expect(resolveScenarioAskPrice({ askPrice: { amount: 0, currency: 'USD' } }))
      .toEqual({ amount: 0, currency: 'USD' });
  });
});
