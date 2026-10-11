// The die-casting reference tables a calculator field reads, for the
// calculator dialog lookup-table viewer: the memory/Die Casting variables, the
// alloy rows (materials_master) and lookup tables staged by migration 846, and
// the Digital Factory USA tool shop the die is priced at (staged with the
// Plastic Modeling reference, migration 823). Only tables a die-casting
// calculator field names are served (dieCastingLookupTableNames).
import { CASTING_REFERENCE_SOURCE_VERSION } from './casting-reference';
import { TOOL_SHOP_LOOKUP_KEYS } from './die-tooling';
import { PLASTIC_REFERENCE_SOURCE_VERSION } from '../plastic-molding/plastic-reference';
import { CASTING_MATERIALS_TABLE, CASTING_VARIABLES_TABLE } from './calculators/die-casting-calculator-spec';

interface CastingTableQuery {
  /** machining_reference_data category. */
  category: 'variable' | 'material' | 'lookup_table';
  sourceVersion: string;
  /** The row key, for one lookup table; absent for variables and alloys (every row). */
  key?: string;
}

/** Where a die-casting calculator table is staged. */
export function castingTableQuery(table: string): CastingTableQuery {
  if (table === CASTING_VARIABLES_TABLE) return { category: 'variable', sourceVersion: CASTING_REFERENCE_SOURCE_VERSION };
  if (table === CASTING_MATERIALS_TABLE) return { category: 'material', sourceVersion: CASTING_REFERENCE_SOURCE_VERSION };
  const toolShop = (TOOL_SHOP_LOOKUP_KEYS as readonly string[]).includes(table);
  return { category: 'lookup_table', sourceVersion: toolShop ? PLASTIC_REFERENCE_SOURCE_VERSION : CASTING_REFERENCE_SOURCE_VERSION, key: table };
}

type Cell = string | number | null;
export interface CastingFlatTable { columns: string[]; rows: Array<Record<string, Cell>> }

/**
 * The variables as memory keeps them (Die casting_variables.csv columns), so a
 * seed match { 'Variable Name': name } outlines its row.
 */
export function castingVariablesAsTable(records: Array<{ key: string; value: string | null; unit_type: string | null; notes: string | null }>): CastingFlatTable {
  const rows = records.map((r) => ({
    'Variable Name': r.key,
    Unit: r.unit_type,
    Description: r.notes,
    'String Value': r.value !== null && r.value !== '' && Number.isFinite(Number(r.value)) ? Number(r.value) : r.value,
  }));
  return { columns: ['Variable Name', 'Unit', 'Description', 'String Value'], rows };
}

/** The alloy rows (materials_master columns), so a seed match { Name } outlines its row. */
export function castingMaterialsAsTable(records: Array<{ raw: Record<string, unknown> | null }>): CastingFlatTable {
  const rows = records.map((r) => Object.fromEntries(Object.entries(r.raw ?? {}).map(([k, v]) => [
    k, typeof v === 'number' || typeof v === 'string' ? v : v == null ? null : JSON.stringify(v),
  ])) as Record<string, Cell>);
  const columns: string[] = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!columns.includes(k)) columns.push(k);
  return { columns, rows };
}
