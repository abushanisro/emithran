import { Injectable, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../../common/supabase/supabase.service';
import {
  LOCATION_INFO,
  LOCATION_MHR_DEFAULTS,
  defaultLHRRate,
} from '../bom-items/costing/default-rates';

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
  currentLocation: string;
  processLinesCount: number;
  locations: LocationCostEntry[];
  cheapestLocation: string;
  mostExpensiveLocation: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ALL_LOCATIONS = [
  'India', 'USA', 'China', 'Germany', 'France',
  'W. Europe', 'E. Europe', 'UK', 'Vietnam', 'Mexico',
] as const;

// USD base: 1 INR = (1/83.5) USD. LOCATION_INFO.defaultInrRate = N INR per 1 local unit.
// USD = local_amount × defaultInrRate / 83.5
const INR_PER_USD = 83.5;

// Representative MachineClass per process_group — used as fallback key into LOCATION_MHR_DEFAULTS
const PROCESS_GROUP_TO_CLASS: Record<string, string> = {
  'Sheet Metal':   'fiber_laser',
  'Plastics':      'injection_molding',
  'CNC Machining': 'cnc_3ax_vmc',
  'Quality':       'cmm',
};

const SGA_PCT    = 0.125;
const PROFIT_PCT = 0.08;

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class LocationComparisonService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async computeLocationComparison(
    bomItemId: string,
    token: string,
  ): Promise<LocationComparisonDto> {
    const db      = this.supabaseService.getClient(token);
    const adminDb = this.supabaseService.getAdminClient();

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

    // 3. Batch-fetch MHR rates for all locations from mhr_records (admin bypasses per-user RLS)
    // Grab the lowest viable rate per (location, process_group) — min picks the standard machine
    const { data: mhrRows } = await adminDb
      .from('mhr_records')
      .select('location, process_group, fully_burdened_local_per_hr, total_machine_hour_rate, manual_mhr_value')
      .in('location', [...ALL_LOCATIONS])
      .in('process_group', processGroups.length ? processGroups : ['Sheet Metal']);

    // 4. Fetch LHR benchmark rates (public SELECT — no admin needed)
    const { data: LhrRows } = await db
      .from('lhr_benchmark_rates')
      .select('location, process_group, lhr, lhr_usd_effective, currency')
      .in('location', [...ALL_LOCATIONS])
      .in('process_group', processGroups.length ? processGroups : ['Sheet Metal']);

    // 5. Build rate maps
    // mhrRateMap[location][processGroup] = { usd, source }
    const mhrRateMap = new Map<string, Map<string, { usd: number; source: 'db' | 'default' }>>();
    const lhrRateMap = new Map<string, Map<string, { usd: number; source: 'db' | 'default' }>>();

    for (const loc of ALL_LOCATIONS) {
      mhrRateMap.set(loc, new Map());
      lhrRateMap.set(loc, new Map());
    }

    // Aggregate MHR from DB: sum and count per (location, process_group) then average
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
      const avgLocal = acc.sumLocal / acc.count;
      const inrRate  = LOCATION_INFO[loc]?.defaultInrRate ?? INR_PER_USD;
      const usd      = avgLocal * inrRate / INR_PER_USD;
      mhrRateMap.get(loc)!.set(pg, { usd, source: 'db' });
    }

    // Fill gaps with static fallback
    for (const loc of ALL_LOCATIONS) {
      const locInfo = LOCATION_INFO[loc];
      if (!locInfo) continue;
      for (const pg of processGroups) {
        if (!mhrRateMap.get(loc)!.has(pg)) {
          const cls    = PROCESS_GROUP_TO_CLASS[pg] ?? 'cnc_3ax_vmc';
          const locDef = (LOCATION_MHR_DEFAULTS as Record<string, Record<string, number>>)[loc];
          const local  = locDef?.[cls] ?? 85;
          const usd    = local * locInfo.defaultInrRate / INR_PER_USD;
          mhrRateMap.get(loc)!.set(pg, { usd, source: 'default' });
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

    // Fill LHR gaps with static fallback (LOCATION_LHR_DEFAULTS already in USD for most locations)
    for (const loc of ALL_LOCATIONS) {
      const locInfo = LOCATION_INFO[loc];
      if (!locInfo) continue;
      for (const pg of processGroups) {
        if (!lhrRateMap.get(loc)!.has(pg)) {
          const localLhr = defaultLHRRate(loc, pg);
          const usd      = localLhr * locInfo.defaultInrRate / INR_PER_USD;
          lhrRateMap.get(loc)!.set(pg, { usd, source: 'default' });
        }
      }
    }

    // 6. Compute cost per location
    const locationEntries: LocationCostEntry[] = [];

    for (const loc of ALL_LOCATIONS) {
      const locInfo = LOCATION_INFO[loc] ?? LOCATION_INFO['USA']!;
      const mhrMap  = mhrRateMap.get(loc)!;
      const lhrMap  = lhrRateMap.get(loc)!;

      let totalMachineUsd = 0;
      let totalLabourUsd  = 0;
      let dbCount         = 0;
      let defaultCount    = 0;
      const lines: LocationProcessLine[] = [];

      for (const row of processRows) {
        const pg          = (row.process_group as string | null) ?? 'Sheet Metal';
        const mhrEntry    = mhrMap.get(pg) ?? { usd: 0, source: 'default' as const };
        const LHREntry    = lhrMap.get(pg) ?? { usd: 0, source: 'default' as const };
        const mhrUsd      = mhrEntry.usd;
        const lhrUsd      = LHREntry.usd;

        const setupManning = parseFloat(row.setup_manning) || 0;
        const setupTimeMin = parseFloat(row.setup_time)    || 0;
        const batchSize    = Math.max(parseFloat(row.batch_size)    || 1, 1);
        const heads        = parseFloat(row.heads)          || 0;
        const cycleTimeSec = parseFloat(row.cycle_time)     || 0;
        const ppc          = Math.max(parseFloat(row.parts_per_cycle) || 1, 1);
        const scrap        = parseFloat(row.scrap)          || 0;

        const setupCostUsd  = (setupTimeMin / 60) * (mhrUsd + lhrUsd * setupManning) / batchSize;
        const cycleCostUsd  = (cycleTimeSec / 3600) * (mhrUsd + lhrUsd * heads) / ppc;
        const totalCostUsd  = (setupCostUsd + cycleCostUsd) * (1 + scrap / 100);

        // Machine vs labour split
        const setupMachine = (setupTimeMin / 60) * mhrUsd / batchSize;
        const cycleMachine = (cycleTimeSec / 3600) * mhrUsd / ppc;
        const setupLabour  = (setupTimeMin / 60) * lhrUsd * setupManning / batchSize;
        const cycleLabour  = (cycleTimeSec / 3600) * lhrUsd * heads / ppc;
        totalMachineUsd += (setupMachine + cycleMachine) * (1 + scrap / 100);
        totalLabourUsd  += (setupLabour  + cycleLabour)  * (1 + scrap / 100);

        if (mhrEntry.source === 'db' || LHREntry.source === 'db') dbCount++;
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

      const processCostUsd   = lines.reduce((s, l) => s + l.totalCostUsd, 0);
      const totalMfgCostUsd  = rawMaterialCostUsd + processCostUsd;
      const sgaCostUsd       = totalMfgCostUsd * SGA_PCT;
      const sellingPriceUsd  = totalMfgCostUsd * (1 + SGA_PCT + PROFIT_PCT);

      // Local-currency process cost (informational only)
      const processCostLocal = processCostUsd / (locInfo.defaultInrRate / INR_PER_USD);

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

    // 7. Sort cheapest → most expensive
    locationEntries.sort((a, b) => a.totalMfgCostUsd - b.totalMfgCostUsd);

    // Use the cheapest location as the anchor for vsCurrentPct comparisons
    const baseUsd = locationEntries[0]?.totalMfgCostUsd ?? 1;
    for (const entry of locationEntries) {
      entry.vsCurrentPct = baseUsd > 0
        ? ((entry.totalMfgCostUsd - baseUsd) / baseUsd) * 100
        : 0;
    }

    return {
      bomItemId,
      currentLocation: 'USA',  // The UI location selector drives context; cheapest is the anchor
      processLinesCount: processRows.length,
      locations: locationEntries,
      cheapestLocation: locationEntries[0]?.location ?? '',
      mostExpensiveLocation: locationEntries[locationEntries.length - 1]?.location ?? '',
    };
  }
}
