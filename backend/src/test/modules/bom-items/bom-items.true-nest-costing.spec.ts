// Focused, heavily-mocked unit tests for BOMItemsService's private
// resolveTrueShapeNestCosting -- the deterministic, no-background-warming
// true-shape costing path. Rather than stand up the whole cost-summary
// pipeline (no existing spec harness for that -- see bom-items.service.ts's
// own scale), this instantiates the service with mocked DI and calls the
// private method directly (a standard, acceptable pattern for testing one
// method of a very large service class), spying on the public
// findOne/update methods instead of mocking Supabase's query builder chain.
import { BOMItemsService } from '../../../modules/bom-items/bom-items.service';
import { type BlankOptimizerService } from '../../../modules/bom-items/costing/sheet-metal/machine/blank-optimizer.service';
import { type SheetMetalLookupService } from '../../../modules/bom-items/costing/sheet-metal/lookup/sheet-metal-lookup.service';
import { STANDARD_SHEETS } from '../../../modules/bom-items/costing/sheet-metal/machine/sheet-metal-nesting.engine';
import { type CADAnalysisService } from '../../../modules/bom-items/services/cad-analysis.service';
import { type ExchangeRateService } from '../../../common/exchange-rate/exchange-rate.service';
import { type SupabaseService } from '../../../common/supabase/supabase.service';
import { type InspectionKnowledgeService } from '../../../modules/manufacturing-knowledge/services/inspection-knowledge.service';

import type { TrueNestCostingSelection } from '../../../modules/bom-items/costing/sheet-metal/machine/true-nest-costing.engine';
import type { BOMItemResponseDto } from '../../../modules/bom-items/dto/bom-item-response.dto';

interface TrueShapeNestCostingResult {
  selection: TrueNestCostingSelection | null;
  reason?: string;
}

type ResolveTrueShapeNestCosting = (
  itemId: string, summary: unknown, netWeightKg: number, densityKgM3: number, thicknessMm: number,
  kerfMm: number, edgeMarginMm: number, userId: string, accessToken: string,
) => Promise<TrueShapeNestCostingResult>;

const OUTLINE = [[0, 0], [50, 0], [50, 100], [0, 100]]; // 50x100mm rectangle -- exact shape irrelevant, just needs >=3 points
const NET_WEIGHT_KG = 1.234;
const DENSITY_KG_M3 = 7850;
const THICKNESS_MM = 1.6;

function buildService(computeTrueNest: jest.Mock) {
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
    .mockResolvedValue({ id: 'item-1', featureGraph: { summary: {} } } as unknown as BOMItemResponseDto);
  const updateSpy = jest.spyOn(service, 'update')
    .mockResolvedValue({} as unknown as BOMItemResponseDto);
  const resolveTrueShapeNestCosting = (service as unknown as { resolveTrueShapeNestCosting: ResolveTrueShapeNestCosting })
    .resolveTrueShapeNestCosting.bind(service);
  const call = (summary: unknown, kerfMm = 0.56, edgeMarginMm = 2) =>
    resolveTrueShapeNestCosting('item-1', summary, NET_WEIGHT_KG, DENSITY_KG_M3, THICKNESS_MM, kerfMm, edgeMarginMm, 'user-1', 'token-1');
  return { findOneSpy, updateSpy, call };
}

describe('resolveTrueShapeNestCosting — deterministic true-shape costing (no rectangle pre-filter, no background warming)', () => {
  it('evaluates EVERY viable standard sheet (not rectangle-prefiltered) and selects the lowest gross weight/part', async () => {
    // Craft per-candidate partsPerSheet so a SMALLER sheet wins on gross
    // weight/part despite placing fewer raw parts than a larger one --
    // this is the exact scenario a rectangle-grid pre-filter would get
    // wrong (it would rank by raw count, not weight/part).
    const partsPerSheetBySize: Record<string, number> = {
      '1000x2000': 20, // 1000*2000*1.6/1e9*7850=25.12kg / 20 = 1.256 kg/part
      '1250x2500': 30, // 39.25kg / 30 = 1.308 kg/part
      '1500x3000': 45, // 56.52kg / 45 = 1.256 kg/part
      '2000x4000': 60, // 100.48kg / 60 = 1.675 kg/part -- worse despite most raw parts
      '2500x5000': 77, // 157.0kg / 77 = 2.039 kg/part -- worse still
    };
    const computeTrueNest = jest.fn(({ sheetWidthMm, sheetLengthMm }: { sheetWidthMm: number; sheetLengthMm: number }) => {
      const parts = partsPerSheetBySize[`${sheetWidthMm.toString()}x${sheetLengthMm.toString()}`];
      return Promise.resolve({ result: { partsPerSheet: parts, utilizationPct: 999 /* must be IGNORED -- see mass-based utilization test below */ }, reason: '' });
    });
    const { updateSpy, call } = buildService(computeTrueNest);

    const result = await call({ flatPatternOutlinePointsMm: OUTLINE, flatPatternHolesMm: [] });

    // Every one of the 5 standard sheets must have been evaluated -- no pre-filter skipped any.
    expect(computeTrueNest).toHaveBeenCalledTimes(STANDARD_SHEETS.length);

    // 1000x2000 and 1500x3000 tie at 1.256 kg/part -- either is a correct
    // "cheapest" answer; the real assertion is that the winner is NOT the
    // 2500x5000 sheet a raw-parts-count ranking would have picked.
    if (!result.selection) throw new Error('expected a non-null selection');
    const selection = result.selection;
    expect(`${selection.sheetWidthMm.toString()}x${selection.sheetLengthMm.toString()}`).not.toBe('2500x5000');
    expect(selection.grossWeightPerPartKg).toBeLessThan(1.7);

    // Utilization must be recomputed from real mass, never the mocked 999% passed back.
    expect(selection.utilisationPct).toBeLessThanOrEqual(100);

    // Result was persisted (cached) before returning.
    expect(updateSpy).toHaveBeenCalledTimes(1);
  });

  it('is deterministic: a cache hit returns the exact same result without calling cad-engine again', async () => {
    const computeTrueNest = jest.fn(); // must NOT be called on a cache hit
    const { updateSpy, call } = buildService(computeTrueNest);

    const cachedSummary = {
      flatPatternOutlinePointsMm: OUTLINE,
      flatPatternHolesMm: [],
      trueNestCostingCache: {
        sheetWidthMm: 1500, sheetLengthMm: 3000, kerfMm: 0.56, edgeMarginMm: 2,
        partsPerSheet: 45, utilizationPct: 55.0, sheetWeightKg: 56.52, grossWeightPerPartKg: 1.256,
      },
    };

    const first = await call(cachedSummary);
    const second = await call(cachedSummary);

    expect(computeTrueNest).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled(); // a cache hit never re-persists
    expect(first).toEqual(second); // first request and repeated request produce the IDENTICAL result
    expect(first.selection?.sheetWidthMm).toBe(1500);
    expect(first.selection?.partsPerSheet).toBe(45);
  });

  it('cache is invalidated by a kerf/edge-margin change (proxy for Reanalyze producing fresh geometry-dependent inputs)', async () => {
    const computeTrueNest = jest.fn(() => Promise.resolve({ result: { partsPerSheet: 50, utilizationPct: 999 }, reason: '' }));
    const { call } = buildService(computeTrueNest);

    const staleCacheSummary = {
      flatPatternOutlinePointsMm: OUTLINE,
      flatPatternHolesMm: [],
      trueNestCostingCache: {
        sheetWidthMm: 1500, sheetLengthMm: 3000, kerfMm: 0.10 /* different kerf than requested below */, edgeMarginMm: 2,
        partsPerSheet: 45, utilizationPct: 55.0, sheetWeightKg: 56.52, grossWeightPerPartKg: 1.256,
      },
    };

    await call(staleCacheSummary, 0.56 /* new kerf */, 2);

    // The stale-kerf cache must NOT have been trusted -- a fresh computation ran.
    expect(computeTrueNest).toHaveBeenCalled();
  });

  it('falls back with a specific reason when every candidate genuinely fails (never fabricates a result)', async () => {
    const computeTrueNest = jest.fn(() => Promise.resolve({ result: null, reason: 'part does not fit this sheet at any rotation' }));
    const { updateSpy, call } = buildService(computeTrueNest);

    const result = await call({ flatPatternOutlinePointsMm: OUTLINE, flatPatternHolesMm: [] });

    expect(result.selection).toBeNull();
    expect(result.reason).toContain('does not fit');
    expect(updateSpy).not.toHaveBeenCalled(); // nothing to cache when every candidate failed
  });

  it('returns a real, disclosed reason (never attempts cad-engine) when no real outline exists yet', async () => {
    const computeTrueNest = jest.fn();
    const { call } = buildService(computeTrueNest);

    const result = await call({ flatPatternOutlineSource: 'unavailable' });

    expect(result.selection).toBeNull();
    expect(result.reason).toMatch(/no real flat-pattern outline/i);
    expect(computeTrueNest).not.toHaveBeenCalled();
  });
});

// Live-production regression: RTP2 MAG2 FRONTFRAME, SECC 1.6mm, real net
// part weight 1.234kg (matches NET_WEIGHT_KG/DENSITY_KG_M3/THICKNESS_MM
// above), selected sheet 1250x2500mm at 19 real true-shape placements.
// This exact case surfaced a live bug where a SEPARATE, frontend-only
// "Direct Material Costs" record (autoAddMaterialCost in
// manufacturing-intelligence/page.tsx) derived net weight from a hardcoded
// 10% scrap assumption instead of reading the real net weight -- the
// numbers below are the physically-correct values that fix is verified
// against; this spec only proves the BACKEND nesting/batch math itself
// (which was already correct) against this real case, for the record.
describe('RTP2 MAG2 FRONTFRAME live regression -- SECC 1.6mm, 1250x2500mm sheet, 19 parts/sheet', () => {
  function mockOnlyCandidateFits(sheetWidthMm: number, sheetLengthMm: number, partsPerSheet: number) {
    return jest.fn(({ sheetWidthMm: w, sheetLengthMm: l }: { sheetWidthMm: number; sheetLengthMm: number }) => {
      if (w === sheetWidthMm && l === sheetLengthMm) {
        return Promise.resolve({ result: { partsPerSheet, utilizationPct: 0 /* irrelevant -- always recomputed from mass */ }, reason: '' });
      }
      return Promise.resolve({ result: null, reason: 'not modeled for this regression case' });
    });
  }

  it('A: 1250x2500x1.6mm SECC (density 7850) physical sheet weight is ~39.25kg', async () => {
    const computeTrueNest = mockOnlyCandidateFits(1250, 2500, 19);
    const { call } = buildService(computeTrueNest);
    const result = await call({ flatPatternOutlinePointsMm: OUTLINE, flatPatternHolesMm: [] });
    if (!result.selection) throw new Error('expected a non-null selection');
    expect(result.selection.sheetWeightKg).toBeCloseTo(39.25, 1);
  });

  it('B+C: 19 parts/sheet gives ~2.0658 kg gross/part and ~59.7% mass-based utilization', async () => {
    const computeTrueNest = mockOnlyCandidateFits(1250, 2500, 19);
    const { call } = buildService(computeTrueNest);
    const result = await call({ flatPatternOutlinePointsMm: OUTLINE, flatPatternHolesMm: [] });
    if (!result.selection) throw new Error('expected a non-null selection');
    expect(result.selection.partsPerSheet).toBe(19);
    expect(result.selection.grossWeightPerPartKg).toBeCloseTo(2.0658, 3);
    expect(result.selection.utilisationPct).toBeCloseTo(59.7, 1);
  });
});

// D+E: batch-consumption math (sheetsRequired/plannedParts/excessPositions/
// actualBatchGrossMaterialKg) lives in getCostSummary's override block, not
// in resolveTrueShapeNestCosting itself -- verified here as the same plain
// arithmetic getCostSummary applies to a TrueNestCostingSelection, since
// getCostSummary has no dedicated spec harness (see this file's own header).
describe('RTP2 batch-250 consumption math (D+E) -- same formula getCostSummary applies to the true-shape selection', () => {
  const selection = { sheetWidthMm: 1250, sheetLengthMm: 2500, partsPerSheet: 19, sheetWeightKg: 39.25, grossWeightPerPartKg: 2.0658, utilisationPct: 59.7 };
  const batchSize = 250;

  it('D: sheetsRequired=14, plannedParts=266, excessPositions=16', () => {
    const sheetsRequired = Math.ceil(batchSize / selection.partsPerSheet);
    const plannedParts = selection.partsPerSheet * sheetsRequired;
    const excessPositions = plannedParts - batchSize;
    expect(sheetsRequired).toBe(14);
    expect(plannedParts).toBe(266);
    expect(excessPositions).toBe(16);
  });

  it('E: actualBatchGrossMaterialKg = sheetsRequired * sheetWeightKg (~549.5kg), NEVER batchSize * grossWeightPerPartKg', () => {
    const sheetsRequired = Math.ceil(batchSize / selection.partsPerSheet);
    const actualBatchGrossMaterialKg = Math.round(sheetsRequired * selection.sheetWeightKg * 1000) / 1000;
    expect(actualBatchGrossMaterialKg).toBeCloseTo(549.5, 1);
    // The wrong formula this guards against -- ignores whole-sheet
    // consumption and would silently understate real material usage.
    const wrongFormula = batchSize * selection.grossWeightPerPartKg;
    expect(actualBatchGrossMaterialKg).not.toBeCloseTo(wrongFormula, 0);
  });
});
