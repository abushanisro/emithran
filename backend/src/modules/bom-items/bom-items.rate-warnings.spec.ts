// Mocked unit tests (private method exercised via `as any`, hand-built Supabase
// stub — NOT an end-to-end or live-data test) for resolveLHRRates' Pass 4
// plausibility guard. The FX pivot value below is an arbitrary arithmetic
// fixture used only to exercise the guard's comparison/threshold logic — it is
// NOT a claim about any current or historical live FX rate. Separately, the
// "12,062"-shaped lhr_records value is a named reproduction of a real historical
// bug pattern (migration 348's own doc comment: a USD-denominated import
// multiplying an already-local India rate by the FX pivot again) — isolated
// under `historicalDoubleConversionLhr` and used only in tests explicitly about
// not regressing that pattern.
import { BOMItemsService } from './bom-items.service';
import { type BlankOptimizerService } from './costing/blank-optimizer.service';
import { type SheetMetalLookupService } from './costing/sheet-metal-lookup.service';
import { type CADAnalysisService } from './services/cad-analysis.service';
import { type ExchangeRateService, type RateSnapshot } from '../../common/exchange-rate/exchange-rate.service';
import { type SupabaseService } from '../../common/supabase/supabase.service';
import { type InspectionKnowledgeService } from '../manufacturing-knowledge/services/inspection-knowledge.service';
import { DEFAULT_RATE_WARN_THRESHOLDS } from './costing/default-rates';

// Arbitrary fixture for exercising ×-once arithmetic in a mocked unit test —
// not a live or historical FX assertion in itself.
const arithmeticFixtureUsdToInr = 83.5;

function makeRates(inrPerUsd: number): RateSnapshot {
  // Real INR-pivot semantics: convertStrict('USD','INR') = INR-per-1-USD.
  return {
    convertOptional: (from, to) => (from === 'USD' && to === 'INR' ? inrPerUsd : from === to ? 1 : null),
    convertStrict: (from, to) => {
      if (from === to) return 1;
      if (from === 'USD' && to === 'INR') return inrPerUsd;
      throw new Error(`unexpected pair in test: ${from}->${to}`);
    },
    toUsd: (amount, from) => (from === 'USD' ? amount : amount / inrPerUsd),
  };
}

// Chainable Supabase query-builder stub — resolves whatever `data` was
// scripted for a table on its Nth call (resolveLHRRates queries lhr_records
// then lhr_benchmark_rates in a fixed order; each table's Nth call returns
// the Nth scripted dataset for that table).
function makeSupabaseStub(script: Record<string, any[][]>) {
  const callCounts: Record<string, number> = {};
  const chain = (data: any[]) => {
    const node: any = {
      select: () => node,
      eq: () => node,
      gt: () => node,
      not: () => node,
      in: () => node,
      then: (resolve: (v: { data: any[]; error: null }) => void) => resolve({ data, error: null }),
    };
    return node;
  };
  return {
    getClient: () => ({
      from: (table: string) => {
        const n = (callCounts[table] ?? 0);
        callCounts[table] = n + 1;
        const rows = script[table]?.[n] ?? [];
        return chain(rows);
      },
    }),
  } as unknown as SupabaseService;
}

function buildService(supabaseService: SupabaseService) {
  const service = new BOMItemsService(
    supabaseService,
    {} as unknown as InspectionKnowledgeService,
    {} as unknown as BlankOptimizerService,
    {} as unknown as SheetMetalLookupService,
    {} as unknown as ExchangeRateService,
    {} as unknown as CADAnalysisService,
  );
  jest.spyOn(service as any, 'resolveProcessIdentities').mockResolvedValue({
    fiber_laser: { processGroup: 'Sheet Metal', processRoute: 'Laser Cutting', operation: 'Laser Cut', lhrProcessGroup: 'Sheet Metal' },
  });
  return service;
}

describe('resolveLHRRates — Pass 4 plausibility guard (mocked unit tests, arbitrary fixtures)', () => {
  it('flags an lhr_records value reproducing the historical double-conversion pattern against a sane Pass-2/4 benchmark', async () => {
    // Named, isolated reproduction of the historical Combined_All_Countries
    // bug pattern (migration 348) — NOT a live-truth value, used only here.
    const historicalDoubleConversionLhr = 12062;
    const supabaseService = makeSupabaseStub({
      // Pass 1: user-imported lhr_records for India — the stale, inflated row.
      lhr_records: [[{ process_group: 'Sheet Metal', lhr: historicalDoubleConversionLhr }]],
      // Pass 4: lhr_benchmark_rates for the SAME (already-resolved) group —
      // the correct, un-corrupted researched USD figure.
      lhr_benchmark_rates: [[{ process_group: 'Sheet Metal', lhr_usd_effective: 1.73 }]],
    });
    const service = buildService(supabaseService);
    const rates = makeRates(arithmeticFixtureUsdToInr);
    const warnings: string[] = [];

    const result: Map<string, { rate: number; source: string }> = await (service as any).resolveLHRRates(
      'token-1', 'India', 'sheet_metal', rates, warnings, DEFAULT_RATE_WARN_THRESHOLDS,
    );

    // The bad Pass-1 value is still what gets applied to costing (this guard
    // discloses, never silently clamps) — but it must be flagged.
    expect(result.get('fiber_laser')?.rate).toBe(historicalDoubleConversionLhr);
    expect(result.get('fiber_laser')?.source).toBe('lhr_database'); // real (if corrupted) Pass-1 data — provenance is honest even when the value itself is flagged
    expect(warnings.some((w) => /over 3× the India Sheet Metal benchmark/.test(w))).toBe(true);
    expect(warnings.some((w) => w.includes(`₹${historicalDoubleConversionLhr}`))).toBe(true);
  });

  it('does not warn when the resolved rate matches its benchmark', async () => {
    const supabaseService = makeSupabaseStub({
      lhr_records: [[{ process_group: 'Sheet Metal', lhr: 144.46 }]],
      lhr_benchmark_rates: [[{ process_group: 'Sheet Metal', lhr_usd_effective: 1.73 }]],
    });
    const service = buildService(supabaseService);
    const rates = makeRates(arithmeticFixtureUsdToInr);
    const warnings: string[] = [];

    const result: Map<string, { rate: number; source: string }> = await (service as any).resolveLHRRates(
      'token-1', 'India', 'sheet_metal', rates, warnings, DEFAULT_RATE_WARN_THRESHOLDS,
    );

    expect(result.get('fiber_laser')?.rate).toBeCloseTo(144.46, 2);
    expect(result.get('fiber_laser')?.source).toBe('lhr_database');
    expect(warnings).toHaveLength(0);
  });

  it('degrades gracefully (no warning, no throw) when no benchmark row exists for the resolved group', async () => {
    const historicalDoubleConversionLhr = 12062;
    const supabaseService = makeSupabaseStub({
      lhr_records: [[{ process_group: 'Sheet Metal', lhr: historicalDoubleConversionLhr }]],
      lhr_benchmark_rates: [[]], // no benchmark row at all — guard must degrade, not fabricate
    });
    const service = buildService(supabaseService);
    const rates = makeRates(arithmeticFixtureUsdToInr);
    const warnings: string[] = [];

    const result: Map<string, { rate: number; source: string }> = await (service as any).resolveLHRRates(
      'token-1', 'India', 'sheet_metal', rates, warnings, DEFAULT_RATE_WARN_THRESHOLDS,
    );

    expect(result.get('fiber_laser')?.rate).toBe(historicalDoubleConversionLhr);
    expect(result.get('fiber_laser')?.source).toBe('lhr_database');
    expect(warnings).toHaveLength(0);
  });
});
