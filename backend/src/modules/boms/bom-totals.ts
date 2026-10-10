import type { SupabaseClient } from '@supabase/supabase-js';
import type { RateSnapshot } from '../../common/exchange-rate/exchange-rate.service';
import { ROLLUP_REPORTING_CURRENCY } from '../bom-items/costing/shared/core/persisted-currency-contract';
import { computeBomTotal, type BomCostRow, type BomTotalItem } from './bom-total';

const PAGE_SIZE = 500;
const ID_BATCH_SIZE = 200;

/** Exact counts also detect truncated/empty pages and count changes during a read. */
export async function readAllRows<T>(query: (from: number, to: number) => PromiseLike<{
  data: T[] | null;
  error: { message: string } | null;
  count: number | null;
}>): Promise<T[]> {
  const rows: T[] = [];
  let expectedCount: number | null = null;
  while (true) {
    const { data, error, count } = await query(rows.length, rows.length + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    if (!data || count == null || (expectedCount != null && count !== expectedCount)) {
      throw new Error('Incomplete or changing paginated result');
    }
    expectedCount = count;
    rows.push(...data);
    if (rows.length === count) return rows;
    if (!data.length || rows.length > count) throw new Error('Truncated paginated result');
  }
}

interface CostedItem extends BomTotalItem { bom_id: string }
interface SnapshotRow {
  bom_item_id: string;
  own_cost: unknown;
  currency_code: string | null;
  currency_integrity: string | null;
  is_stale: boolean | null;
}

export interface PersistedBomTotal {
  totalCost: number | null;
  itemCount: number;
}

/** Shared read/decision boundary for both BOM and project totals; never writes or recalculates. */
export async function loadBomTotals(
  client: SupabaseClient,
  bomIds: readonly string[],
  getSnapshot: () => Promise<RateSnapshot>,
  onError: (message: string) => void,
  reportingCurrency = ROLLUP_REPORTING_CURRENCY,
): Promise<Map<string, PersistedBomTotal>> {
  const result = new Map(bomIds.map(id => [id, { totalCost: 0 as number | null, itemCount: 0 }]));
  if (!bomIds.length) return result;
  try {
    const items: CostedItem[] = [];
    const uniqueBomIds = [...result.keys()];
    for (let start = 0; start < uniqueBomIds.length; start += ID_BATCH_SIZE) {
      items.push(...await readAllRows<CostedItem>((from, to) => client.from('bom_items')
        .select('id, bom_id, parent_item_id, quantity', { count: 'exact' })
        .in('bom_id', uniqueBomIds.slice(start, start + ID_BATCH_SIZE)).order('id').range(from, to)));
    }
    const itemsByBom = new Map<string, CostedItem[]>();
    for (const item of items) {
      const group = itemsByBom.get(item.bom_id) ?? [];
      group.push(item);
      itemsByBom.set(item.bom_id, group);
      result.get(item.bom_id)!.itemCount++;
    }
    if (!items.length) return result;

    const snapshots: SnapshotRow[] = [];
    const itemIds = items.map(item => item.id);
    for (let start = 0; start < itemIds.length; start += ID_BATCH_SIZE) {
      snapshots.push(...await readAllRows<SnapshotRow>((from, to) => client.from('bom_item_costs')
        .select('bom_item_id, own_cost, currency_code, currency_integrity, is_stale', { count: 'exact' })
        .in('bom_item_id', itemIds.slice(start, start + ID_BATCH_SIZE)).order('id').range(from, to)));
    }
    const costsByItem = new Map<string, BomCostRow[]>();
    for (const row of snapshots) {
      const group = costsByItem.get(row.bom_item_id) ?? [];
      group.push({ itemId: row.bom_item_id, amount: row.own_cost, currency: row.currency_code,
        trusted: row.currency_integrity === 'consistent', isStale: row.is_stale });
      costsByItem.set(row.bom_item_id, group);
    }
    let rates: RateSnapshot | null = null;
    try { rates = await getSnapshot(); }
    catch { onError('FX snapshot unavailable; foreign-denominated nonzero costs remain unresolved'); }
    for (const [bomId, group] of itemsByBom) {
      const calculated = computeBomTotal({ items: group,
        rows: group.flatMap(item => costsByItem.get(item.id) ?? []), reportingCurrency,
        rateToReporting: from => rates?.convertOptional(from, reportingCurrency) ?? null });
      result.get(bomId)!.totalCost = calculated.total;
    }
  } catch (error) {
    onError(`BOM totals unavailable: ${error instanceof Error ? error.message : 'read failed'}`);
    for (const value of result.values()) value.totalCost = null;
  }
  return result;
}
