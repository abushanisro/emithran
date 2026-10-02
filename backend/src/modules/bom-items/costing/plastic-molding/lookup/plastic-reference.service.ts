import { Injectable } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseService } from '../../../../../common/supabase/supabase.service';
import {
  GPPS_REFERENCE_MATERIAL,
  PLASTIC_LOOKUP_KEYS,
  PLASTIC_REFERENCE_SOURCE_VERSION,
  PLASTIC_VARIABLE_KEYS,
  resolvePlasticReference,
  type PlasticReference,
} from '../plastic-reference';

/** A press's own process data, from its HR Rates row (mhr_records). */
export interface PressRecord {
  /** specs.injection_rate_mm3_per_s (migration 832): melt volume the press injects per second. */
  injectionRateMm3PerS: number | null;
  /** press_cycle_time_s (migration 633): Euromap 6 dry cycle, mold open + close. */
  dryCycleTimeS: number | null;
  /** good_part_yield (migration 633): share of shots that are good parts. */
  goodPartYield: number | null;
}

/**
 * Loads the staged memory/Plastic Modeling rows the injection-molding engines
 * read (machining_reference_data, source_version 2026-Plastic, migration 823)
 * and resolves them (plastic-reference.ts). The staged base is cached per
 * process; a read error is not cached, so the next request reads again.
 */
@Injectable()
export class PlasticReferenceService {
  constructor(private readonly supabase: SupabaseService) {}

  private cached: { reference: PlasticReference | null; missing: string[] } | null = null;

  async getReference(): Promise<{ reference: PlasticReference | null; missing: string[] }> {
    if (this.cached) return this.cached;
    const db = this.supabase.getPrivilegedClient('reference-data: machining_reference_data, public-read');
    const [vars, lookups, gpps] = await Promise.all([
      db.from('machining_reference_data').select('key, value')
        .eq('category', 'variable').eq('source_version', PLASTIC_REFERENCE_SOURCE_VERSION)
        .in('key', [...PLASTIC_VARIABLE_KEYS]),
      db.from('machining_reference_data').select('key, raw')
        .eq('category', 'lookup_table').eq('source_version', PLASTIC_REFERENCE_SOURCE_VERSION)
        .in('key', [...PLASTIC_LOOKUP_KEYS]),
      db.from('machining_reference_data').select('raw')
        .eq('category', 'material').eq('source_version', PLASTIC_REFERENCE_SOURCE_VERSION)
        .eq('key', GPPS_REFERENCE_MATERIAL).maybeSingle(),
    ]);
    const error = vars.error ?? lookups.error ?? gpps.error;
    if (error) return { reference: null, missing: [`Plastic reference data (${error.message})`] };
    this.cached = resolvePlasticReference({
      variables: vars.data ?? [],
      lookups: Object.fromEntries((lookups.data ?? []).map((r: any) => [r.key, Array.isArray(r.raw?.rows) ? r.raw.rows : undefined])),
      gppsMaterial: (gpps.data as any)?.raw ?? undefined,
    });
    return this.cached;
  }

  /**
   * The chosen presses' process data, read from their own HR Rates rows by id
   * (so an edit in HR Rates is what the quote uses). Not cached: rows are
   * editable. A read error returns no records, and the engine then reports
   * the press timing as missing.
   */
  async getPressRecords(client: SupabaseClient, mhrIds: string[]): Promise<Map<string, PressRecord>> {
    const ids = [...new Set(mhrIds.filter(Boolean))];
    if (ids.length === 0) return new Map();
    const { data, error } = await client.from('mhr_records').select('id, press_cycle_time_s, good_part_yield, specs').in('id', ids);
    if (error) return new Map();
    const num = (v: unknown) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
    return new Map((data ?? []).map((r: any) => [String(r.id), {
      injectionRateMm3PerS: num(r.specs?.injection_rate_mm3_per_s),
      dryCycleTimeS: num(r.press_cycle_time_s),
      goodPartYield: num(r.good_part_yield),
    }]));
  }
}
