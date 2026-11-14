/**
 * The records a calculator input was read from (a SourceRef of kind 'machine' or 'material'), shaped as the calculator dialog's reference
 * table: the record among its peers (the machines of the same class and location, the materials of the same group), the record's own row
 * identified by its id, and the column the value came from last, where the dialog marks the value in use. Pure: the caller reads the rows.
 */
import type { ReferenceTablePayload } from '../bom-items/costing/sheet-metal/lookup/turret-reference-tables';

/** "machine_power_kw" -> "Machine Power Kw": the label of a column named only by its key. */
const labelOf = (key: string): string => key.split('_').filter(Boolean).map((w) => w[0]!.toUpperCase() + w.slice(1)).join(' ');

/** A cell the table can show: a number or text; objects and arrays (nested specs) are not columns. */
const isCell = (v: unknown): v is string | number | boolean => typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean';

/** The columns some row has a value in, in first-seen order, with `last` moved to the end (the value's column). */
function columnsOf(rows: ReadonlyArray<Record<string, unknown>>, first: readonly string[], skip: ReadonlySet<string>, last: string) {
  const seen: string[] = [...first];
  for (const r of rows) for (const [k, v] of Object.entries(r)) if (!skip.has(k) && !seen.includes(k) && isCell(v) && v !== '') seen.push(k);
  return [...seen.filter((c) => c !== last), last].map((name) => ({ name, label: labelOf(name) }));
}

export interface SourceTable extends ReferenceTablePayload {
  /** Identifies the record the value was read from: the dialog outlines that row. */
  matchedRowKeys: Record<string, string>;
}

/**
 * The machines of the record's class at its location (mhr_records), one row each with its columns and specs flattened, the record's own row
 * matched by id. `column` is a column of the record or a key of its specs (the calculator spec reads both by one name).
 */
export function machineSourceTable(
  rows: ReadonlyArray<Record<string, any>>,
  machine: { id: string; machineClass: string; location: string | null },
  column: string,
): SourceTable {
  const flat = rows.map((r) => {
    const specs = r.specs && typeof r.specs === 'object' && !Array.isArray(r.specs) ? (r.specs as Record<string, unknown>) : {};
    const out: Record<string, unknown> = { id: String(r.id), machine_name: r.machine_name };
    for (const [k, v] of Object.entries(specs)) if (isCell(v)) out[k] = v;
    for (const k of ['machine_power_kw', 'operators', 'setup_time_hr', 'mhr_usd_per_hour', 'usd_labor_rate_per_hr']) if (isCell(r[k])) out[k] = r[k];
    return out;
  }).sort((a, b) => String(a.machine_name).localeCompare(String(b.machine_name)));
  return {
    id: `mhr_records:${machine.machineClass}:${machine.location ?? ''}`,
    tableName: `HR Rates machines: ${machine.machineClass}${machine.location ? ` (${machine.location})` : ''}`,
    columnDefinitions: columnsOf(flat, ['machine_name'], new Set(['id']), column),
    rows: flat,
    matchedRowKeys: { id: machine.id },
  };
}

/** Columns of raw_materials that are bookkeeping, not properties of the material. */
const MATERIAL_SKIP: ReadonlySet<string> = new Set(['id', 'organization_id', 'user_id', 'created_at', 'updated_at', 'created_by', 'updated_by']);

/** One numeric property of a material (raw_material_properties): a value read by its property_key (a die-casting alloy's mold_temp). */
export interface MaterialProperty { raw_material_id: string; property_key: string; value_num: unknown }

/**
 * The materials of the record's group (raw_materials), the record's own row matched by id. Each material's properties
 * (raw_material_properties) are columns of its row named by their property_key, so a value read from a property is shown and marked
 * like one read from a column; a column of the record itself is never replaced by a property of the same name.
 */
export function materialSourceTable(
  rows: ReadonlyArray<Record<string, any>>,
  material: { id: string; group: string | null },
  column: string,
  properties: ReadonlyArray<MaterialProperty> = [],
): SourceTable {
  const propsOf = new Map<string, Record<string, number>>();
  for (const p of properties) {
    const v = p.value_num == null || p.value_num === '' ? NaN : Number(p.value_num);
    if (!Number.isFinite(v)) continue;
    const id = String(p.raw_material_id);
    propsOf.set(id, { ...(propsOf.get(id) ?? {}), [p.property_key]: v });
  }
  const flat = rows
    .map((r) => {
      const own: Record<string, unknown> = Object.fromEntries(Object.entries(r).filter(([k, v]) => k === 'id' || (!MATERIAL_SKIP.has(k) && isCell(v))));
      for (const [k, v] of Object.entries(propsOf.get(String(r.id)) ?? {})) if (!(k in r) && !MATERIAL_SKIP.has(k)) own[k] = v;
      return own;
    })
    .sort((a, b) => String(a['name'] ?? '').localeCompare(String(b['name'] ?? '')));
  return {
    id: `raw_materials:${material.group ?? ''}`,
    tableName: `Raw Materials${material.group ? `: ${material.group}` : ''}`,
    columnDefinitions: columnsOf(flat, ['name', 'grade'], MATERIAL_SKIP, column),
    rows: flat,
    matchedRowKeys: { id: material.id },
  };
}
