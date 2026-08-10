import { resolveEffective, resolveEffectiveSheetThicknessMm } from './scenario-overrides';

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
