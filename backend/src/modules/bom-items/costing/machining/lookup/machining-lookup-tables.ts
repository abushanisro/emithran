import { loadMachiningCalculatorSpec } from '../calculators/machining-calculator-spec';

/**
 * The machining reference tables the machining calculators read
 * (machining_reference_data, staged by migrations 739-751), flattened into
 * plain rows for the calculator dialog's lookup-table viewer. The stored
 * shapes differ — a flat row array, an object with `rows`, or a `materials`
 * array with values nested per diameter breakpoint / per operation — so each
 * nested shape is flattened to one row per (material, breakpoint|operation),
 * with the same column names the engine's lookup matches use
 * (CalcSeed.match / ProcessLineCost.lookupMatches), so a used row can be
 * outlined exactly.
 */
/**
 * The machining_reference_data source_version staged from memory/Machining
 * (migrations 639, 739-751, 785, 809-814). The same table key can also exist
 * under another folder's version — memory/Multi-Spindle Maching stages
 * tblPartingRingWidth and tblPreferredSizes as '2026-Multi-Spindle' with
 * different values — so every machining read pins this version rather than
 * picking whichever copy a key-only query returns first.
 */
export const MACHINING_REFERENCE_SOURCE_VERSION = '2026-03';

export interface FlatLookupTable {
  columns: string[];
  rows: Array<Record<string, string | number | boolean | null>>;
}

/** Tables a machining calculator field reads — the only ones this module serves. */
export function machiningLookupTableNames(): string[] {
  const names = new Set<string>();
  for (const c of loadMachiningCalculatorSpec().calculators) {
    for (const f of c.fields) {
      if (f.source !== 'lookup') continue;
      for (const t of [f.table, ...(f.alsoTables ?? [])]) if (t) names.add(t);
    }
  }
  return [...names].sort();
}

const scalar = (v: unknown) => v === null || ['string', 'number', 'boolean'].includes(typeof v);

function flatRows(rows: any[]): FlatLookupTable['rows'] {
  return rows.map((r) => Object.fromEntries(Object.entries(r ?? {}).filter(([, v]) => scalar(v)))) as FlatLookupTable['rows'];
}

/** One record with nested objects spread into dotted columns and arrays kept as JSON text. */
function flattenRecord(o: any, prefix = '', out: Record<string, string | number | boolean | null> = {}) {
  for (const [k, v] of Object.entries(o ?? {})) {
    const col = prefix ? `${prefix}.${k}` : k;
    if (scalar(v)) out[col] = v as any;
    else if (Array.isArray(v)) out[col] = v.every(scalar) ? v.join(', ') : JSON.stringify(v);
    else flattenRecord(v, col, out);
  }
  return out;
}

const isRecordArray = (v: unknown): v is any[] => Array.isArray(v) && v.length > 0 && v.every((x) => x && typeof x === 'object' && !Array.isArray(x));

/**
 * A table staged as a document (e.g. { units, materials: [...] } or
 * { sizes: [...] } or { series: { name: [...] } }) rather than a row array:
 * its rows are the largest array of records in it, or, when the records are
 * grouped under an object ({ group: [...] }), every group's records with the
 * group name as the first column. Nothing is invented; a document with no
 * record array has no rows.
 */
function documentRows(raw: any): FlatLookupTable['rows'] {
  if (!raw || typeof raw !== 'object') return [];
  const arrays = Object.entries(raw).filter(([, v]) => isRecordArray(v)) as Array<[string, any[]]>;
  if (arrays.length) {
    const [, largest] = arrays.reduce((a, b) => (b[1].length > a[1].length ? b : a));
    return largest.map((r) => flattenRecord(r));
  }
  for (const [field, v] of Object.entries(raw)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const groups = Object.entries(v as Record<string, unknown>);
      if (groups.length && groups.every(([, g]) => isRecordArray(g))) {
        return groups.flatMap(([name, g]) => (g as any[]).map((r) => ({ [field]: name, ...flattenRecord(r) })));
      }
      if (groups.length && groups.every(([, g]) => g && typeof g === 'object' && !Array.isArray(g))) {
        return groups.map(([name, g]) => ({ [field]: name, ...flattenRecord(g) }));
      }
    }
  }
  // Records one level down ({ materials: { rows: [...] }, notes: { rows: [...] } }).
  const nested = Object.values(raw)
    .filter((v): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v))
    .flatMap((v) => Object.values(v).filter(isRecordArray)) as any[][];
  if (nested.length) return nested.reduce((a, b) => (b.length > a.length ? b : a)).map((r) => flattenRecord(r));
  return [];
}

export function flattenMachiningLookupTable(table: string, raw: any): FlatLookupTable {
  let rows: FlatLookupTable['rows'];
  if (table === 'tblDrilling' && Array.isArray(raw?.materials)) {
    const construction: Record<string, string> = raw.construction_by_diameter ?? {};
    rows = raw.materials.flatMap((m: any) => Object.entries(m.feed_mm_rev_by_diameter ?? {}).map(([d, feed]) => {
      const c = construction[d] ?? null;
      return {
        material_cut_code: m.material_cut_code, hardness: m.hardness, construction: c, diameter_mm: Number(d),
        cutting_speed_m_min: c === 'Solid' ? m.cutting_speed_m_min?.solid : c === 'Insert-Based' ? m.cutting_speed_m_min?.insert_based : null,
        feed_mm_rev: feed as number,
      };
    }));
  } else if (table === 'deep_bore_drill_lookup' && Array.isArray(raw?.materials)) {
    rows = raw.materials.flatMap((m: any) => Object.entries(m.feed_mm_rev_by_diameter ?? {}).map(([d, feed]) => ({
      material_cut_code: m.material_cut_code, hardness: m.hardness, diameter_mm: Number(d),
      cutting_speed_m_min: m.cutting_speed_m_min, feed_mm_rev: feed as number,
    })));
  } else if (table === 'tblGeneralTurning' && Array.isArray(raw?.materials)) {
    rows = raw.materials.flatMap((m: any) => Object.entries(m.operations ?? {}).map(([op, v]: [string, any]) => ({
      material_cut_code: m.material_cut_code, hardness: m.hardness, operation: op,
      cut_depth_mm: v?.cut_depth_mm ?? null, cutting_speed_m_min: v?.cutting_speed_m_min ?? null, feed_rate_mm_rev: v?.feed_rate_mm_rev ?? null,
    })));
  } else if (Array.isArray(raw)) {
    rows = flatRows(raw);
  } else if (Array.isArray(raw?.rows)) {
    rows = flatRows(raw.rows);
  } else {
    rows = documentRows(raw);
  }
  const columns: string[] = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!columns.includes(k)) columns.push(k);
  return { columns, rows };
}

/** The machining variables (machining_reference_data category 'variable') as a table. */
export function variablesAsTable(records: Array<{ key: string; value: string | null; unit_type: string | null; notes: string | null }>): FlatLookupTable {
  const rows = records.map((r) => ({
    key: r.key,
    value: r.value !== null && r.value !== '' && Number.isFinite(Number(r.value)) ? Number(r.value) : r.value,
    unit_type: r.unit_type, notes: r.notes,
  }));
  return { columns: ['key', 'unit_type', 'notes', 'value'], rows };
}
