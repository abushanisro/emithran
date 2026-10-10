import { describe, expect, it } from 'vitest';

import { estimateRectPartsPerSheet, recommendSheets } from '@/lib/costing/sheet-recommendation';

// Salvagnini L3-30 (bed 3050 x 1525) candidates: standard sheet + library laser sheets that fit.
const candidates = [
  { widthMm: 1219.2, lengthMm: 2438.4, source: 'Standard sheet' },
  { widthMm: 1524, lengthMm: 3048, source: 'Laser nominal sheet' },
  { widthMm: 1500, lengthMm: 3000, source: 'Laser nominal sheet' },
  { widthMm: 2000, lengthMm: 4000, source: 'Laser nominal sheet' },
];

describe('estimateRectPartsPerSheet (laser_cutting_costing_params §6a)', () => {
  // §6b worked example: 1219 x 2438 sheet -> 47 x 95 = 4465 parts (25 x 25 mm part, 0 kerf/margin).
  it('reproduces the §6b worked example: 1219 x 2438 sheet -> 4465 parts', () => {
    expect(estimateRectPartsPerSheet(1219, 2438, 25.6, 25.6, 0, 0)).toBe(4465);
  });
  it('is 0 when the part does not fit', () => {
    expect(estimateRectPartsPerSheet(1219, 2438, 3000, 3000, 0, 2)).toBe(0);
  });
});

describe('recommendSheets', () => {
  const part = { widthMm: 300, lengthMm: 400, areaMm2: 300 * 400 * 0.8 };

  it('shows the top 3 by yield, best first, and recommends only the best', () => {
    const top = recommendSheets(candidates, part, 2, 2);
    expect(top).toHaveLength(3);
    expect(top.filter((s) => s.recommended)).toHaveLength(1);
    expect(top[0]?.recommended).toBe(true);
    const yields = top.map((s) => s.utilizationPct ?? Number.NaN);
    expect(yields).toEqual([...yields].sort((a, b) => b - a));
  });

  it('kerf and margin change the ranking inputs (follows the costed setup)', () => {
    const a = recommendSheets(candidates, part, 0, 0).map((s) => s.partsPerSheet);
    const b = recommendSheets(candidates, part, 10, 50).map((s) => s.partsPerSheet);
    expect(a).not.toEqual(b);
  });

  it('before the outline loads: smallest sheets first, nothing recommended', () => {
    const top = recommendSheets(candidates, null, 2, 2);
    expect(top.map((s) => s.widthMm)).toEqual([1219.2, 1500, 1524]);
    expect(top.some((s) => s.recommended)).toBe(false);
  });

  it('recommends nothing when the part fits no candidate', () => {
    expect(recommendSheets(candidates, { widthMm: 5000, lengthMm: 5000, areaMm2: 1 }, 2, 2).some((s) => s.recommended)).toBe(false);
  });

  it('no candidates -> nothing to show', () => {
    expect(recommendSheets([], part, 2, 2)).toEqual([]);
  });
});
