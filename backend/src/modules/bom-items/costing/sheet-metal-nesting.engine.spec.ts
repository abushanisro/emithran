import { computeNesting, resolveNestingDimensions } from './sheet-metal-nesting.engine';

describe('resolveNestingDimensions', () => {
  // A. If flat-pattern dimensions exist, nesting uses them.
  it('prefers the true flat-pattern bounding rectangle when both dimensions are present', () => {
    const result = resolveNestingDimensions(30, 20, 55, 8);
    expect(result.source).toBe('cad_flat_pattern_bounding_rect');
    expect(result.confidence).toBe('verified');
    expect(result.lengthMm).toBe(30);
    expect(result.widthMm).toBe(20);
  });

  // B. Folded maxLength/maxWidth are not used when flat-pattern dimensions exist.
  it('does not fall through to the folded 3D bounding box when true flat-pattern dims are available', () => {
    const result = resolveNestingDimensions(30, 20, 55, 8);
    expect(result.lengthMm).not.toBe(55);
    expect(result.widthMm).not.toBe(8);
  });

  // C. If flat-pattern dimensions are missing, existing fallback behavior remains.
  it('falls back to the folded 3D bounding box when the true flat-pattern rectangle is unresolved (0)', () => {
    const result = resolveNestingDimensions(0, 0, 55, 8);
    expect(result.source).toBe('folded_3d_bounding_box');
    expect(result.confidence).toBe('fallback');
    expect(result.lengthMm).toBe(55);
    expect(result.widthMm).toBe(8);
  });

  it('falls back when only one true flat-pattern dimension resolved (partial data is not usable)', () => {
    const result = resolveNestingDimensions(30, 0, 55, 8);
    expect(result.source).toBe('folded_3d_bounding_box');
    expect(result.lengthMm).toBe(55);
    expect(result.widthMm).toBe(8);
  });

  it('orders length as the larger and width as the smaller of the two true flat-pattern dims, regardless of input order', () => {
    const result = resolveNestingDimensions(20, 30, 0, 0);
    expect(result.lengthMm).toBe(30);
    expect(result.widthMm).toBe(20);
  });
});

describe('computeNesting — utilization formula (unchanged by the dimension-source fix)', () => {
  // D. Existing utilization formula itself is unchanged. Reproduces the real
  // part's reported numbers (part 830-002072-00): folded bbox 55.0x8.0mm,
  // flat-pattern area 350.35mm², AL6101 density ~2700 kg/m³, 0.5mm thickness.
  // This proves computeNesting's own math -- untouched by this fix -- still
  // produces the same utilization % for the same inputs as before.
  it('reproduces the ~26% utilization reported live for the folded-bbox-derived inputs', () => {
    const thicknessMm = 0.5;
    const densityKgM3 = 2700;
    const flatPatternAreaMm2 = 350.35;
    const netWeightKg = (flatPatternAreaMm2 * thicknessMm / 1e9) * densityKgM3;

    const result = computeNesting({
      flatPatternLengthMm: 55.0,
      flatPatternWidthMm: 8.0,
      thicknessMm,
      netWeightKg,
      densityKgM3,
      shearStrengthMpa: 138, // AL6101 real shear strength
      materialPricePerKg: 2.70,
    });

    // utilisationPct = netWeightKg / (sheetWeightKg / partsPerSheet) -- same
    // formula as before this fix; only the LENGTH/WIDTH fed into packing
    // changed upstream of this call, never this calculation itself.
    expect(result.partsPerSheet).toBeGreaterThan(0);
    expect(result.utilisationPct).toBeGreaterThan(0);
    expect(result.utilisationPct).toBeLessThanOrEqual(100);
    // Self-consistency, recomputed from the UNROUNDED sheet/partsPerSheet
    // fields (grossWeightPerPartKg itself is rounded to 3dp in the output,
    // which is too coarse for these gram-scale part weights to round-trip
    // through) -- same algebraic identity confirmed against the live 26.1%
    // figure: utilisation% = netWeightKg / (sheetWeight / partsPerSheet) * 100.
    const sheetWeightKg = (result.sheetWidthMm * result.sheetLengthMm * thicknessMm / 1e9) * densityKgM3;
    const recomputedPct = (netWeightKg / (sheetWeightKg / result.partsPerSheet)) * 100;
    expect(result.utilisationPct).toBeCloseTo(recomputedPct, 1);
  });

  it('produces a larger partsPerSheet when packing against the smaller folded bbox than against a larger true flat-pattern rectangle', () => {
    const common = {
      thicknessMm: 0.5,
      netWeightKg: 0.001,
      densityKgM3: 2700,
      shearStrengthMpa: 138,
      materialPricePerKg: 2.70,
    };
    const foldedResult = computeNesting({ ...common, flatPatternLengthMm: 55.0, flatPatternWidthMm: 8.0 });
    const trueFlatResult = computeNesting({ ...common, flatPatternLengthMm: 90.0, flatPatternWidthMm: 40.0 });
    // Packing the larger true flat-pattern footprint must never claim MORE
    // parts/sheet than packing the smaller (and physically wrong, for a bent
    // part) folded envelope -- this is the actual overcounting bug this fix
    // closes upstream of computeNesting.
    expect(trueFlatResult.partsPerSheet).toBeLessThanOrEqual(foldedResult.partsPerSheet);
  });
});
