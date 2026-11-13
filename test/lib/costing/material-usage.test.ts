import { describe, expect, it } from 'vitest';

import { isStockDrivenBlank } from '@/lib/costing/material-usage';

const blank = (form: string, grossWeightKg: number, netWeightKg: number) => ({ form, grossWeightKg, netWeightKg }) as Parameters<typeof isStockDrivenBlank>[0];

// The derivation itself is the backend's (backend/src/test/modules/bom-items/material-usage-cases.spec.ts).
describe('isStockDrivenBlank', () => {
  it('a real bar or billet at least as heavy as the part drives Gross Usage', () => {
    expect(isStockDrivenBlank(blank('round_bar', 0.4, 0.13))).toBe(true);
    expect(isStockDrivenBlank(blank('billet', 1, 1))).toBe(true);
  });

  it('a blank lighter than the part, an unresolved weight, or a non-stock form does not', () => {
    expect(isStockDrivenBlank(blank('round_bar', 0.1, 0.13))).toBe(false);
    expect(isStockDrivenBlank(blank('round_bar', 0, 0.13))).toBe(false);
    expect(isStockDrivenBlank(blank('casting', 0.4, 0.13))).toBe(false);
    expect(isStockDrivenBlank(blank('sheet', 0.4, 0.13))).toBe(false);
    expect(isStockDrivenBlank(null)).toBe(false);
  });
});
