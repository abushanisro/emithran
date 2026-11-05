import { Injectable } from '@nestjs/common';

import {
  FORGING_LOOKUP_KEYS,
  FORGING_MATERIAL_PROPERTY_KEYS,
  FORGING_REFERENCE_SOURCE_VERSION,
  FORGING_SWITCH_KEYS,
  FORGING_VARIABLE_KEYS,
  resolveForgingMaterial,
  resolveForgingReference,
  type ForgingMaterial,
  type ForgingReference,
} from './forging-reference';
import { DatabaseService } from '../../../../common/database/database.service';
import { escapeLikePattern, quoteFilterValue } from '../../../../common/db/postgrest-filter';

import type { ForgingMachine } from './forging-line';
import type { DbClient } from '../../../../common/db/postgrest-client';

interface StagedLookupRow { key: string; raw: { rows?: unknown } | null }
interface MaterialRow { id: string; name?: unknown; material_type?: unknown; density_kg_m3?: unknown; cost_usa?: unknown; cut_code?: unknown }
interface PropertyRow { property_key: string; value_num: unknown }
interface MachineRow {
  id: string | number; machine_name: string; mhr_usd_per_hour: unknown; usd_labor_rate_per_hr: unknown;
  operators: unknown; setup_time_hr: unknown; specs: Record<string, unknown> | null;
}

/** raw_materials.material_group of the forging materials (migration 855). */
const FORGING_MATERIAL_GROUP = 'Forging';

/**
 * Loads the staged memory/Forging rows the closed-die engine reads and hands
 * them to the pure resolvers (forging-reference.ts). Variables and lookups are
 * cached once read (a failed or incomplete read is not cached); materials and
 * machines are editable rows and are read on every call.
 */
@Injectable()
export class ForgingReferenceService {
  constructor(private readonly database: DatabaseService) {}

  /** The staged reference tables are public-read data with no user context: one place opens that client. */
  private get referenceDb() {
    return this.database.getPrivilegedClient('reference-data: machining_reference_data, public-read');
  }

  private cached: { reference: ForgingReference | null; missing: string[] } | null = null;

  async getReference(): Promise<{ reference: ForgingReference | null; missing: string[] }> {
    if (this.cached) return this.cached;
    const db = this.referenceDb;
    const [vars, lookups] = await Promise.all([
      db.from('machining_reference_data').select('key, value')
        .eq('category', 'variable').eq('source_version', FORGING_REFERENCE_SOURCE_VERSION)
        .in('key', [...FORGING_VARIABLE_KEYS, ...FORGING_SWITCH_KEYS]),
      db.from('machining_reference_data').select('key, raw')
        .eq('category', 'lookup_table').eq('source_version', FORGING_REFERENCE_SOURCE_VERSION)
        .in('key', [...FORGING_LOOKUP_KEYS]),
    ]);
    const error = vars.error ?? lookups.error;
    if (error) return { reference: null, missing: [`Forging reference data (${error.message})`] };
    const resolved = resolveForgingReference({
      variables: vars.data ?? [],
      lookups: Object.fromEntries(
        ((lookups.data ?? []) as StagedLookupRow[]).map((r) => [r.key, Array.isArray(r.raw?.rows) ? (r.raw.rows as Record<string, unknown>[]) : undefined]),
      ),
    });
    if (resolved.reference) this.cached = resolved;
    return resolved;
  }

  /**
   * The Forging material whose name or grade equals the BOM item's material
   * grade, case-insensitively. null when the grade is not a forging material
   * (or matches more than one); the engine then reports it as missing.
   */
  async getMaterial(client: DbClient, grade: string | null): Promise<ForgingMaterial | null> {
    const g = (grade ?? '').trim();
    if (!g) return null;
    const { data: rows, error } = await client.from('raw_materials')
      .select('id, name, grade, material_type, density_kg_m3, cost_usa, cut_code')
      .eq('material_group', FORGING_MATERIAL_GROUP)
      .or(`name.ilike.${quoteFilterValue(escapeLikePattern(g))},grade.ilike.${quoteFilterValue(escapeLikePattern(g))}`)
      .limit(2);
    if (error || rows.length !== 1) return null;
    const row = rows[0] as MaterialRow;
    const { data: props, error: pErr } = await client.from('raw_material_properties')
      .select('property_key, value_num')
      .eq('raw_material_id', row.id)
      .in('property_key', [...FORGING_MATERIAL_PROPERTY_KEYS]);
    if (pErr) return null;
    const properties: Record<string, number | null> = {};
    for (const p of props as PropertyRow[]) {
      properties[p.property_key] = p.value_num == null ? null : Number(p.value_num);
    }
    return resolveForgingMaterial({ row, properties });
  }

  /** The forging machines of one HR Rates class (FORGING_STEPS[*].machineClass) and location, rates in USD. */
  async getForgingMachines(client: DbClient, machineClass: string, location: string): Promise<ForgingMachine[]> {
    const { data, error } = await client.from('mhr_records')
      .select('id, machine_name, mhr_usd_per_hour, usd_labor_rate_per_hr, operators, setup_time_hr, specs')
      .eq('machine_class', machineClass)
      .eq('location', location)
      .order('id');
    if (error) return [];
    const num = (v: unknown) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
    return (data as MachineRow[]).map((r) => ({
      id: String(r.id),
      name: r.machine_name,
      machineClass,
      machineRatePerHr: num(r.mhr_usd_per_hour),
      labourRatePerHr: num(r.usd_labor_rate_per_hr),
      operators: num(r.operators),
      setupTimeHr: num(r.setup_time_hr),
      specs: r.specs ?? {},
    }));
  }
}
