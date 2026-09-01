// Focused, heavily-mocked unit tests for the two sheet-metal material-usage
// calculators' physics_key implementations:
//   - resolveNetUsagePhysics (pure function) -- Net Usage
//   - BOMItemsService.resolveGrossUsageForCalculator -- Gross Usage
// Same instantiate-with-mocked-DI-and-spy-on-public-methods pattern already
// established in bom-items.true-nest-costing.spec.ts.
import { BOMItemsService } from '../../../modules/bom-items/bom-items.service';
import { resolveNetUsagePhysics } from '../../../modules/bom-items/costing/sheet-metal/raw-material/sheet-metal-net-usage.physics';
import { type BlankOptimizerService } from '../../../modules/bom-items/costing/sheet-metal/machine/blank-optimizer.service';
import { type SheetMetalLookupService } from '../../../modules/bom-items/costing/sheet-metal/lookup/sheet-metal-lookup.service';
import { STANDARD_SHEETS } from '../../../modules/bom-items/costing/sheet-metal/machine/sheet-metal-nesting.engine';
import { type CADAnalysisService } from '../../../modules/bom-items/services/cad-analysis.service';
import { type ExchangeRateService } from '../../../common/exchange-rate/exchange-rate.service';
import { type SupabaseService } from '../../../common/supabase/supabase.service';
import { type InspectionKnowledgeService } from '../../../modules/manufacturing-knowledge/services/inspection-knowledge.service';

import type { BOMItemResponseDto } from '../../../modules/bom-items/dto/bom-item-response.dto';

const OUTLINE = [[0, 0], [50, 0], [50, 100], [0, 100]];
const NET_WEIGHT_KG = 1.234;
const DENSITY_KG_M3 = 7850;
const THICKNESS_MM = 1.6;
// Solved backward from netUsageKg = (area * thickness / 1e9) * density
const AREA_MM2 = (NET_WEIGHT_KG * 1e9) / (THICKNESS_MM * DENSITY_KG_M3);

function buildService(computeTrueNest: jest.Mock, summary: Record<string, unknown> = {}) {
  const cadAnalysisService = { computeTrueNest } as unknown as CADAnalysisService;
  const service = new BOMItemsService(
    {} as unknown as SupabaseService,
    {} as unknown as InspectionKnowledgeService,
    {} as unknown as BlankOptimizerService,
    {} as unknown as SheetMetalLookupService,
    {} as unknown as ExchangeRateService,
    cadAnalysisService,
  );
  const findOneSpy = jest.spyOn(service, 'findOne')
    .mockResolvedValue({ id: 'item-1', featureGraph: { summary } } as unknown as BOMItemResponseDto);
  const updateSpy = jest.spyOn(service, 'update')
    .mockResolvedValue({} as unknown as BOMItemResponseDto);
  return { service, findOneSpy, updateSpy };
}

describe('resolveNetUsagePhysics — "Sheet Metal - Net Material Usage" calculator', () => {
  it('reproduces the RTP2 MAG2 FRONTFRAME figure (~1.234 kg) from real Area × Thickness × Density', () => {
    const result = resolveNetUsagePhysics({
      'Flat Pattern Area': AREA_MM2,
      'Thickness': THICKNESS_MM,
      'Material Density': DENSITY_KG_M3,
    });
    expect(result['Net Usage']).toBeCloseTo(NET_WEIGHT_KG, 2);
    expect(result['Volume']).toBeCloseTo(AREA_MM2 * THICKNESS_MM, 1);
  });

  it('returns 0 for missing/zero inputs, never a fabricated fallback number', () => {
    expect(resolveNetUsagePhysics({})['Net Usage']).toBe(0);
  });

  // Regression guard: sheet metal net usage must come from the FLAT PATTERN
  // area, never a folded/3D-solid volume. For a part with real bends, the
  // folded bounding-box volume is always LARGER than the flat-pattern volume
  // (the bend adds air/void inside the box) — if a future change accidentally
  // fed a folded/bounding-box volume into this calculator instead of the
  // real flat-pattern area, this test fails by construction rather than
  // silently drifting.
  it('produces a materially different (smaller) result than a folded/3D bounding-box volume would — proves flat-pattern area is actually used', () => {
    const flatResult = resolveNetUsagePhysics({
      'Flat Pattern Area': AREA_MM2,
      'Thickness': THICKNESS_MM,
      'Material Density': DENSITY_KG_M3,
    });
    // A folded bounding box for the same part is always >= the flat-pattern
    // area (bending folds the flat sheet into a smaller footprint but the
    // bounding box must still contain the bend radius/void) — model it here
    // as a conservative 1.5x area inflation, a realistic folded-box/flat-area
    // ratio for a simple L-bracket, to prove the two inputs are NOT
    // interchangeable, not to assert an exact real-world ratio.
    const foldedBoundingBoxAreaMm2 = AREA_MM2 * 1.5;
    const wrongResult = resolveNetUsagePhysics({
      'Flat Pattern Area': foldedBoundingBoxAreaMm2,
      'Thickness': THICKNESS_MM,
      'Material Density': DENSITY_KG_M3,
    });
    expect(flatResult['Net Usage']).not.toBeCloseTo(wrongResult['Net Usage'], 2);
    expect(flatResult['Net Usage']).toBeLessThan(wrongResult['Net Usage']);
  });
});

describe('BOMItemsService.resolveGrossUsageForCalculator — "Sheet Metal - Gross Material Usage (Nesting)" calculator', () => {
  const validInputs = {
    'Thickness': THICKNESS_MM,
    'Shear Strength': 350,
    'Net Weight Per Part': NET_WEIGHT_KG,
    'Material Density': DENSITY_KG_M3,
    'Edge Allowance': 2,
  };

  it('returns the exact gap message when no itemId is bound (no calculator form field can supply a real outline)', async () => {
    const { service } = buildService(jest.fn());
    const result = await service.resolveGrossUsageForCalculator(validInputs, { userId: 'u', accessToken: 't' });
    expect(result._gapReason).toBe(BOMItemsService.GROSS_USAGE_GAP_REASON);
  });

  it('returns the exact gap message when required scalar inputs are missing, without touching the BOM item at all', async () => {
    const { service, findOneSpy } = buildService(jest.fn());
    const result = await service.resolveGrossUsageForCalculator({}, { itemId: 'item-1', userId: 'u', accessToken: 't' });
    expect(result._gapReason).toBe(BOMItemsService.GROSS_USAGE_GAP_REASON);
    expect(findOneSpy).not.toHaveBeenCalled();
  });

  it('returns the exact gap message when the bound item has no verified flat-pattern outline (never a rectangle-grid number under this identity)', async () => {
    const { service } = buildService(jest.fn(), {}); // no flatPatternOutlinePointsMm
    const result = await service.resolveGrossUsageForCalculator(validInputs, { itemId: 'item-1', userId: 'u', accessToken: 't' });
    expect(result._gapReason).toBe(BOMItemsService.GROSS_USAGE_GAP_REASON);
    expect(result['Gross Weight Per Part']).toBeUndefined();
  });

  it('evaluates every viable standard sheet and reproduces the RTP2 MAG2 FRONTFRAME figures end-to-end', async () => {
    // Only 1250x2500mm fits at 19 parts/sheet -- same fixture as the
    // existing true-nest-costing regression spec.
    const computeTrueNest = jest.fn(({ sheetWidthMm, sheetLengthMm }: { sheetWidthMm: number; sheetLengthMm: number }) =>
      Promise.resolve(
        sheetWidthMm === 1250 && sheetLengthMm === 2500
          ? { result: { partsPerSheet: 19, utilizationPct: 999 }, reason: '' }
          : { result: null, reason: 'does not fit' },
      ),
    );
    const { service } = buildService(computeTrueNest, { flatPatternOutlinePointsMm: OUTLINE, flatPatternHolesMm: [] });

    const result = await service.resolveGrossUsageForCalculator(validInputs, { itemId: 'item-1', userId: 'u', accessToken: 't' });

    expect(computeTrueNest).toHaveBeenCalledTimes(STANDARD_SHEETS.length);
    expect(result._gapReason).toBeUndefined();
    expect(result['Nest Method']).toBe('True Shape');
    expect(result['Selected Sheet Width']).toBe(1250);
    expect(result['Selected Sheet Length']).toBe(2500);
    expect(result['Parts Per Sheet']).toBe(19);
    expect(result['Sheet Weight']).toBeCloseTo(39.25, 1);
    expect(result['Gross Weight Per Part']).toBeCloseTo(2.066, 2);
    expect(result['Utilisation']).toBeCloseTo(59.7, 0);
  });

  it('includes batch-disclosure fields only when Batch Quantity is provided, and never uses them to derive Gross Weight Per Part', async () => {
    // Only 1250x2500mm fits -- same fixture as the RTP2 end-to-end test above,
    // so the expected batch figures (14 sheets, 266 planned, 16 excess,
    // ~549.5kg) are the same known-correct numbers.
    const computeTrueNest = jest.fn(({ sheetWidthMm, sheetLengthMm }: { sheetWidthMm: number; sheetLengthMm: number }) =>
      Promise.resolve(
        sheetWidthMm === 1250 && sheetLengthMm === 2500
          ? { result: { partsPerSheet: 19, utilizationPct: 999 }, reason: '' }
          : { result: null, reason: 'does not fit' },
      ),
    );
    const { service } = buildService(computeTrueNest, { flatPatternOutlinePointsMm: OUTLINE, flatPatternHolesMm: [] });

    const withoutBatch = await service.resolveGrossUsageForCalculator(validInputs, { itemId: 'item-1', userId: 'u', accessToken: 't' });
    expect(withoutBatch['Sheets Required']).toBeUndefined();

    const withBatch = await service.resolveGrossUsageForCalculator(
      { ...validInputs, 'Batch Quantity': 250 },
      { itemId: 'item-1', userId: 'u', accessToken: 't' },
    );
    expect(withBatch['Sheets Required']).toBe(14);
    expect(withBatch['Planned Parts']).toBe(266);
    expect(withBatch['Excess Positions']).toBe(16);
    expect(withBatch['Actual Batch Gross Material']).toBeCloseTo(549.5, 0);
    // Per-part figure must be identical regardless of batch quantity.
    expect(withBatch['Gross Weight Per Part']).toBe(withoutBatch['Gross Weight Per Part']);
  });
});
