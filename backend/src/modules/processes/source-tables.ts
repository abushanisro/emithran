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

/** Columns of mhr_records that are bookkeeping or the row's identity, not values a calculator reads. */
const MACHINE_SKIP: ReadonlySet<string> = new Set([
  'id', 'organization_id', 'user_id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'specs', 'machine_class', 'location',
]);

/**
 * The machines of the record's class at its location (mhr_records), one row each with every value column and its specs flattened, the
 * record's own row matched by id. `column` is a column of the record or a key of its specs (the calculator spec reads both by one name):
 * whichever an engine reads (press_cycle_time_s, drum_index_time_s, ...) is shown, never a fixed list that omits it.
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
    // A record column wins over a spec of the same name: it is the value the row itself holds.
    for (const [k, v] of Object.entries(r)) if (!MACHINE_SKIP.has(k) && isCell(v)) out[k] = v;
    return out;
  }).sort((a, b) => String(a.machine_name).localeCompare(String(b.machine_name)));
  return {
    id: `mhr_records:${machine.machineClass}:${machine.location ?? ''}`,
    tableName: `HR Rates machines: ${machine.machineClass}${machine.location ? ` (${machine.location})` : ''}`,
    columnDefinitions: columnsOf(flat, ['machine_name'], MACHINE_SKIP, column),
    rows: flat,
    matchedRowKeys: { id: machine.id },
  };
}

/** Columns of raw_materials that are bookkeeping, not properties of the material. */
const MATERIAL_SKIP: ReadonlySet<string> = new Set(['id', 'organization_id', 'user_id', 'created_at', 'updated_at', 'created_by', 'updated_by']);

/** The materials of the record's group (raw_materials), the record's own row matched by id. */
export function materialSourceTable(
  rows: ReadonlyArray<Record<string, any>>,
  material: { id: string; group: string | null },
  column: string,
): SourceTable {
  const flat = rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k, v]) => k === 'id' || (!MATERIAL_SKIP.has(k) && isCell(v)))))
    .sort((a, b) => String(a['name'] ?? '').localeCompare(String(b['name'] ?? '')));
  return {
    id: `raw_materials:${material.group ?? ''}`,
    tableName: `Raw Materials${material.group ? `: ${material.group}` : ''}`,
    columnDefinitions: columnsOf(flat, ['name', 'grade'], MATERIAL_SKIP, column),
    rows: flat,
    matchedRowKeys: { id: material.id },
  };
}
