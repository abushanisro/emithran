import { Injectable, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { ExchangeRateService } from '../../common/exchange-rate/exchange-rate.service';
import {
  LOCATION_INFO,
} from '../bom-items/costing/shared/core/default-rates.constants';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LocationProcessLine {
  operation: string;
  processGroup: string;
  mhrUsd: number;
  lhrUsd: number;
  setupCostUsd: number;
  cycleCostUsd: number;
  totalCostUsd: number;
}

export interface LocationCostEntry {
  location: string;
  currency: string;
  currencySymbol: string;
  avgMhrUsd: number;
  avgLhrUsd: number;
  machineCostUsd: number;
  labourCostUsd: number;
  processCostUsd: number;
  processCostLocal: number;
  rawMaterialCostUsd: number;
  totalMfgCostUsd: number;
  sgaCostUsd: number;
  sellingPriceUsd: number;
  vsCurrentPct: number;
  ratesSource: 'db' | 'default' | 'mixed';
  processLines: LocationProcessLine[];
}

export interface LocationComparisonDto {
  bomItemId: string;
  processLinesCount: number;
  locations: LocationCostEntry[];
  cheapestLocation: string;
  mostExpensiveLocation: string;
  warnings: string[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ALL_LOCATIONS = [
  'India', 'USA', 'China', 'Germany', 'France',
  'W. Europe', 'E. Europe', 'UK', 'Vietnam', 'Mexico',
] as const;

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class LocationComparisonService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly exchangeRateService: ExchangeRateService,
  ) {}

  async computeLocationComparison(
    bomItemId: string,
    token: string,
  ): Promise<LocationComparisonDto> {
    const db      = this.supabaseService.getClient(token);
    const adminDb = this.supabaseService.getAdminClient();
    const serviceWarnings: string[] = [];

    // 0. Load exchange rates (one snapshot for this whole comparison — every
    // location below converts through the exact same rates) and costing
    // settings. ExchangeRateService is the single FX source of truth for the
    // whole app — throws if exchange_rates has no active rates, rather than
    // silently comparing locations at a stale/guessed rate.
    const [rates, settingsResult] = await Promise.all([
      this.exchangeRateService.getSnapshot(token),
      adminDb
        .from('costing_settings')
        .select('key, value'),
    ]);

    // Load SGA and profit from costing_settings table
    const settingsMap = new Map<string, number>();
    for (const s of settingsResult.data ?? []) settingsMap.set(s.key as string, Number(s.value));

    const sgaPct = settingsMap.has('sga_pct') ? settingsMap.get('sga_pct')! : null;
    const profitPct = settingsMap.has('profit_pct') ? settingsMap.get('profit_pct')! : null;

    if (sgaPct == null) {
      serviceWarnings.push(
        'sga_pct not found in costing_settings — SG&A excluded from selling price; deploy migration 364 and set the row',
      );
    }
    if (profitPct == null) {
      serviceWarnings.push(
        'profit_pct not found in costing_settings — profit margin excluded from selling price; deploy migration 364 and set the row',
      );
    }

    // 1. Fetch active process cost records for this BOM item
    const { data: processRows, error: pcErr } = await db
      .from('process_cost_records')
      .select('op_nbr, operation, process_group, setup_manning, setup_time, batch_size, heads, cycle_time, parts_per_cycle, scrap')
      .eq('bom_item_id', bomItemId)
      .eq('is_active', true)
      .order('op_nbr', { ascending: true });

    if (pcErr) throw new BadRequestException(`Failed to fetch process records: ${pcErr.message}`);
    if (!processRows?.length) {
      throw new BadRequestException('No route applied to this part — apply a route from Process Planning first');
    }

    // 2. Fetch raw material cost (same for all locations)
    const { data: rmRows } = await db
      .from('raw_material_cost_records')
      .select('gross_usage, unit_cost, overhead')
      .eq('bom_item_id', bomItemId)
      .eq('is_active', true);

    const rawMaterialCostUsd = (rmRows ?? []).reduce((sum, r) => {
      return sum + (parseFloat(r.gross_usage) || 0) * (parseFloat(r.unit_cost) || 0) * (1 + (parseFloat(r.overhead) || 0) / 100);
    }, 0);

    // Unique process groups present in this part's route
    const processGroups = [...new Set(
      processRows.map(r => r.process_group as string | null).filter((g): g is string => !!g),
    )];

    if (!processGroups.length) {
      serviceWarnings.push(
        'No process_group set on any route operation — MHR/LHR rates cannot be matched; set process_group on each operation row',
      );
    }

    // 3. Batch-fetch MHR rates for all locations from mhr_records (admin bypasses per-user RLS)
    const mhrQuery = adminDb
      .from('mhr_records')
      .select('location, process_group, fully_burdened_local_per_hr, total_machine_hour_rate, manual_mhr_value')
      .in('location', [...ALL_LOCATIONS]);

    if (processGroups.length) mhrQuery.in('process_group', processGroups);

    const { data: mhrRows } = await mhrQuery;

    // 4. Fetch LHR benchmark rates
    const lhrQuery = db
      .from('lhr_benchmark_rates')
      .select('location, process_group, lhr, lhr_usd_effective, currency')
      .in('location', [...ALL_LOCATIONS]);

    if (processGroups.length) lhrQuery.in('process_group', processGroups);

    const { data: LhrRows } = await lhrQuery;

    // 5. Build rate maps
    const mhrRateMap = new Map<string, Map<string, { usd: number; source: 'db' | 'default' }>>();
    const lhrRateMap = new Map<string, Map<string, { usd: number; source: 'db' | 'default' }>>();

    for (const loc of ALL_LOCATIONS) {
      mhrRateMap.set(loc, new Map());
      lhrRateMap.set(loc, new Map());
    }

    // Aggregate MHR from DB: average per (location, process_group)
    const mhrAccum = new Map<string, { sumLocal: number; count: number }>();
    for (const row of mhrRows ?? []) {
      if (!row.location || !row.process_group) continue;
      const key = `${row.location}||${row.process_group}`;
      const rate = Math.max(
        parseFloat(row.fully_burdened_local_per_hr) || 0,
        parseFloat(row.total_machine_hour_rate)      || 0,
        parseFloat(row.manual_mhr_value)             || 0,
      );
      if (rate <= 0) continue;
      const acc = mhrAccum.get(key) ?? { sumLocal: 0, count: 0 };
      acc.sumLocal += rate;
      acc.count++;
      mhrAccum.set(key, acc);
    }

    for (const [key, acc] of mhrAccum) {
      const [loc, pg] = key.split('||');
      const avgLocal  = acc.sumLocal / acc.count;
      const currCode  = LOCATION_INFO[loc]?.code;
      const usd = currCode ? rates.toUsd(avgLocal, currCode) : avgLocal;
      mhrRateMap.get(loc)?.set(pg, { usd, source: 'db' });
    }

    // Fill MHR gaps — zero surfaces in comparison table rather than a wrong static rate
    for (const loc of ALL_LOCATIONS) {
      if (!LOCATION_INFO[loc]) continue;
      for (const pg of processGroups) {
        if (!mhrRateMap.get(loc)!.has(pg)) {
          mhrRateMap.get(loc)!.set(pg, { usd: 0, source: 'default' });
        }
      }
    }

    // Populate LHR from lhr_benchmark_rates
    for (const row of LhrRows ?? []) {
      if (!row.location || !row.process_group) continue;
      const usd = parseFloat(row.lhr_usd_effective) || 0;
      if (usd > 0) {
        lhrRateMap.get(row.location)?.set(row.process_group, { usd, source: 'db' });
      }
    }

    // Fill LHR gaps
    for (const loc of ALL_LOCATIONS) {
      if (!LOCATION_INFO[loc]) continue;
      for (const pg of processGroups) {
        if (!lhrRateMap.get(loc)!.has(pg)) {
          lhrRateMap.get(loc)!.set(pg, { usd: 0, source: 'default' });
        }
      }
    }

    // 6. Compute cost per location
    const locationEntries: LocationCostEntry[] = [];

    for (const loc of ALL_LOCATIONS) {
      const locInfo = LOCATION_INFO[loc];
      if (!locInfo) continue;

      const mhrMap = mhrRateMap.get(loc)!;
      const lhrMap = lhrRateMap.get(loc)!;

      let totalMachineUsd = 0;
      let totalLabourUsd  = 0;
      let dbCount         = 0;
      let defaultCount    = 0;
      const lines: LocationProcessLine[] = [];

      for (const row of processRows) {
        const pg       = (row.process_group as string | null) ?? '';
        const mhrEntry = mhrMap.get(pg) ?? { usd: 0, source: 'default' as const };
        const lhrEntry = lhrMap.get(pg) ?? { usd: 0, source: 'default' as const };
        const mhrUsd   = mhrEntry.usd;
        const lhrUsd   = lhrEntry.usd;

        const setupManning = parseFloat(row.setup_manning) || 0;
        const setupTimeMin = parseFloat(row.setup_time)    || 0;
        const batchSize    = Math.max(parseFloat(row.batch_size) || 1, 1);
        const heads        = parseFloat(row.heads)         || 0;
        const cycleTimeSec = parseFloat(row.cycle_time)    || 0;
        const ppc          = Math.max(parseFloat(row.parts_per_cycle) || 1, 1);
        const scrap        = parseFloat(row.scrap)         || 0;

        const setupCostUsd = (setupTimeMin / 60) * (mhrUsd + lhrUsd * setupManning) / batchSize;
        const cycleCostUsd = (cycleTimeSec / 3600) * (mhrUsd + lhrUsd * heads) / ppc;
        const totalCostUsd = (setupCostUsd + cycleCostUsd) * (1 + scrap / 100);

        const setupMachine = (setupTimeMin / 60) * mhrUsd / batchSize;
        const cycleMachine = (cycleTimeSec / 3600) * mhrUsd / ppc;
        const setupLabour  = (setupTimeMin / 60) * lhrUsd * setupManning / batchSize;
        const cycleLabour  = (cycleTimeSec / 3600) * lhrUsd * heads / ppc;
        totalMachineUsd += (setupMachine + cycleMachine) * (1 + scrap / 100);
        totalLabourUsd  += (setupLabour  + cycleLabour)  * (1 + scrap / 100);

        if (mhrEntry.source === 'db' || lhrEntry.source === 'db') dbCount++;
        else defaultCount++;

        lines.push({
          operation:    String(row.operation ?? '—'),
          processGroup: pg,
          mhrUsd,
          lhrUsd,
          setupCostUsd,
          cycleCostUsd,
          totalCostUsd,
        });
      }

      const processCostUsd  = lines.reduce((s, l) => s + l.totalCostUsd, 0);
      const totalMfgCostUsd = rawMaterialCostUsd + processCostUsd;
      const sgaCostUsd      = sgaPct != null ? totalMfgCostUsd * sgaPct : 0;
      const sellingPriceUsd = totalMfgCostUsd * (1 + (sgaPct ?? 0) + (profitPct ?? 0));

      // Local-currency process cost
      const processCostLocal = processCostUsd * rates.convertStrict('USD', locInfo.code);

      const avgMhrUsd = lines.length ? lines.reduce((s, l) => s + l.mhrUsd, 0) / lines.length : 0;
      const avgLhrUsd = lines.length ? lines.reduce((s, l) => s + l.lhrUsd, 0) / lines.length : 0;

      const ratesSource: 'db' | 'default' | 'mixed' =
        dbCount > 0 && defaultCount > 0 ? 'mixed' :
        dbCount > 0 ? 'db' : 'default';

      locationEntries.push({
        location: loc,
        currency: locInfo.code,
        currencySymbol: locInfo.symbol,
        avgMhrUsd,
        avgLhrUsd,
        machineCostUsd: totalMachineUsd,
        labourCostUsd:  totalLabourUsd,
        processCostUsd,
        processCostLocal,
        rawMaterialCostUsd,
        totalMfgCostUsd,
        sgaCostUsd,
        sellingPriceUsd,
        vsCurrentPct: 0, // computed after sorting
        ratesSource,
        processLines: lines,
      });
    }

    // 7. Sort cheapest → most expensive and compute relative percentages
    locationEntries.sort((a, b) => a.totalMfgCostUsd - b.totalMfgCostUsd);
    const baseUsd = locationEntries[0]?.totalMfgCostUsd ?? 1;
    for (const entry of locationEntries) {
      entry.vsCurrentPct = baseUsd > 0 ? ((entry.totalMfgCostUsd - baseUsd) / baseUsd) * 100 : 0;
    }

    return {
      bomItemId,
      processLinesCount: processRows.length,
      locations: locationEntries,
      cheapestLocation:     locationEntries[0]?.location ?? '',
      mostExpensiveLocation: locationEntries[locationEntries.length - 1]?.location ?? '',
      warnings: serviceWarnings,
    };
  }
}
