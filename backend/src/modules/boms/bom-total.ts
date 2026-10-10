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
 * The aggregation shape is unchanged from before this module existed: per item
 * the best available unit cost (record sums, else the stored aggregate, else
 * the item's own unit_cost) times quantity, then the larger of the leaf sum and
 * the root sum, falling back to the sum of everything.
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

  const parentIds = new Set(items.map((i) => i.parent_item_id).filter((p): p is string => !!p));
  let leafSum = 0;
  let rootSum = 0;
  let allSum = 0;

  for (const item of items) {
    const itemRows = rowsByItem.get(item.id) ?? [];
    let recordCost = 0;
    let aggregateCost = 0;
    for (const r of itemRows) {
      const converted = convert(r);
      if (r.kind === 'aggregate') aggregateCost += converted;
      else recordCost += converted;
    }
    const quantity = parseFloat(String(item.quantity)) || 1;
    const ownUnitCost = parseFloat(String(item.unit_cost)) || 0;
    const bestUnitCost = recordCost > 0 ? recordCost : aggregateCost > 0 ? aggregateCost : ownUnitCost;
    const itemTotal = bestUnitCost * quantity;

    allSum += itemTotal;
    if (!parentIds.has(item.id)) leafSum += itemTotal;
    if (!item.parent_item_id) rootSum += itemTotal;
  }

  if (unresolved.size > 0) return { total: null, unresolvedItems: [...unresolved] };
  const best = Math.max(leafSum, rootSum);
  return { total: best > 0 ? best : allSum, unresolvedItems: [] };
}
