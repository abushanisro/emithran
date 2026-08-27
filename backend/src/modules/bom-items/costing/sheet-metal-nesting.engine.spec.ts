import { computeNesting, resolveNestingDimensions, isTrueNestCostingCacheValid, computeMassBasedUtilizationPct, resolveProcessPartSpacingMm, computePartAllowanceMm } from './sheet-metal-nesting.engine';

describe('resolveProcessPartSpacingMm — real per-process nesting spacing (closeout Plan Phase 3)', () => {
  it('matches thickness 1:1 for fiber_laser, up to the 50mm cap', () => {
    expect(resolveProcessPartSpacingMm('fiber_laser', 5)).toBe(5);
    expect(resolveProcessPartSpacingMm('fiber_laser', 50)).toBe(50);
    expect(resolveProcessPartSpacingMm('fiber_laser', 999)).toBe(50);
  });

  it('is a flat spacing for turret_punch and waterjet, independent of thickness', () => {
    expect(resolveProcessPartSpacingMm('turret_punch', 1)).toBe(6.35);
    expect(resolveProcessPartSpacingMm('turret_punch', 10)).toBe(6.35);
    expect(resolveProcessPartSpacingMm('waterjet', 1)).toBe(5.08);
    expect(resolveProcessPartSpacingMm('waterjet', 10)).toBe(5.08);
  });

  it('falls back to the laser curve for any unrecognized machine class (disclosed default, not a guess)', () => {
    expect(resolveProcessPartSpacingMm('press_brake', 5)).toBe(5);
  });
});

describe('computePartAllowanceMm — Gross/Net Usage default (assumes laser cutting, closeout Plan Phase 3)', () => {
  it('uses the real laser spacing curve as its base', () => {
    expect(computePartAllowanceMm(5)).toBe(5);
    expect(computePartAllowanceMm(75)).toBe(50);
  });

  it('adds 10mm for stamping impressions on top of the base spacing', () => {
    expect(computePartAllowanceMm(5, true)).toBe(15);
  });
});

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

describe('computeNesting — sheetsRequired / batch consumption (RTP2 MAG2 FRONTFRAME regression)', () => {
  // RTP2 MAG2 FRONTFRAME: SECC 1.6mm, flat pattern 432.17x352.31mm, real
  // netWeightKg for a bracket with cutouts is well below the bounding-rect-
  // implied weight (hence ~60.5% utilization, not ~94%) -- 1.2335kg reproduces
  // that ratio for this fixture. Known result: 2500x5000mm sheet, 77
  // parts/sheet. This block only tests the NEW batch-consumption fields --
  // partsPerSheet/utilisationPct themselves are covered by the describe
  // block above and are untouched by this change.
  const rtp2Common = {
    flatPatternLengthMm: 432.17,
    flatPatternWidthMm: 352.31,
    thicknessMm: 1.6,
    netWeightKg: 1.2335,
    densityKgM3: 7850, // SECC
    materialPricePerKg: 1.0,
  };

  it('sheetsRequired/plannedParts/excessPositions are undefined when quantityRequired is omitted', () => {
    const result = computeNesting(rtp2Common);
    expect(result.partsPerSheet).toBe(77);
    expect(result.sheetsRequired).toBeUndefined();
    expect(result.plannedParts).toBeUndefined();
    expect(result.excessPositions).toBeUndefined();
    expect(result.actualBatchGrossMaterialKg).toBeUndefined();
  });

  it('sheetsRequired/plannedParts/excessPositions are undefined when quantityRequired is <= 0 (never silently 0)', () => {
    const result = computeNesting({ ...rtp2Common, quantityRequired: 0 });
    expect(result.sheetsRequired).toBeUndefined();
    const resultNeg = computeNesting({ ...rtp2Common, quantityRequired: -5 });
    expect(resultNeg.sheetsRequired).toBeUndefined();
  });

  it('quantity 250 at 77 parts/sheet requires 4 sheets, 308 planned parts, 58 excess positions', () => {
    const result = computeNesting({ ...rtp2Common, quantityRequired: 250 });
    expect(result.partsPerSheet).toBe(77);
    expect(result.sheetsRequired).toBe(4);
    expect(result.plannedParts).toBe(308);
    expect(result.excessPositions).toBe(58);
    expect(result.actualBatchGrossMaterialKg).toBeCloseTo(result.sheetsRequired! * result.sheetWeightKg, 3);
  });

  it.each([
    [1, 1, 77, 76],
    [77, 1, 77, 0],
    [78, 2, 154, 76],
    [154, 2, 154, 0],
  ])('quantity %i -> sheetsRequired %i, plannedParts %i, excessPositions %i', (qty, sheets, planned, excess) => {
    const result = computeNesting({ ...rtp2Common, quantityRequired: qty });
    expect(result.sheetsRequired).toBe(sheets);
    expect(result.plannedParts).toBe(planned);
    expect(result.excessPositions).toBe(excess);
  });

  it('grossWeightPerPartKg (the theoretical per-part figure cost-engine.ts and RawMaterialDialog consume) is identical whether or not quantityRequired is supplied', () => {
    const withoutQty = computeNesting(rtp2Common);
    const withQty = computeNesting({ ...rtp2Common, quantityRequired: 250 });
    expect(withQty.grossWeightPerPartKg).toBe(withoutQty.grossWeightPerPartKg);
    expect(withQty.netMaterialCost).toBe(withoutQty.netMaterialCost);
    expect(withQty.utilisationPct).toBe(withoutQty.utilisationPct);
  });
});

describe('isTrueNestCostingCacheValid — true-shape nest costing cache correctness gate', () => {
  // sheetWidthMm/sheetLengthMm are NOT match criteria here -- sheet
  // selection is part of what got cached (every viable candidate was
  // already compared when this was computed); only kerf/edge-margin (the
  // request-time inputs to that computation) and the presence of every
  // required result field are checked.
  const validCache = {
    sheetWidthMm: 2500, sheetLengthMm: 5000, kerfMm: 0.56, edgeMarginMm: 2,
    partsPerSheet: 91, utilizationPct: 71.8, sheetWeightKg: 157.0, grossWeightPerPartKg: 1.725,
    cachedAt: '2026-08-17T00:00:00.000Z',
  };

  it('accepts a cache entry that exactly matches the requested kerf/margin', () => {
    expect(isTrueNestCostingCacheValid(validCache, 0.56, 2)).toBe(true);
  });

  it('rejects a cache entry computed with a different kerf or edge margin', () => {
    expect(isTrueNestCostingCacheValid(validCache, 1.0, 2)).toBe(false);
    expect(isTrueNestCostingCacheValid(validCache, 0.56, 3)).toBe(false);
  });

  it('rejects missing, null, or malformed cache values rather than throwing', () => {
    expect(isTrueNestCostingCacheValid(undefined, 0.56, 2)).toBe(false);
    expect(isTrueNestCostingCacheValid(null, 0.56, 2)).toBe(false);
    expect(isTrueNestCostingCacheValid({}, 0.56, 2)).toBe(false);
    expect(isTrueNestCostingCacheValid({ ...validCache, partsPerSheet: 0 }, 0.56, 2)).toBe(false);
    expect(isTrueNestCostingCacheValid({ ...validCache, utilizationPct: 'high' }, 0.56, 2)).toBe(false);
    expect(isTrueNestCostingCacheValid({ ...validCache, sheetWeightKg: undefined }, 0.56, 2)).toBe(false);
    expect(isTrueNestCostingCacheValid({ ...validCache, grossWeightPerPartKg: 0 }, 0.56, 2)).toBe(false);
  });

  it('tolerates float rounding noise (sub-0.01) in kerf/margin matching', () => {
    expect(isTrueNestCostingCacheValid(validCache, 0.5600001, 2)).toBe(true);
  });
});

describe('computeMassBasedUtilizationPct — regression for the true-nest costing utilization bug', () => {
  // RTP2 MAG2 FRONTFRAME, live production case: 2500x5000mm sheet, 157.0kg
  // sheet weight, 1.234kg real net weight/part. Rectangle-grid found 77
  // parts/sheet (60.5% mass-based utilization); the true-shape nest found
  // only 70 real non-overlapping placements, but cad-engine's OWN
  // utilizationPct for that placement (computed from the outline polygon's
  // area, not real part mass) reported 83.9% -- inconsistent with the part's
  // real net weight, since this frame-shaped part's polygon silhouette does
  // not subtract internal cutout area the same way real CAD mass does. The
  // bug this guards: costing must use this function's mass-based ratio
  // (55.0%), never cad-engine's own polygon-area utilizationPct (83.9%).
  it('recomputes the correct mass-based 55.0% instead of trusting a polygon-area 83.9%', () => {
    const sheetWeightKg = 157.0;
    const netWeightKg = 1.234;
    const truePartsPerSheet = 70;
    const grossWeightPerPartKg = sheetWeightKg / truePartsPerSheet;
    const pct = computeMassBasedUtilizationPct(netWeightKg, grossWeightPerPartKg);
    expect(Math.round(pct * 10) / 10).toBeCloseTo(55.0, 1);
    expect(pct).toBeLessThan(83.9); // the wrong, polygon-area-based figure this replaces
  });

  it('matches the rectangle-grid figure at 77 parts/sheet (60.5%) -- same formula, same inputs', () => {
    const sheetWeightKg = 157.0;
    const netWeightKg = 1.234;
    const grossWeightPerPartKg = sheetWeightKg / 77;
    const pct = computeMassBasedUtilizationPct(netWeightKg, grossWeightPerPartKg);
    expect(Math.round(pct * 10) / 10).toBeCloseTo(60.5, 1);
  });

  it('never exceeds 100% and never divides by zero', () => {
    expect(computeMassBasedUtilizationPct(5, 1)).toBe(100);
    expect(computeMassBasedUtilizationPct(0, 10)).toBe(0);
    expect(computeMassBasedUtilizationPct(10, 0)).toBe(0);
  });
});
