/**
 * The part's applied cost as a table (backend GET /bom-items/:id/cost-table), and how the page lays it out. Pure, so it is tested. The backend states every
 * number and which columns it has no data for; nothing here computes a cost.
 */
export type CostUnit = "usd" | "usd_per_kg" | "usd_per_hr" | "minutes" | "seconds" | "kg" | "percent" | "count" | "text";

export interface CostColumn {
  key: string;
  label: string;
  group: string;
  unit: CostUnit;
  /** false: the cost model has no data for this column; `note` says why. */
  modelled: boolean;
  note?: string;
  /** In the compact table; the dialog shows every column. */
  basic: boolean;
}

export type CostRowKind = "part" | "material" | "group" | "process" | "logistics" | "procured" | "tooling";

export interface CostRow {
  id: string;
  parentId: string | null;
  kind: CostRowKind;
  name: string;
  status: "ok" | "attention";
  statusNote?: string;
  values: Record<string, number | string | null | undefined>;
}

export interface CostTable {
  currency: "USD";
  columns: CostColumn[];
  rows: CostRow[];
}

export type ColumnSet = "basic" | "all";

export function columnsFor(table: CostTable, set: ColumnSet): CostColumn[] {
  return set === "all" ? table.columns : table.columns.filter((c) => c.basic);
}

/** The header band over the columns: consecutive columns of one group share one cell. */
export function columnGroups(columns: readonly CostColumn[]): { group: string; span: number }[] {
  const out: { group: string; span: number }[] = [];
  for (const c of columns) {
    const last = out[out.length - 1];
    if (last?.group === c.group) last.span += 1;
    else out.push({ group: c.group, span: 1 });
  }
  return out;
}

export interface VisibleRow extends CostRow {
  depth: number;
  hasChildren: boolean;
}

/** The rows to draw, in tree order, without those under a collapsed row. The tree is the parentId links the backend states. */
export function visibleRows(rows: readonly CostRow[], collapsed: ReadonlySet<string>): VisibleRow[] {
  const children = new Map<string | null, CostRow[]>();
  for (const r of rows) children.set(r.parentId, [...(children.get(r.parentId) ?? []), r]);
  const out: VisibleRow[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const r of children.get(parent) ?? []) {
      const kids = children.get(r.id) ?? [];
      out.push({ ...r, depth, hasChildren: kids.length > 0 });
      if (!collapsed.has(r.id)) walk(r.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export interface Display {
  /** Display currency symbol, e.g. "$". */
  symbol: string;
  /** Multiplier from USD (the table's currency) to the display currency. */
  fromUsd: number;
}

const grouped = (n: number, digits: number) => n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** One cell as text; "—" for an empty one. */
export function formatCell(value: number | string | null | undefined, column: CostColumn, display: Display): string {
  if (value === null || value === undefined || value === "") return "—";
  if (column.unit === "text") return String(value);
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  switch (column.unit) {
    case "usd": return `${display.symbol}${grouped(n * display.fromUsd, 3)}`;
    case "usd_per_hr": return `${display.symbol}${grouped(n * display.fromUsd, 2)}`;
    case "minutes": return grouped(n, 2);
    case "usd_per_kg": return `${display.symbol}${grouped(n * display.fromUsd, 3)}`;
    case "seconds": return grouped(n, 1);
    case "kg": return grouped(n, 3);
    case "percent": return grouped(n, 2);
    case "count": return grouped(n, 0);
    default: return String(value);
  }
}

/** The columns the dialog says it cannot fill, with why: one line each, for its legend. */
export function notModelled(table: CostTable): { label: string; note: string }[] {
  return table.columns.filter((c) => !c.modelled).map((c) => ({ label: c.label, note: c.note ?? "Not modelled." }));
}
