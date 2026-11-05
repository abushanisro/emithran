import { loadReference, material } from './forging-fixtures';
import { barArea, forgingWeights } from '../../../../../modules/bom-items/costing/forging/forging-weights';

// Units: volumes mm³, lengths mm, mass kg (mm³ × 1e-9 m³/mm³ × kg/m³), cost USD.
const ref = loadReference();
const steel = material('Steel, Hot Worked, AISI 1045'); // 7850 kg/m³, 1.479 USD/kg
const alu = material('Aluminum, ANSI 6061'); // 2700 kg/m³, 5.875 USD/kg

describe('forging weights (v1.1 6.1, 6.3, 6.5)', () => {
  it('v1.1 worked example: Vp 150,000 mm³, complexity 6, Ø44.45 bar, induction', () => {
    const r = forgingWeights({ reference: ref, material: steel, partVolumeMm3: 150_000, complexityScore: 6, heating: 'induction', barDiameterMm: 44.45 });
    if (!r.ok) throw new Error(r.missing.join('; '));
    const w = r.weights;
    // net    150,000 × 1e-9 × 7850 = 1.1775 kg
    expect(w.netKg).toBeCloseTo(1.1775, 6);
    // flash  20 % (complexity 6) × 150,000 = 30,000 mm³ → 0.2355 kg
    expect(w.flashPct).toBe(20);
    expect(w.flashVolumeMm3).toBeCloseTo(30_000, 6);
    expect(w.flashKg).toBeCloseTo(0.2355, 6);
    // scale  1 % (induction) × (150,000 + 30,000) = 1,800 mm³
    expect(w.scaleVolumeMm3).toBeCloseTo(1_800, 6);
    // mult   150,000 + 30,000 + 1,800 = 181,800 mm³
    expect(w.multVolumeMm3).toBeCloseTo(181_800, 6);
    // bar    π/4 × 44.45² = 1551.79 mm²; L = 181,800 / 1551.79 = 117.15 mm; L/D = 117.15 / 44.45 = 2.636
    expect(w.barAreaMm2).toBeCloseTo(1551.7917, 3);
    expect(w.multLengthMm).toBeCloseTo(117.1549, 3);
    expect(w.multRatio).toBeCloseTo(2.6357, 4);
    // kerf   1551.79 × 3.175 = 4,926.94 mm³
    expect(w.kerfVolumeMm3).toBeCloseTo(4926.9385, 3);
    // gross  181,800 + 4,926.94 = 186,726.94 mm³ × 1e-9 × 7850 = 1.46581 kg; × 1.479 = 2.1679 USD
    expect(w.grossVolumeMm3).toBeCloseTo(186_726.9385, 3);
    expect(w.grossKg).toBeCloseTo(1.46581, 5);
    expect(w.grossCostUsd).toBeCloseTo(2.16793, 5);
    // yield  150,000 / 186,726.94 = 80.33 %
    expect(w.materialYield).toBeCloseTo(0.80331, 5);
  });

  it('golden disc Ø80 × 20, complexity 2 (no flash), furnace, Ø38.1 bar', () => {
    // Vp = π/4 × 80² × 20 = 100,530.96 mm³
    const vp = barArea(80) * 20;
    const r = forgingWeights({ reference: ref, material: steel, partVolumeMm3: vp, complexityScore: 2, heating: 'furnace', barDiameterMm: 38.1 });
    if (!r.ok) throw new Error(r.missing.join('; '));
    const w = r.weights;
    expect(vp).toBeCloseTo(100_530.9649, 3);
    // net    100,530.96 × 1e-9 × 7850 = 0.789168 kg
    expect(w.netKg).toBeCloseTo(0.789168, 6);
    // flash  0 % (complexity 2) → 0
    expect(w.flashVolumeMm3).toBe(0);
    // scale  3 % (gas furnace) × 100,530.96 = 3,015.93 mm³ → 0.023675 kg
    expect(w.scaleVolumeMm3).toBeCloseTo(3015.9289, 3);
    expect(w.scaleKg).toBeCloseTo(0.023675, 6);
    // mult   103,546.89 mm³ on π/4 × 38.1² = 1140.09 mm²: L = 90.82 mm, L/D = 2.384
    expect(w.multVolumeMm3).toBeCloseTo(103_546.8939, 3);
    expect(w.multRatio).toBeCloseTo(2.3838, 4);
    // kerf   1140.09 × 3.175 = 3,619.79 mm³ → 0.028415 kg
    expect(w.kerfKg).toBeCloseTo(0.028415, 6);
    // gross  107,166.69 mm³ → 0.841258 kg × 1.479 = 1.24422 USD
    expect(w.grossKg).toBeCloseTo(0.841258, 6);
    expect(w.grossCostUsd).toBeCloseTo(1.24422, 5);
  });

  it('golden block 60 × 40 × 30, complexity 4 (12 % flash), induction, Ø31.75 bar', () => {
    const r = forgingWeights({ reference: ref, material: steel, partVolumeMm3: 72_000, complexityScore: 4, heating: 'induction', barDiameterMm: 31.75 });
    if (!r.ok) throw new Error(r.missing.join('; '));
    const w = r.weights;
    // net    72,000 × 1e-9 × 7850 = 0.5652 kg
    expect(w.netKg).toBeCloseTo(0.5652, 6);
    // flash  12 % × 72,000 = 8,640 mm³ → 0.067824 kg
    expect(w.flashVolumeMm3).toBeCloseTo(8_640, 6);
    expect(w.flashKg).toBeCloseTo(0.067824, 6);
    // scale  1 % × 80,640 = 806.4 mm³
    expect(w.scaleVolumeMm3).toBeCloseTo(806.4, 6);
    // mult   81,446.4 mm³ on π/4 × 31.75² = 791.73 mm²: L = 102.87 mm, L/D = 3.240
    expect(w.multRatio).toBeCloseTo(3.2400, 4);
    // kerf   791.73 × 3.175 = 2,513.74 mm³; gross 83,960.14 mm³ → 0.659087 kg × 1.479 = 0.974790 USD
    expect(w.kerfVolumeMm3).toBeCloseTo(2513.7441, 3);
    expect(w.grossKg).toBeCloseTo(0.659087, 6);
    expect(w.grossCostUsd).toBeCloseTo(0.974790, 5);
    // yield  72,000 / 83,960.14 = 85.75 %
    expect(w.materialYield).toBeCloseTo(0.85755, 5);
  });

  it('golden flanged part (hub Ø40 × 30 + flange Ø100 × 10), Al 6061, complexity 7 (21 %), furnace, Ø38.1 bar', () => {
    // Vp = π/4 × (40² × 30 + 100² × 10) = π/4 × 148,000 = 116,238.93 mm³
    const vp = (Math.PI / 4) * (40 * 40 * 30 + 100 * 100 * 10);
    const r = forgingWeights({ reference: ref, material: alu, partVolumeMm3: vp, complexityScore: 7, heating: 'furnace', barDiameterMm: 38.1 });
    if (!r.ok) throw new Error(r.missing.join('; '));
    const w = r.weights;
    // net    116,238.93 × 1e-9 × 2700 = 0.313845 kg
    expect(w.netKg).toBeCloseTo(0.313845, 6);
    // flash  21 % × 116,238.93 = 24,410.17 mm³ → 0.065907 kg
    expect(w.flashVolumeMm3).toBeCloseTo(24_410.1749, 3);
    // scale  3 % × 140,649.10 = 4,219.47 mm³
    expect(w.scaleVolumeMm3).toBeCloseTo(4219.4731, 3);
    // mult   144,868.58 mm³ on 1140.09 mm²: L = 127.07 mm, L/D = 3.335
    expect(w.multRatio).toBeCloseTo(3.3351, 4);
    // gross  144,868.58 + 3,619.79 = 148,488.37 mm³ → 0.400919 kg × 5.875 = 2.35540 USD
    expect(w.grossKg).toBeCloseTo(0.400919, 6);
    expect(w.grossCostUsd).toBeCloseTo(2.35540, 5);
  });

  it('names every missing input; no default complexity, heating, volume or price', () => {
    const r = forgingWeights({
      reference: ref, material: { ...steel, roundBarUsdPerKg: null }, partVolumeMm3: null,
      complexityScore: null, heating: null, barDiameterMm: 44.45,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.missing).toEqual([
      'part volume (mm³)',
      'Steel, Hot Worked, AISI 1045: Round Bar Unit Cost (USD/kg)',
      'part complexity score (1-12; its scoring algorithm is not in memory, v1.1 6.2: enter it)',
      'heating method (induction or furnace)',
    ]);
  });

  it('a complexity score with no table row is a gap, not the nearest row', () => {
    const r = forgingWeights({ reference: ref, material: steel, partVolumeMm3: 150_000, complexityScore: 13, heating: 'furnace', barDiameterMm: 44.45 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing).toEqual(['forging_partComplexityBasedData row for part complexity 13']);
  });
});
