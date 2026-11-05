import { defined, loadReference, material } from './forging-fixtures';
import { chooseRoundBar } from '../../../../../modules/bom-items/costing/forging/forging-stock';

const ref = loadReference();
const steel = material('Steel, Hot Worked, AISI 1045');
const valid = (r: ReturnType<typeof chooseRoundBar>) => r.checks.filter((c) => c.valid).map((c) => c.diameterMm);

describe('round bar choice (v1.1 6.5, D8)', () => {
  it('induction: only Ø44.45 gives 2 <= L/D <= 3.5 for the worked example', () => {
    // mult 181,800 mm³; L/D = 181,800 / (π/4 × D³), so
    //   L/D <= 3.5 (maxBilletRatio)           → D³ >= 181,800 / (0.785398 × 3.5) = 66,137 → D >= 40.45 mm
    //   L/D >= 2   (inductionHeatMinMultRatio) → D³ <= 181,800 / (0.785398 × 2)   = 115,739 → D <= 48.73 mm
    // The only forging_roundBarSizes size in [40.45, 48.73] is 44.45.
    const r = chooseRoundBar({ reference: ref, material: steel, partVolumeMm3: 150_000, complexityScore: 6, heating: 'induction' });
    if (!r.ok) throw new Error(r.reason);
    expect(valid(r)).toEqual([44.45]);
    expect(r.chosen.barDiameterMm).toBe(44.45);
    expect(r.chosen.grossKg).toBeCloseTo(1.46581, 5);
    // Ø50.8: L = 181,800 / 2026.83 = 89.70 mm, L/D = 1.766 → valid stock but too short for induction.
    const d508 = defined(r.checks.find((c) => c.diameterMm === 50.8), 'Ø50.8 check');
    expect(d508.valid).toBe(false);
    expect(d508.reasons).toEqual(['L/D 1.766 < inductionHeatMinMultRatio 2']);
    // Ø38.1: L = 181,800 / 1140.09 = 159.46 mm, L/D = 4.185 → too long.
    expect(defined(r.checks.find((c) => c.diameterMm === 38.1), 'Ø38.1 check').reasons).toEqual(['L/D 4.185 > maxBilletRatio 3.5']);
  });

  it('furnace: Ø44.45 to Ø88.9 are valid and the smallest is cheapest (least kerf)', () => {
    // mult 185,400 mm³ (3 % scale): 0.3 <= L/D <= 3.5 → 40.71 mm <= D <= 92.29 mm.
    // Gross = mult + π/4 × D² × 3.175 rises with D, so Ø44.45 is cheapest:
    // 185,400 + 4,926.94 = 190,326.94 mm³ → 1.494066 kg × 1.479 = 2.20972 USD.
    const r = chooseRoundBar({ reference: ref, material: steel, partVolumeMm3: 150_000, complexityScore: 6, heating: 'furnace' });
    if (!r.ok) throw new Error(r.reason);
    expect(valid(r)).toEqual([44.45, 50.8, 57.15, 63.5, 69.85, 76.2, 82.55, 88.9]);
    expect(r.chosen.barDiameterMm).toBe(44.45);
    expect(r.chosen.grossKg).toBeCloseTo(1.494066, 6);
    expect(r.chosen.grossCostUsd).toBeCloseTo(2.20972, 5);
    expect(r.trace[0].value).toContain('validMaterialStocksListLimit / virtualMaterialStocksListLimit not applied');
  });

  it('golden parts pick the bars the weights golden cases use', () => {
    const disc = chooseRoundBar({ reference: ref, material: steel, partVolumeMm3: (Math.PI / 4) * 80 * 80 * 20, complexityScore: 2, heating: 'furnace' });
    const block = chooseRoundBar({ reference: ref, material: steel, partVolumeMm3: 72_000, complexityScore: 4, heating: 'induction' });
    if (!disc.ok || !block.ok) throw new Error('stock');
    expect(valid(disc)).toEqual([38.1, 44.45, 50.8, 57.15, 63.5, 69.85]);
    expect(disc.chosen.barDiameterMm).toBe(38.1);
    expect(valid(block)).toEqual([31.75]);
  });

  it('no valid bar is a named gap listing the limits', () => {
    // A 1e9 mm³ part: mult = 1e9 × 1.20 (20 % flash) × 1.03 (3 % scale) = 1.236e9 mm³.
    // At Ø330.2, the largest size: L/D = 1.236e9 / (π/4 × 330.2³) = 1.236e9 / 28,276,000 = 43.7 > 3.5.
    const r = chooseRoundBar({ reference: ref, material: steel, partVolumeMm3: 1e9, complexityScore: 6, heating: 'furnace' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('No round bar in forging_roundBarSizes (31 sizes) gives a valid mult (minBilletRatio 0.3 to maxBilletRatio 3.5).');
  });

  it('a missing input stops the choice and is named', () => {
    const r = chooseRoundBar({ reference: ref, material: steel, partVolumeMm3: 150_000, complexityScore: 6, heating: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('Gross weight not derivable: missing heating method (induction or furnace).');
  });
});
