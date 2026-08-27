// Mocked unit tests of resolveLHRRates + normalizeCostSummaryToCurrency's
// arithmetic (private methods, exercised via `as any`, hand-built Supabase
// stub — NOT end-to-end, NOT live-data). These prove the ×-once conversion
// logic in isolation: an INR-native lhr_records row must pass through
// unconverted, and a USD-denominated benchmark row must be converted exactly
// once. The FX pivot value used below is an arbitrary fixture for exercising
// that arithmetic — it is not asserted anywhere as a live or historical FX
// truth. The real "editor rate == Cost Summary rate, same DB record" invariant
// is proved separately, against real data and the real live FX rate, in
// test/lhr-currency-provenance.e2e-spec.ts.
import { BOMItemsService } from './bom-items.service';
import { type BlankOptimizerService } from './costing/blank-optimizer.service';
import { type SheetMetalLookupService } from './costing/sheet-metal-lookup.service';
import { type CADAnalysisService } from './services/cad-analysis.service';
import { type ExchangeRateService, type RateSnapshot } from '../../common/exchange-rate/exchange-rate.service';
import { type SupabaseService } from '../../common/supabase/supabase.service';
import { type InspectionKnowledgeService } from '../manufacturing-knowledge/services/inspection-knowledge.service';
import type { CostSummaryDto } from './dto/cost-breakdown.dto';

// Arbitrary fixture for exercising ×-once arithmetic in a mocked unit test —
// not a live or historical FX claim in itself.
const arithmeticFixtureUsdToInr = 83.5;

function makeRates(inrPerUsd: number): RateSnapshot {
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

function makeSupabaseStub(script: Record<string, any[][]>) {
  const callCounts: Record<string, number> = {};
  const chain = (data: any[]) => {
    const node: any = {
      select: () => node, eq: () => node, gt: () => node, not: () => node, in: () => node,
      then: (resolve: (v: { data: any[]; error: null }) => void) => resolve({ data, error: null }),
    };
    return node;
  };
  return {
    getClient: () => ({
      from: (table: string) => {
        const n = (callCounts[table] ?? 0);
        callCounts[table] = n + 1;
        return chain(script[table]?.[n] ?? []);
      },
    }),
  } as unknown as SupabaseService;
}

function buildService(supabaseService: SupabaseService, identities: Record<string, any>) {
  const service = new BOMItemsService(
    supabaseService,
    {} as unknown as InspectionKnowledgeService,
    {} as unknown as BlankOptimizerService,
    {} as unknown as SheetMetalLookupService,
    {} as unknown as ExchangeRateService,
    {} as unknown as CADAnalysisService,
  );
  jest.spyOn(service as any, 'resolveProcessIdentities').mockResolvedValue(identities);
  return service;
}

function minimalCostSummary(labourRate: number): CostSummaryDto {
  return {
    materialCost: 0, materialCostPerKg: 0, totalProcessCost: 0, totalCost: 0,
    sustainability: { wasteCostInr: 0 } as any,
    processLines: [{ process: 'Laser Cut', machineClass: 'fiber_laser', hourlyRate: 1605.5, labourRate, setupCost: 0, runCost: 0, totalCost: 0 } as any],
  } as unknown as CostSummaryDto;
}

describe('resolveLHRRates + normalizeCostSummaryToCurrency arithmetic (mocked unit tests)', () => {
  it('an INR-native lhr_records row passes through with NO FX conversion applied at any stage', async () => {
    const supabaseService = makeSupabaseStub({
      lhr_records: [[{ process_group: 'Sheet Metal', lhr: 144.46 }]],
      lhr_benchmark_rates: [[{ process_group: 'Sheet Metal', lhr_usd_effective: 1.73 }]],
    });
    const service = buildService(supabaseService, {
      fiber_laser: { processGroup: 'Sheet Metal', processRoute: 'Laser Cutting', operation: 'Laser Cut', lhrProcessGroup: 'Sheet Metal' },
    });
    const rates = makeRates(arithmeticFixtureUsdToInr);
    const warnings: string[] = [];

    // Step 1: resolveLHRRates resolves the local-currency row as-is (Pass 1: "no FX needed").
    const lhrRates: Map<string, { rate: number; source: string }> = await (service as any).resolveLHRRates('token-1', 'India', 'sheet_metal', rates, warnings, undefined);
    expect(lhrRates.get('fiber_laser')?.rate).toBe(144.46);
    // P0.6: Pass 1 (real, same-location lhr_records) must tag 'lhr_database' —
    // the provenance visibility the machine-rate side already had via
    // MHRRateInput.source, now mirrored for labor.
    expect(lhrRates.get('fiber_laser')?.source).toBe('lhr_database');
    expect(warnings).toHaveLength(0);

    // Step 2: that exact value flows into the cost summary DTO (mirrors cost-engine.ts's direct passthrough).
    const dto = minimalCostSummary(lhrRates.get('fiber_laser')!.rate);

    // Step 3: factory currency == scenario currency (identity) must leave labourRate untouched.
    const result = (service as any).normalizeCostSummaryToCurrency(dto, rates, 'INR', {
      fxSnapshot: { factoryCurrency: 'INR', scenarioCurrency: 'INR', provider: null, source: 'identity', rate: 1, rateDate: '2026-08-17', rateType: 'reference', retrievedAt: '2026-08-17T00:00:00Z' },
    });

    expect(result.processLines[0].labourRate).toBe(144.46); // NOT re-multiplied by the FX fixture
    expect(result.currency).toBe('INR');
    expect(result.toUsdRate).toBe(1);
  });

  it('a USD-denominated benchmark lhr_benchmark_rates row is converted to local currency EXACTLY ONCE', async () => {
    const supabaseService = makeSupabaseStub({
      lhr_records: [[]], // Pass 1: no real row for this group
      lhr_benchmark_rates: [
        [{ process_group: 'Quality', lhr_usd_effective: 1.65 }], // Pass 2: fills the missing group
        [{ process_group: 'Quality', lhr_usd_effective: 1.65 }], // Pass 4: plausibility reference (re-queried)
      ],
    });
    const service = buildService(supabaseService, {
      cmm: { processGroup: 'Quality', processRoute: 'Inspection', operation: 'Inspect', lhrProcessGroup: 'Quality' },
    });
    const rates = makeRates(arithmeticFixtureUsdToInr);
    const warnings: string[] = [];

    const lhrRates: Map<string, { rate: number; source: string }> = await (service as any).resolveLHRRates('token-1', 'India', 'sheet_metal', rates, warnings, undefined);
    expect(lhrRates.get('cmm')?.rate).toBeCloseTo(1.65 * arithmeticFixtureUsdToInr, 2);
    // P0.6: Pass 2 (lhr_benchmark_rates filling a missing group) must tag 'lhr_benchmark'.
    expect(lhrRates.get('cmm')?.source).toBe('lhr_benchmark');
    expect(warnings).toHaveLength(0); // matches its own benchmark exactly — no warning

    const dto = minimalCostSummary(lhrRates.get('cmm')!.rate);
    const result = (service as any).normalizeCostSummaryToCurrency(dto, rates, 'INR', {
      fxSnapshot: { factoryCurrency: 'INR', scenarioCurrency: 'INR', provider: null, source: 'identity', rate: 1, rateDate: '2026-08-17', rateType: 'reference', retrievedAt: '2026-08-17T00:00:00Z' },
    });
    // Still exactly one conversion end-to-end — identity currency does not add a second one.
    expect(result.processLines[0].labourRate).toBeCloseTo(1.65 * arithmeticFixtureUsdToInr, 2);
    expect(result.processLines[0].labourRate).not.toBeCloseTo(1.65 * arithmeticFixtureUsdToInr * arithmeticFixtureUsdToInr, 2);
  });

  // P0.6: Pass 3 (cross-location lhr_records fallback) must tag 'lhr_cross_location'.
  // NOTE — pre-existing, NOT introduced or fixed by this test/change (out of
  // scope for a provenance-visibility-only pass): Pass 3's USD-effective branch
  // stores the raw lhr_usd_effective average directly into the SAME "local
  // currency" pgRate map Pass 1 uses, with NO usdToLocal conversion applied
  // (unlike Pass 2's benchmark fallback, which does convert). For a non-USD
  // location, this would silently treat a USD number as if it were local
  // currency. Documented here, matched as-is by this test, not fixed — fixing
  // it changes a real cost number, which is explicitly out of scope for this
  // provenance-tagging pass.
  it('Pass 3 (cross-location fallback) tags lhr_cross_location, and documents its existing no-FX-conversion behavior', async () => {
    const supabaseService = makeSupabaseStub({
      lhr_records: [
        [], // Pass 1: no real row for this location/group
        [{ process_group: 'Sheet Metal', lhr_usd_effective: 2.1 }], // Pass 3: a different location's real row
      ],
      lhr_benchmark_rates: [[], []], // Pass 2 (no benchmark) and Pass 4 (plausibility reference, also none)
    });
    const service = buildService(supabaseService, {
      fiber_laser: { processGroup: 'Sheet Metal', processRoute: 'Laser Cutting', operation: 'Laser Cut', lhrProcessGroup: 'Sheet Metal' },
    });
    const rates = makeRates(arithmeticFixtureUsdToInr);
    const warnings: string[] = [];

    const lhrRates: Map<string, { rate: number; source: string }> = await (service as any).resolveLHRRates('token-1', 'India', 'sheet_metal', rates, warnings, undefined);
    expect(lhrRates.get('fiber_laser')?.source).toBe('lhr_cross_location');
    expect(lhrRates.get('fiber_laser')?.rate).toBe(2.1); // raw USD figure, undocumented pre-existing behavior — see note above
  });
});
