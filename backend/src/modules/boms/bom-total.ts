/**
 * Shared BOM/project total from the authoritative bom_item_costs snapshots.
 * `amount` is own_cost: all five cost categories, excluding children. Quantities
 * are applied through the tree exactly once. No partial source sums or entered
 * unit_cost fallback can replace a complete, current snapshot.
 * Freshness and completeness are required even for zero amounts. One FX snapshot
 * is supplied by the caller. Invalid graphs or missing/untrusted costs fail closed.
 */

export interface BomTotalItem {
  id: string;
  parent_item_id: string | null;
  quantity: unknown;
}

export interface BomCostRow {
  itemId: string;
  /** Persisted own_cost, including material, process, tooling, packaging and procured parts. */
  amount: unknown;
  currency: string | null;
  /** Whether the authoritative producer established this amount's denomination. */
  trusted: boolean;
  isStale: boolean | null;
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
  const unresolved = new Set<string>();
  const byId = new Map<string, BomTotalItem>();
  for (const item of items) {
    if (byId.has(item.id)) unresolved.add(item.id);
    byId.set(item.id, item);
  }
  const rowsByItem = new Map<string, BomCostRow[]>();
  for (const row of rows) {
    const existing = rowsByItem.get(row.itemId) ?? [];
    existing.push(row);
    rowsByItem.set(row.itemId, existing);
  }
  const numeric = (value: unknown): number =>
    typeof value === 'number' || (typeof value === 'string' && value.trim() !== '') ? Number(value) : NaN;
  const quantities = new Map<string, number>();
  const subtotals = new Map<string, number>();
  const childCounts = new Map(items.map(item => [item.id, 0]));

  for (const item of items) {
    const quantity = numeric(item.quantity);
    if (!Number.isFinite(quantity) || quantity < 0) unresolved.add(item.id);
    quantities.set(item.id, quantity);
    if (item.parent_item_id) {
      if (!byId.has(item.parent_item_id)) unresolved.add(item.id);
      else childCounts.set(item.parent_item_id, childCounts.get(item.parent_item_id)! + 1);
    }

    const snapshots = rowsByItem.get(item.id) ?? [];
    const row = snapshots[0];
    if (snapshots.length !== 1 || !row.trusted || row.isStale !== false || !isIsoCode(row.currency)) {
      unresolved.add(item.id);
      continue;
    }
    const amount = numeric(row.amount);
    const rate = row.currency === reportingCurrency || amount === 0 ? 1 : rateToReporting(row.currency);
    const converted = amount * (rate ?? NaN);
    if (!Number.isFinite(amount) || amount < 0 || rate == null || rate <= 0 || !Number.isFinite(converted)) {
      unresolved.add(item.id);
      continue;
    }
    subtotals.set(item.id, converted);
  }
  if (unresolved.size) return { total: null, unresolvedItems: [...unresolved] };

  // Bottom-up traversal avoids recursive stack limits on deep, imported BOMs.
  const ready = items.filter(item => childCounts.get(item.id) === 0).map(item => item.id);
  let total = 0;
  for (let index = 0; index < ready.length; index++) {
    const id = ready[index];
    const item = byId.get(id)!;
    const extended = subtotals.get(id)! * quantities.get(id)!;
    if (!Number.isFinite(extended)) unresolved.add(id);
    if (item.parent_item_id) {
      const parent = item.parent_item_id;
      subtotals.set(parent, subtotals.get(parent)! + extended);
      childCounts.set(parent, childCounts.get(parent)! - 1);
      if (childCounts.get(parent) === 0) ready.push(parent);
    } else {
      total += extended;
    }
  }
  for (const item of items) if (childCounts.get(item.id)! > 0) unresolved.add(item.id);
  if (!Number.isFinite(total)) for (const item of items) unresolved.add(item.id);
  return unresolved.size ? { total: null, unresolvedItems: [...unresolved] } : { total, unresolvedItems: [] };
}
