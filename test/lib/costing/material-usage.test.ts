import { describe, it, expect } from 'vitest';

import {
  deriveMaterialUsage,
  isStockDrivenBlank,
  FALLBACK_SCRAP_PCT,
} from '@/lib/costing/material-usage';
import type { BlankSpecDto } from '@/lib/api/hooks/useBOMItems';

// Mirrors how the backend builds a machining blankSpec (bom-items.service.ts):
// gross = stock volume x density, both rounded to 3 dp.
const r3 = (n: number) => Math.round(n * 1000) / 1000;
function machiningBlank(
  form: BlankSpecDto['form'],
  stockVolMm3: number,
  densityKgM3: number,
  partVolMm3: number,
): BlankSpecDto {
  const gross = r3((stockVolMm3 / 1e9) * densityKgM3);
  const net = r3((partVolMm3 / 1e9) * densityKgM3);
  return {
    form,
    sizeLabel: 'test stock',
    grossWeightKg: gross,
    netWeightKg: net,
    utilizationPct: gross > 0 ? Math.round((net / gross) * 1000) / 10 : 0,
    wasteKg: r3(Math.max(0, gross - net)),
    wasteCost: 0,
  };
}

const none = {
  isSheetMetal: false,
  engineGrossKg: null,
  engineNetKg: null,
  itemVolumeMm3: null,
  densityKgM3: null,
  cadWeightKg: null,
} as const;

describe('deriveMaterialUsage — machining stock drives Gross Usage', () => {
  // The reported part: Aluminum ANSI 6061 (2700 kg/m3), 86 x 66 x 31 mm billet,
  // 48,000 mm3 finished part (0.1296 kg).
  const stock = 86 * 66 * 31; // 175,956 mm3
  const blank = machiningBlank('billet', stock, 2700, 48_000);

  it('uses the selected stock weight, not net / (1 - 10%)', () => {
    const r = deriveMaterialUsage({
      ...none, blankSpec: blank, itemVolumeMm3: 48_000, densityKgM3: 2700,
    });
    expect(r.source).toBe('stock_blank');
    expect(r.grossUsage).toBeCloseTo(0.475, 3);
    expect(r.netUsage).toBeCloseTo(0.13, 3);
    // The old wrong answer for this same part.
    expect(r.grossUsage).not.toBeCloseTo(0.144, 2);
  });

  it('derives scrap % from real gross/net, and chip weight matches wasteKg', () => {
    const r = deriveMaterialUsage({ ...none, blankSpec: blank });
    expect(r.scrapPct).toBeCloseTo(72.63, 1);
    expect(r.grossUsage - r.netUsage).toBeCloseTo(0.345, 3);
    expect(blank.utilizationPct).toBeCloseTo(27.4, 1);
  });

  it('gives a different gross for a different stock size and material', () => {
    // Round bar of 304 stainless (8073 kg/m3): pi/4 * 40^2 * 100 mm.
    const bar = machiningBlank('round_bar', (Math.PI / 4) * 40 * 40 * 100, 8073, 60_000);
    const a = deriveMaterialUsage({ ...none, blankSpec: blank });
    const b = deriveMaterialUsage({ ...none, blankSpec: bar });
    expect(b.source).toBe('stock_blank');
    expect(b.grossUsage).toBeCloseTo(((Math.PI / 4) * 40 * 40 * 100 / 1e9) * 8073, 3);
    expect(b.grossUsage).not.toBeCloseTo(a.grossUsage, 2);
  });

  it('takes precedence over the volume x density fallback even when both are present', () => {
    const r = deriveMaterialUsage({
      ...none, blankSpec: blank, itemVolumeMm3: 48_000, densityKgM3: 2700, cadWeightKg: 0.1296,
    });
    expect(r.source).toBe('stock_blank');
  });
});

describe('deriveMaterialUsage — falls back only when there is no real stock', () => {
  it('density unresolved (backend zeroes gross) -> disclosed 10% estimate', () => {
    const noDensity: BlankSpecDto = {
      form: 'billet', sizeLabel: '86x66x31', grossWeightKg: 0, netWeightKg: 0,
      utilizationPct: 0, wasteKg: 0, wasteCost: 0,
    };
    const r = deriveMaterialUsage({
      ...none, blankSpec: noDensity, itemVolumeMm3: 48_000, densityKgM3: 2700,
    });
    expect(r.source).toBe('scrap_allowance_fallback');
    expect(r.netUsage).toBeCloseTo(0.1296, 4);
    expect(r.grossUsage).toBeCloseTo(0.144, 4);
    expect(r.scrapPct).toBe(FALLBACK_SCRAP_PCT);
  });

  it('a blank lighter than the part is not trusted (inconsistent geometry/units)', () => {
    const impossible = machiningBlank('billet', 20_000, 2700, 48_000);
    expect(isStockDrivenBlank(impossible)).toBe(false);
    const r = deriveMaterialUsage({
      ...none, blankSpec: impossible, itemVolumeMm3: 48_000, densityKgM3: 2700,
    });
    expect(r.source).toBe('scrap_allowance_fallback');
  });

  it('casting / granules forms are out of scope and never stock-driven', () => {
    expect(isStockDrivenBlank(machiningBlank('casting', 100_000, 2700, 48_000))).toBe(false);
    expect(isStockDrivenBlank(machiningBlank('granules', 100_000, 1000, 48_000))).toBe(false);
  });

  it('cad weight, then engine gross, then nothing', () => {
    expect(deriveMaterialUsage({ ...none, blankSpec: undefined, cadWeightKg: 0.9 }).grossUsage)
      .toBeCloseTo(1.0, 6);
    const eng = deriveMaterialUsage({ ...none, blankSpec: undefined, engineGrossKg: 1 });
    expect(eng.netUsage).toBeCloseTo(0.9, 6);
    expect(eng.source).toBe('scrap_allowance_fallback');
    expect(deriveMaterialUsage({ ...none, blankSpec: undefined }).source).toBe('none');
  });
});

describe('deriveMaterialUsage — sheet metal path is unchanged', () => {
  it('uses the nesting engine gross/net and derives real scrap %', () => {
    const sheetBlank: BlankSpecDto = {
      form: 'sheet', sizeLabel: '1220x2440', grossWeightKg: 0.5, netWeightKg: 0.3,
      utilizationPct: 60, wasteKg: 0.2, wasteCost: 0,
    };
    const r = deriveMaterialUsage({
      ...none, blankSpec: sheetBlank, isSheetMetal: true, engineGrossKg: 0.5, engineNetKg: 0.3,
    });
    expect(r.source).toBe('sheet_nesting');
    expect(r.scrapPct).toBeCloseTo(40, 2);
    expect(isStockDrivenBlank(sheetBlank)).toBe(false);
  });
});
