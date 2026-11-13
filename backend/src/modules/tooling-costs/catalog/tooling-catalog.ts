import { MEMORY_DOMAINS } from '../../processes/reference-domains';

/**
 * The tooling catalog: which staged reference tables list priced tooling items, per domain.
 *
 * Nothing is copied into code. Each entry names a table already staged from memory/
 * (machining_reference_data, under the domain's source version) or the sheet-metal
 * component table, and the columns that hold the item's name and price. The service
 * reads the rows; catalogItems turns them into one shape for the Add Tooling dialog.
 *
 * Left out on purpose: 2026-Casting coreboxMaterial_lookup and stockCores_lookup are
 * staged transposed (one column per material), and the stock cores have no price;
 * toolingHeatTreatCost is a service rate per kg, not an item.
 */
export type CatalogUnit = 'each' | 'kg' | 'cavity';

export interface CatalogTableDef {
  /** The staged table: a machining_reference_data lookup key, or the sheet-metal component table. */
  table: string;
  kind: string;
  nameColumn: string;
  costColumn: string;
  unit: CatalogUnit;
  /** Columns shown after the name to tell items apart (model, size, ...). */
  detailColumns: string[];
  /** The typical quantity per tool, when the table records one. */
  quantityColumn?: string;
}

export const SHEET_METAL_COMPONENT_TABLE = 'sm_lookup_tooling_component_costs';

const dieComponents = (kind: string): CatalogTableDef => ({
  table: 'componentStandardCosts', kind, nameColumn: 'Name', costColumn: 'Cost (USD)', unit: 'each',
  detailColumns: ['Model', 'Size (mm)', 'Weight (kg)'],
});

const corebox = (table: string): CatalogTableDef => ({
  table, kind: 'Corebox', nameColumn: 'Type', costColumn: 'One Cavity Cost (USD)', unit: 'cavity', detailColumns: [],
});

export const TOOLING_CATALOGS: Readonly<Record<string, readonly CatalogTableDef[]>> = {
  injection_molding: [
    { table: 'cmStandardToolingComponents', kind: 'Mold component', nameColumn: 'name', costColumn: 'unit_cost_usd', unit: 'each', detailColumns: ['notes'], quantityColumn: 'quantity' },
    { table: 'digital_factory_tool_materials_usa', kind: 'Tool steel', nameColumn: 'name', costColumn: 'materialCostUsdPerKg', unit: 'kg', detailColumns: ['hardness'] },
  ],
  die_casting: [dieComponents('Die component'), corebox('coreboxMaterial')],
  sand_casting: [corebox('lookupTables_Component_tblCoreboxMaterial')],
  sheet_plastic: [
    { table: 'standardToolingComponents', kind: 'Tooling component', nameColumn: 'Name', costColumn: 'Unit Cost (USD)', unit: 'each', detailColumns: [] },
  ],
  sheet_transfer_die: [dieComponents('Die component')],
  hydroforming: [dieComponents('Die component')],
  sheet_roll_forming: [dieComponents('Roll-form component')],
  machining: [
    { table: 'tblToolCost', kind: 'Cutting tool', nameColumn: 'ToolType', costColumn: 'ToolCostUSD', unit: 'each', detailColumns: ['DiameterMm', 'ToolSeries', 'Construction'] },
  ],
  sheet_metal: [
    { table: SHEET_METAL_COMPONENT_TABLE, kind: 'Die component', nameColumn: 'component_name', costColumn: 'cost_usd', unit: 'each', detailColumns: ['model', 'size_mm', 'weight_kg'] },
  ],
};

export interface ToolingCatalogItem {
  /** dataset:table:row, stable while the staged rows are unchanged. */
  id: string;
  kind: string;
  name: string;
  details: string;
  unitCostUsd: number;
  unit: CatalogUnit;
  typicalQuantity: number | null;
  source: { dataset: string; table: string; row: number };
}

/** A staged cell as a number: numbers as-is, text with thousands separators parsed; blank or text is null, never 0. */
export function parseCatalogNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const s = v.trim().replace(/,/g, '');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const present = (v: unknown) => v !== null && v !== undefined && v !== '';

/** The priced items of one staged table; rows with no name or price are listed as unpriced, not costed at zero. */
export function catalogItems(
  def: CatalogTableDef,
  dataset: string,
  rows: ReadonlyArray<Record<string, unknown>>,
): { items: ToolingCatalogItem[]; unpriced: string[] } {
  const items: ToolingCatalogItem[] = [];
  const unpriced: string[] = [];
  rows.forEach((r, row) => {
    const name = present(r[def.nameColumn]) ? String(r[def.nameColumn]).trim() : '';
    const cost = parseCatalogNumber(r[def.costColumn]);
    if (!name || cost === null) {
      unpriced.push(name || `(row ${row}: no name)`);
      return;
    }
    items.push({
      id: `${dataset}:${def.table}:${row}`,
      kind: def.kind,
      name,
      details: def.detailColumns.filter((c) => present(r[c])).map((c) => `${c} ${r[c]}`).join(', '),
      unitCostUsd: cost,
      unit: def.unit,
      typicalQuantity: def.quantityColumn ? parseCatalogNumber(r[def.quantityColumn]) : null,
      source: { dataset, table: def.table, row },
    });
  });
  return { items, unpriced };
}

const DOMAIN_LABELS: Readonly<Record<string, string>> = {
  ...Object.fromEntries(MEMORY_DOMAINS.map((d) => [d.key, d.label])),
  machining: 'Machining',
  sheet_metal: 'Sheet Metal',
};

/** The domains that have a tooling catalog, with their display labels. */
export const catalogDomains = () => Object.keys(TOOLING_CATALOGS).map((key) => ({ key, label: DOMAIN_LABELS[key] ?? key }));

/** The staged source version of a memory/ domain (null for machining and sheet metal, which have their own). */
export const memorySourceVersion = (domain: string) => MEMORY_DOMAINS.find((d) => d.key === domain)?.sourceVersion ?? null;

/** Why a tooling row's catalog source cannot be saved, or null when it can: it must name an item of its own process's catalog, and a custom item has none. */
export function catalogSourceProblem(
  row: { process: string | null; source: string | null; isCustom: boolean },
  catalog: { label: string; items: ReadonlyArray<{ id: string }> } | null,
): string | null {
  if (!row.source) return null;
  if (row.isCustom) return 'A custom item has no catalog source';
  if (!row.process || !catalog) return 'A catalog item needs its manufacturing process';
  if (!catalog.items.some((i) => i.id === row.source)) return `${row.source} is not an item of the ${catalog.label} tooling catalog`;
  return null;
}
