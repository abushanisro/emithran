import { Injectable } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseService } from '../../../../common/supabase/supabase.service';
import {
  CASTING_LOOKUP_KEYS,
  CASTING_MATERIAL_PROPERTY_KEYS,
  CASTING_REFERENCE_SOURCE_VERSION,
  CASTING_VARIABLE_KEYS,
  resolveCastingMaterial,
  resolveCastingReference,
  type CastingMaterial,
  type CastingReference,
} from './casting-reference';
import type { HpdcMachine } from './hpdc-machine';
import {
  DIE_TOOLING_LOOKUP_KEYS,
  DIE_TOOLING_TEXT_VARIABLE_KEYS,
  DIE_TOOLING_VARIABLE_KEYS,
  TOOL_SHOP_LOOKUP_KEYS,
  resolveDieToolingReference,
  type DieToolingReference,
} from './die-tooling';
import { PLASTIC_REFERENCE_SOURCE_VERSION } from '../plastic-molding/plastic-reference';
import { CORE_LOOKUP_KEYS, CORE_TEXT_VARIABLE_KEYS, CORE_VARIABLE_KEYS, resolveCoreReference, type CoreReference } from './coremaking';
import type { FinishingMachine } from './casting-finishing';

/** HR Rates machine class of the High Pressure Die Casting machines (migration 845). */
export const HPDC_MACHINE_CLASS = 'die_casting_high_pressure_die_casting';
/** raw_materials.material_group of the die-casting alloys (migration 855). */
const DIE_CASTING_MATERIAL_GROUP = 'Die Casting';

/**
 * Loads the staged memory/Die Casting rows the casting engines read and
 * resolves them (casting-reference.ts). Variables and lookups are cached per
 * process (read error not cached); alloys and machines are editable rows and
 * are read on every call.
 */
@Injectable()
export class CastingReferenceService {
  constructor(private readonly supabase: SupabaseService) {}

  private cached: { reference: CastingReference | null; missing: string[] } | null = null;

  async getReference(): Promise<{ reference: CastingReference | null; missing: string[] }> {
    if (this.cached) return this.cached;
    const db = this.supabase.getPrivilegedClient('reference-data: machining_reference_data, public-read');
    const [vars, lookups] = await Promise.all([
      db.from('machining_reference_data').select('key, value')
        .eq('category', 'variable').eq('source_version', CASTING_REFERENCE_SOURCE_VERSION)
        .in('key', [...CASTING_VARIABLE_KEYS]),
      db.from('machining_reference_data').select('key, raw')
        .eq('category', 'lookup_table').eq('source_version', CASTING_REFERENCE_SOURCE_VERSION)
        .in('key', [...CASTING_LOOKUP_KEYS]),
    ]);
    const error = vars.error ?? lookups.error;
    if (error) return { reference: null, missing: [`Die casting reference data (${error.message})`] };
    this.cached = resolveCastingReference({
      variables: vars.data ?? [],
      lookups: Object.fromEntries((lookups.data ?? []).map((r: any) => [r.key, Array.isArray(r.raw?.rows) ? r.raw.rows : undefined])),
    });
    return this.cached;
  }

  private cachedTooling: { reference: DieToolingReference | null; missing: string[] } | null = null;
  private cachedCores: { reference: CoreReference | null; missing: string[] } | null = null;

  /** The sand-core reference (coremaking.ts): memory/Die Casting variables and lookups. */
  async getCoreReference(): Promise<{ reference: CoreReference | null; missing: string[] }> {
    if (this.cachedCores) return this.cachedCores;
    const db = this.supabase.getPrivilegedClient('reference-data: machining_reference_data, public-read');
    const [vars, lookups] = await Promise.all([
      db.from('machining_reference_data').select('key, value')
        .eq('category', 'variable').eq('source_version', CASTING_REFERENCE_SOURCE_VERSION)
        .in('key', [...CORE_VARIABLE_KEYS, ...CORE_TEXT_VARIABLE_KEYS]),
      db.from('machining_reference_data').select('key, raw')
        .eq('category', 'lookup_table').eq('source_version', CASTING_REFERENCE_SOURCE_VERSION)
        .in('key', [...CORE_LOOKUP_KEYS]),
    ]);
    const error = vars.error ?? lookups.error;
    if (error) return { reference: null, missing: [`Core reference data (${error.message})`] };
    this.cachedCores = resolveCoreReference({
      variables: vars.data ?? [],
      lookups: Object.fromEntries((lookups.data ?? []).map((r: any) => [r.key, Array.isArray(r.raw?.rows) ? r.raw.rows : undefined])),
    });
    return this.cachedCores;
  }

  /**
   * The die-tooling reference: memory/Die Casting variables and lookups, plus
   * the Digital Factory USA Default tool shop, which memory keeps under
   * Plastic Modeling/process and the Die Casting processDefaults name as the
   * die-casting tool shop (staged with source_version 2026-Plastic, migration 823).
   */
  async getDieToolingReference(): Promise<{ reference: DieToolingReference | null; missing: string[] }> {
    if (this.cachedTooling) return this.cachedTooling;
    const db = this.supabase.getPrivilegedClient('reference-data: machining_reference_data, public-read');
    const [vars, lookups, shop] = await Promise.all([
      db.from('machining_reference_data').select('key, value')
        .eq('category', 'variable').eq('source_version', CASTING_REFERENCE_SOURCE_VERSION)
        .in('key', [...DIE_TOOLING_VARIABLE_KEYS, ...DIE_TOOLING_TEXT_VARIABLE_KEYS]),
      db.from('machining_reference_data').select('key, raw')
        .eq('category', 'lookup_table').eq('source_version', CASTING_REFERENCE_SOURCE_VERSION)
        .in('key', [...DIE_TOOLING_LOOKUP_KEYS]),
      db.from('machining_reference_data').select('key, raw')
        .eq('category', 'lookup_table').eq('source_version', PLASTIC_REFERENCE_SOURCE_VERSION)
        .in('key', [...TOOL_SHOP_LOOKUP_KEYS]),
    ]);
    const error = vars.error ?? lookups.error ?? shop.error;
    if (error) return { reference: null, missing: [`Die tooling reference data (${error.message})`] };
    const rowsOf = (data: any[] | null) =>
      Object.fromEntries((data ?? []).map((r: any) => [r.key, Array.isArray(r.raw?.rows) ? r.raw.rows : Array.isArray(r.raw) ? r.raw : undefined]));
    this.cachedTooling = resolveDieToolingReference({
      variables: vars.data ?? [],
      lookups: rowsOf(lookups.data),
      toolShop: rowsOf(shop.data),
    });
    return this.cachedTooling;
  }

  /**
   * The die-casting alloy whose name or grade (the memory Name / Source Name)
   * equals the BOM item's material grade, case-insensitively. null when the
   * grade is not a die-casting alloy; the engine then reports it as missing.
   */
  async getMaterial(client: SupabaseClient, grade: string | null): Promise<CastingMaterial | null> {
    const g = (grade ?? '').trim();
    if (!g) return null;
    const { data: rows, error } = await client.from('raw_materials')
      .select('id, name, grade, material_type, density_kg_m3, cost_usa, cut_code')
      .eq('material_group', DIE_CASTING_MATERIAL_GROUP)
      .or(`name.ilike.${escapeIlike(g)},grade.ilike.${escapeIlike(g)}`)
      .limit(2);
    if (error || !rows || rows.length !== 1) return null;
    const row = rows[0] as any;
    const { data: props, error: pErr } = await client.from('raw_material_properties')
      .select('property_key, value_num')
      .eq('raw_material_id', row.id)
      .in('property_key', [...CASTING_MATERIAL_PROPERTY_KEYS]);
    if (pErr) return null;
    const properties: Record<string, number | null> = {};
    for (const p of (props ?? []) as Array<{ property_key: string; value_num: unknown }>) {
      properties[p.property_key] = p.value_num == null ? null : Number(p.value_num);
    }
    return resolveCastingMaterial({ row, properties });
  }

  /** The die-casting machines of one class and location, from their HR Rates rows
   *  (rates in USD): HPDC_MACHINE_CLASS, or the gravity class (gdc-engine.ts). */
  async getDieCastingMachines(client: SupabaseClient, location: string, machineClass: string = HPDC_MACHINE_CLASS): Promise<HpdcMachine[]> {
    const { data, error } = await client.from('mhr_records')
      .select('id, machine_name, mhr_usd_per_hour, usd_labor_rate_per_hr, operators, setup_time_hr, specs')
      .eq('machine_class', machineClass)
      .eq('location', location)
      .order('id');
    if (error) return [];
    const num = (v: unknown) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
    return (data ?? []).map((r: any) => ({
      id: String(r.id),
      name: String(r.machine_name),
      machineRatePerHr: num(r.mhr_usd_per_hour),
      labourRatePerHr: num(r.usd_labor_rate_per_hr),
      operators: num(r.operators),
      setupTimeHr: num(r.setup_time_hr),
      clampingForceKn: num(r.specs?.clamping_force_kn),
      tieBarHorMm: num(r.specs?.tie_bar_distance_hor_mm),
      tieBarVertMm: num(r.specs?.tie_bar_distance_vert_mm),
      maxMoldHeightMm: num(r.specs?.max_mold_height_mm),
      dryCycleTimeS: num(r.specs?.dry_cycle_time_s),
      moldEfficiency: num(r.specs?.mold_efficiency),
    }));
  }
}

/** Any casting machine class of a location, with its rates (USD) and specs. */
export async function readFinishingMachines(client: SupabaseClient, machineClass: string, location: string): Promise<FinishingMachine[]> {
  const { data, error } = await client.from('mhr_records')
    .select('id, machine_name, mhr_usd_per_hour, usd_labor_rate_per_hr, operators, setup_time_hr, specs')
    .eq('machine_class', machineClass).eq('location', location).order('id');
  if (error) return [];
  const n = (v: unknown) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  return (data ?? []).map((r: any) => ({
    id: String(r.id), name: String(r.machine_name),
    machineRatePerHr: n(r.mhr_usd_per_hour), labourRatePerHr: n(r.usd_labor_rate_per_hr),
    operators: n(r.operators), setupTimeHr: n(r.setup_time_hr), specs: (r.specs ?? {}) as Record<string, unknown>,
  }));
}

/** PostgREST or-filter value: escape the ilike wildcards and the filter delimiters. */
function escapeIlike(s: string): string {
  return `"${s.replace(/[\\%_]/g, (c) => `\\${c}`).replace(/"/g, '\\"')}"`;
}
