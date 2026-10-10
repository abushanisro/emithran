/**
 * The BOM list/detail total, in the reporting currency.
 *
 * Each cost row is converted from its own declared currency through ONE FX
 * lookup supplied by the caller, and only rows whose denomination is trusted
 * take part (the same contract as bom-item-rollup.ts: 'local' / 'converted'
 * cost_currency_basis, or an aggregate with currency_integrity 'consistent').
 * If any row that carries money cannot be converted, the BOM has NO total: a
 * number assembled from amounts of unknown denomination is worse than none.
 *
 * Hierarchy: an item's unit cost is its OWN cost plus, for each child, the child's
 * quantity times the child's unit cost; the BOM total is each root's quantity times
 * its unit cost. Own cost is the item's recorded materials and processes; a leaf
 * with none falls back to its stored aggregate, then its entered unit_cost. An
 * assembly never uses its stored aggregate, because that already contains its
 * children. A cycle, or a parent that is not in the BOM, leaves the total unresolved.
 */

export interface BomTotalItem {
  id: string;
  parent_item_id: string | null;
  quantity: unknown;
  /** Item's own entered unit cost; it has no currency column and is taken as reporting currency, as before. */
  unit_cost: unknown;
}

export interface BomCostRow {
  itemId: string;
  /** material/process: summed together as the item's record cost; aggregate: the stored bom_item_costs total. */
  kind: 'material' | 'process' | 'aggregate';
  amount: number;
  currency: string | null;
  /** Whether the producer established this amount's denomination. */
  trusted: boolean;
}

export interface BomTotalResult {
  /** null when any contributing amount could not be converted. */
  total: number | null;
  /** Items whose cost could not be established, for explanation. */
  unresolvedItems: string[];
}

const isIsoCode = (v: unknown): v is string => typeof v === 'string' && /^[A-Z]{3}$/.test(v);

export function computeBomTotal(input: {
  items: readonly BomTotalItem[];
  rows: readonly BomCostRow[];
  reportingCurrency: string;
  rateToReporting: (from: string) => number | null;
}): BomTotalResult {
  const { items, rows, reportingCurrency, rateToReporting } = input;
  const rowsByItem = new Map<string, BomCostRow[]>();
  for (const r of rows) {
    const arr = rowsByItem.get(r.itemId) ?? [];
    arr.push(r);
    rowsByItem.set(r.itemId, arr);
  }

  const unresolved = new Set<string>();
  const convert = (row: BomCostRow): number => {
    if (!Number.isFinite(row.amount) || row.amount === 0) return 0; // no money, cannot block
    if (!row.trusted || !isIsoCode(row.currency)) { unresolved.add(row.itemId); return 0; }
    const rate = row.currency === reportingCurrency ? 1 : rateToReporting(row.currency);
    if (rate == null || !Number.isFinite(rate) || rate <= 0) { unresolved.add(row.itemId); return 0; }
    return row.amount * rate;
  };

  const byId = new Map(items.map((i) => [i.id, i]));
  const children = new Map<string, BomTotalItem[]>();
  const roots: BomTotalItem[] = [];
  for (const item of items) {
    if (item.parent_item_id && byId.has(item.parent_item_id)) {
      const arr = children.get(item.parent_item_id) ?? [];
      arr.push(item);
      children.set(item.parent_item_id, arr);
    } else if (item.parent_item_id) {
      unresolved.add(item.id); // parent missing from this BOM: its cost cannot be placed
    } else {
      roots.push(item);
    }
  }

  const quantityOf = (item: BomTotalItem) => parseFloat(String(item.quantity)) || 1;
  const visiting = new Set<string>();
  const placed = new Set<string>();
  const unitCost = (item: BomTotalItem): number => {
    if (visiting.has(item.id)) { unresolved.add(item.id); return 0; } // cycle
    visiting.add(item.id);
    placed.add(item.id);
    let recordCost = 0;
    let aggregateCost = 0;
    for (const r of rowsByItem.get(item.id) ?? []) {
      const converted = convert(r);
      if (r.kind === 'aggregate') aggregateCost += converted;
      else recordCost += converted;
    }
    const kids = children.get(item.id) ?? [];
    let own = recordCost;
    if (own === 0 && kids.length === 0) own = aggregateCost > 0 ? aggregateCost : parseFloat(String(item.unit_cost)) || 0;
    let sum = own;
    for (const child of kids) sum += quantityOf(child) * unitCost(child);
    visiting.delete(item.id);
    return sum;
  };

  let total = 0;
  for (const root of roots) total += quantityOf(root) * unitCost(root);

  // anything not reached from a root (a cycle with no root) is cost we could not place
  for (const item of items) if (!placed.has(item.id)) unresolved.add(item.id);

  if (unresolved.size > 0) return { total: null, unresolvedItems: [...unresolved] };
  return { total, unresolvedItems: [] };
}
