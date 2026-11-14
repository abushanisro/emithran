import { PROCESS_COMPATIBILITY_KEYS, parseProcessCompatibility, type ProcessCompatibility } from '../process-compatibility';
import { Injectable } from '@nestjs/common';
import type { DbClient } from '../../../../../common/db/postgrest-client';
import { DatabaseService } from '../../../../../common/database/database.service';
import {
  PLASTIC_LOOKUP_KEYS,
  PLASTIC_REFERENCE_SOURCE_VERSION,
  PLASTIC_VARIABLE_KEYS,
  SECONDARY_PROCESS_SOURCE_VERSION,
  SECONDARY_VARIABLE_KEYS,
  resolvePlasticReference,
  canonicalReferenceRows,
  type CanonicalReferenceRows,
  type PlasticReference,
} from '../plastic-reference';

/** The raw_materials row (its Source Name) of the GPPS reference material. */
const GPPS_SOURCE_NAME = 'Generic Polystyrene';
/** Normalized property_key (migration 855) -> the dotted header plastic-reference.ts reads. */
const GPPS_PROPERTY_NAMES: Record<string, string> = {
  physical_properties_density_of_melt_kg_m3: 'physicalProperties.densityOfMeltKgM3',
  thermal_properties_melting_temp_c: 'thermalProperties.meltingTempC',
};

/** A press's own process data, from its HR Rates row (mhr_records). */
interface PressRecord {
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
  constructor(private readonly database: DatabaseService) {}

  private cached: { reference: PlasticReference | null; missing: string[] } | null = null;
  /** The canonical rows each loaded reference was resolved from, by fingerprint: what a saved calculation stores so it can be replayed. */
  private readonly rowsByFingerprint = new Map<string, CanonicalReferenceRows>();

  async getReference(): Promise<{ reference: PlasticReference | null; missing: string[] }> {
    if (this.cached) return this.cached;
    const db = this.database.getPrivilegedClient('reference-data: machining_reference_data, public-read');
    const [vars, secondaryVars, lookups, gpps] = await Promise.all([
      db.from('machining_reference_data').select('key, value')
        .eq('category', 'variable').eq('source_version', PLASTIC_REFERENCE_SOURCE_VERSION)
        .in('key', [...PLASTIC_VARIABLE_KEYS]),
      db.from('machining_reference_data').select('key, value')
        .eq('category', 'variable').eq('source_version', SECONDARY_PROCESS_SOURCE_VERSION)
        .in('key', [...SECONDARY_VARIABLE_KEYS]),
      db.from('machining_reference_data').select('key, raw')
        .eq('category', 'lookup_table').eq('source_version', PLASTIC_REFERENCE_SOURCE_VERSION)
        .in('key', [...PLASTIC_LOOKUP_KEYS]),
      this.loadGpps(db),
    ]);
    const error = vars.error ?? secondaryVars.error ?? lookups.error ?? gpps.error;
    if (error) return { reference: null, missing: [`Plastic reference data (${error.message})`] };
    const rows = {
      variables: [...(vars.data ?? []), ...(secondaryVars.data ?? [])],
      lookups: Object.fromEntries((lookups.data ?? []).map((r: any) => [r.key, Array.isArray(r.raw?.rows) ? r.raw.rows : undefined])),
      gppsMaterial: gpps.data ?? undefined,
    };
    this.cached = resolvePlasticReference(rows);
    if (this.cached.reference) this.rowsByFingerprint.set(this.cached.reference.datasetFingerprint, canonicalReferenceRows(rows));
    return this.cached;
  }

  /**
   * Stores the reference rows a calculation read, once per fingerprint (reference_data_snapshots: content-addressed, never changed), so a saved
   * calculation can be recomputed later from what it recorded. Throws when the rows cannot be stored: a calculation that claims to be reproducible
   * and is not is worse than one that is not saved.
   */
  async persistSnapshot(fingerprint: string): Promise<void> {
    const rows = this.rowsByFingerprint.get(fingerprint);
    if (!rows) throw new Error(`The reference rows for fingerprint ${fingerprint} are not loaded in this process, so they cannot be stored.`);
    const db = this.database.getPrivilegedClient('reference-data: reference_data_snapshots, a content-addressed copy of the public-read reference rows');
    const { error } = await db.from('reference_data_snapshots')
      .upsert({ fingerprint, source_version: PLASTIC_REFERENCE_SOURCE_VERSION, rows }, { onConflict: 'fingerprint', ignoreDuplicates: true });
    if (error) throw new Error(`Could not store the reference rows ${fingerprint}: ${error.message}`);
  }

  /** The stored reference rows of a fingerprint, or null when none were stored. Read as the caller (signed-in users may read the table). */
  async loadSnapshot(client: DbClient, fingerprint: string): Promise<CanonicalReferenceRows | null> {
    const { data, error } = await client.from('reference_data_snapshots').select('rows').eq('fingerprint', fingerprint).maybeSingle();
    if (error) throw new Error(`Could not read the reference rows ${fingerprint}: ${error.message}`);
    return (data?.rows as CanonicalReferenceRows | undefined) ?? null;
  }

  /**
   * The GPPS reference material, read from raw_material_properties (migration
   * 855) and returned under the dotted header names plastic-reference.ts reads,
   * so the resolver is unchanged by the move off the staged JSON row.
   */
  private async loadGpps(db: DbClient): Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }> {
    const { data, error } = await db
      .from('raw_material_properties')
      .select('property_key, value_num, raw_materials!inner(grade)')
      .eq('source_version', PLASTIC_REFERENCE_SOURCE_VERSION)
      .eq('raw_materials.grade', GPPS_SOURCE_NAME)
      .in('property_key', Object.keys(GPPS_PROPERTY_NAMES));
    if (error) return { data: null, error };
    const row: Record<string, unknown> = {};
    for (const r of (data ?? []) as Array<{ property_key: string; value_num: number | null }>) {
      const name = GPPS_PROPERTY_NAMES[r.property_key];
      if (name && r.value_num !== null) row[name] = Number(r.value_num);
    }
    return { data: Object.keys(row).length ? row : null, error: null };
  }

  /** The molding processes the material's dataset flags allow (see process-compatibility.ts); every flag null when the grade has none on file. */
  async getProcessCompatibility(client: DbClient, grade: string | null): Promise<ProcessCompatibility> {
    if (!grade) return parseProcessCompatibility([]);
    const { data, error } = await client
      .from('raw_material_properties')
      .select('property_key, value_text, raw_materials!inner(grade)')
      .eq('raw_materials.grade', grade)
      .in('property_key', PROCESS_COMPATIBILITY_KEYS);
    return parseProcessCompatibility(error ? [] : ((data ?? []) as Array<{ property_key: string; value_text: string | null }>));
  }

  /**
   * The chosen presses' process data, read from their own HR Rates rows by id
   * (so an edit in HR Rates is what the quote uses). Not cached: rows are
   * editable. A read error returns no records, and the engine then reports
   * the press timing as missing.
   */
  async getPressRecords(client: DbClient, mhrIds: string[]): Promise<Map<string, PressRecord>> {
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
