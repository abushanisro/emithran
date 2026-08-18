// Real, unmocked integration test — boots the REAL SupabaseService and REAL
// ExchangeRateService against the actual dev Supabase project (via `.env`,
// no stubs), and exercises the REAL resolveLHRRates against whatever REAL
// India lhr_records/lhr_benchmark_rates rows exist right now, read-only.
//
// No hardcoded FX rate, benchmark value, process group, or country rate is
// asserted as truth anywhere below. Live data changes (rows get added,
// edited, or removed as the app is used) — hardcoding a specific process
// group name here would make the test rot the moment the data shifts, so
// both cases below discover which group to exercise from the live DB itself,
// then independently recompute the resolver's own aggregation logic (Pass 1's
// per-group average; Pass 2's USD × live-FX conversion) in plain JS and
// compare against the real resolver's output. Every expected value is
// derived at test time from the same live data and the same live FX
// snapshot the running application actually uses.
//
// This is the direct proof of the acceptance invariant: Process Cost Editor
// applied LHR == Cost Summary resolved LHR, for the same DB record, same
// resolver, same currency provenance.
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import * as path from 'path';
import { BOMItemsService } from '../src/modules/bom-items/bom-items.service';
import { SupabaseService } from '../src/common/supabase/supabase.service';
import { ExchangeRateService } from '../src/common/exchange-rate/exchange-rate.service';
import { type BlankOptimizerService } from '../src/modules/bom-items/costing/blank-optimizer.service';
import { type SheetMetalLookupService } from '../src/modules/bom-items/costing/sheet-metal-lookup.service';
import { type CADAnalysisService } from '../src/modules/bom-items/services/cad-analysis.service';
import { type InspectionKnowledgeService } from '../src/modules/manufacturing-knowledge/services/inspection-knowledge.service';

describe('[e2e] LHR currency provenance — real DB, real FX, no mocks', () => {
  let supabaseService: SupabaseService;
  let exchangeRateService: ExchangeRateService;
  let service: BOMItemsService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          envFilePath: path.resolve(__dirname, '../.env'),
        }),
      ],
      providers: [SupabaseService, ExchangeRateService],
    }).compile();

    supabaseService = moduleRef.get(SupabaseService);
    exchangeRateService = moduleRef.get(ExchangeRateService);
    service = new BOMItemsService(
      supabaseService,
      {} as unknown as InspectionKnowledgeService,
      {} as unknown as BlankOptimizerService,
      {} as unknown as SheetMetalLookupService,
      exchangeRateService,
      {} as unknown as CADAnalysisService,
    );
  });

  // Groups by process_group and averages `lhr`, mirroring resolveLHRRates'
  // own Pass 1 aggregation exactly — but computed independently here, from a
  // fresh query, so this test never trusts the resolver's own math.
  function averageByProcessGroup(rows: Array<{ process_group: string | null; lhr: number }>) {
    const sums = new Map<string, { sum: number; count: number }>();
    for (const row of rows) {
      const pg = row.process_group?.trim();
      const rate = Number(row.lhr ?? 0);
      if (!pg || rate <= 0) continue;
      const acc = sums.get(pg) ?? { sum: 0, count: 0 };
      sums.set(pg, { sum: acc.sum + rate, count: acc.count + 1 });
    }
    const averages = new Map<string, number>();
    for (const [pg, { sum, count }] of sums) averages.set(pg, sum / count);
    return averages;
  }

  it('a real India lhr_records process group (whatever exists live) resolves through resolveLHRRates UNCONVERTED — matches the independently-recomputed average exactly', async () => {
    const adminClient = supabaseService.getAdminClient();
    const { data: rows, error } = await adminClient
      .from('lhr_records')
      .select('process_group, lhr, currency_code')
      .eq('location', 'India')
      .gt('lhr', 0);

    if (error || !rows?.length) {
      throw new Error(`This test requires at least one real India lhr_records row in the dev DB: ${error?.message ?? 'none found'}`);
    }

    const nonUsdRows = rows.filter((r: any) => (r.currency_code ?? 'INR') !== 'USD');
    if (!nonUsdRows.length) {
      throw new Error('This test requires at least one INR-native India lhr_records row (all live rows are USD-native).');
    }
    const groupAverages = averageByProcessGroup(nonUsdRows as any[]);

    // Find which machine class(es) this live process group actually bills
    // against — same lookup resolveLHRRates itself uses, called directly
    // (not mocked) so this reflects the real live mapping table too.
    const identities = await (service as any).resolveProcessIdentities(null, undefined, undefined);
    let targetClass: string | undefined;
    let targetGroup: string | undefined;
    for (const [cls, identity] of Object.entries(identities) as Array<[string, any]>) {
      const pg = (identity.lhrProcessGroup ?? identity.processGroup)?.trim();
      if (pg && groupAverages.has(pg)) {
        targetClass = cls;
        targetGroup = pg;
        break;
      }
    }
    if (!targetClass || !targetGroup) {
      throw new Error(
        `No machine class in process_calculator_mappings maps to any live India lhr_records process group (${[...groupAverages.keys()].join(', ')}) — cannot exercise resolveLHRRates against real data.`,
      );
    }

    const rates = await exchangeRateService.getSnapshot(null);
    const lhrRates: Map<string, number> = await (service as any).resolveLHRRates(
      null, 'India', undefined, rates, [], undefined,
    );

    const expectedAverage = groupAverages.get(targetGroup)!;
    // Same real rows, same aggregation, computed independently here — must
    // match the resolver's own Pass 1 output exactly. No FX applied to
    // either side, since this data is already INR-native.
    expect(lhrRates.get(targetClass)).toBeCloseTo(expectedAverage, 2);
  });

  it('a real India lhr_benchmark_rates-only process group (no lhr_records row) converts through the REAL current live FX rate exactly once', async () => {
    const adminClient = supabaseService.getAdminClient();

    const [{ data: userRows }, { data: benchRows, error: benchError }] = await Promise.all([
      adminClient.from('lhr_records').select('process_group, lhr').eq('location', 'India').gt('lhr', 0),
      adminClient.from('lhr_benchmark_rates').select('process_group, lhr_usd_effective').eq('location', 'India').gt('lhr_usd_effective', 0),
    ]);

    if (benchError || !benchRows?.length) {
      throw new Error(`This test requires at least one real India lhr_benchmark_rates row: ${benchError?.message ?? 'none found'}`);
    }

    const groupsWithUserRows = new Set(
      (userRows ?? []).map((r: any) => r.process_group?.trim()).filter(Boolean),
    );
    const benchmarkOnlyRow = (benchRows as any[]).find((r) => {
      const pg = r.process_group?.trim();
      return pg && !groupsWithUserRows.has(pg);
    });
    if (!benchmarkOnlyRow) {
      throw new Error('Every India lhr_benchmark_rates group currently also has an lhr_records row — no benchmark-only group to test Pass 2 against right now.');
    }
    const targetGroup = benchmarkOnlyRow.process_group.trim();

    const identities = await (service as any).resolveProcessIdentities(null, undefined, undefined);
    const targetClassEntry = Object.entries(identities as Record<string, any>).find(
      ([, identity]) => (identity.lhrProcessGroup ?? identity.processGroup)?.trim() === targetGroup,
    );
    if (!targetClassEntry) {
      throw new Error(`No machine class maps to the live benchmark-only group "${targetGroup}" — cannot exercise Pass 2 against real data.`);
    }
    const [targetClass] = targetClassEntry;

    const rates = await exchangeRateService.getSnapshot(null);
    const liveUsdToInr = rates.convertStrict('USD', 'INR'); // the REAL, current rate — never hardcoded

    const lhrRates: Map<string, number> = await (service as any).resolveLHRRates(
      null, 'India', undefined, rates, [], undefined,
    );

    const expected = Number(benchmarkOnlyRow.lhr_usd_effective) * liveUsdToInr;
    expect(lhrRates.get(targetClass)).toBeCloseTo(expected, 2);
    // And explicitly not double-converted (the historical bug pattern).
    expect(lhrRates.get(targetClass)).not.toBeCloseTo(expected * liveUsdToInr, 2);
  });
});
