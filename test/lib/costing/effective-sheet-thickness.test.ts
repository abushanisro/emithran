import { describe, expect, it } from 'vitest';

import { effectiveSheetThicknessMm } from '@/lib/costing/effective-sheet-thickness';

// Same order as backend resolveEffectiveSheetThicknessMm: override > CAD > stored.
describe('effectiveSheetThicknessMm', () => {
  const cad = { featureGraph: { summary: { sheetThicknessMm: 1.5 } }, sheetThicknessMm: 1.2 };

  it('the engineer override wins (the Nest view used to ignore it)', () => {
    expect(effectiveSheetThicknessMm({ ...cad, scenarioOverrides: { sheetThicknessMm: 1.6 } })).toBe(1.6);
  });
  it('else the CAD-extracted thickness', () => {
    expect(effectiveSheetThicknessMm(cad)).toBe(1.5);
  });
  it('else the stored column', () => {
    expect(effectiveSheetThicknessMm({ sheetThicknessMm: 1.2 })).toBe(1.2);
  });
  it.each([[0], [-1], ['1.6'], [Number.NaN]])('ignores a non-positive or non-numeric override (%s)', (bad) => {
    expect(effectiveSheetThicknessMm({ ...cad, scenarioOverrides: { sheetThicknessMm: bad } })).toBe(1.5);
  });
  it('is 0 when nothing is known (never a guessed thickness)', () => {
    expect(effectiveSheetThicknessMm({})).toBe(0);
  });
});
