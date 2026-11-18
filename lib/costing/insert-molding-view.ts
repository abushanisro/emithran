import type { BOMItem, CostSummaryDto } from '@/lib/api/hooks/useBOMItems';

export type InsertMoldingSummary = NonNullable<CostSummaryDto['insertMolding']>;

/** The process group of insert molding (backend part-family-process-group.ts INSERT_MOLDING_PROCESS_GROUP). */
export const INSERT_MOLDING_PROCESS_GROUP = 'Assembly Molding';

/** The Cost Guide keys of an insert-molded part (backend insert-molding.ts INSERT_MOLDING_ROUTE_KEY, INSERT_MOLDING_INSERTS_KEY). */
export const INSERT_MOLDING_SCENARIO_KEYS = {
  route: 'insertMoldingRoute',
  inserts: 'insertMoldingInserts',
} as const;

/** The inserts entered in the Cost Guide (used when the part has no BOM children). */
export interface InsertEntry { count: number | null; weightKg: number | null; name: string }

/** Whether an item is insert molded: its Process is Assembly Molding (the backend's isInsertMolding). */
export function isInsertMoldingItem(item: Pick<BOMItem, 'scenarioOverrides'> | null | undefined): boolean {
  return item?.scenarioOverrides?.processGroup === INSERT_MOLDING_PROCESS_GROUP;
}

/** The Cost Guide's insert entry, read defensively. */
export function insertEntryOf(overrides: Record<string, unknown> | null | undefined): InsertEntry {
  const raw = overrides?.[INSERT_MOLDING_SCENARIO_KEYS.inserts];
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
  return { count: num(r.count), weightKg: num(r.weightKg), name: typeof r.name === 'string' ? r.name : '' };
}

/** The scenario patch of an insert entry: cleared when it holds no count (the engine then has no inserts to load). */
export function insertEntryPatch(entry: InsertEntry): Record<string, unknown> {
  if (entry.count == null) return { [INSERT_MOLDING_SCENARIO_KEYS.inserts]: null };
  return {
    [INSERT_MOLDING_SCENARIO_KEYS.inserts]: {
      count: Math.round(entry.count),
      ...(entry.weightKg != null ? { weightKg: entry.weightKg } : {}),
      ...(entry.name.trim() ? { name: entry.name.trim() } : {}),
    },
  };
}

/** How the shot cycle is made up: on a rotary or shuttle table the next inserts are loaded while the other half molds; without one, in series. */
export function shotCycleOf(im: Pick<InsertMoldingSummary, 'press'>): { rule: string; explanation: string } {
  return im.press.tablePress
    ? { rule: 'longer of loading and molding', explanation: 'The table loads the next lower mold half while the other is molded, so the shot is the longer of the two.' }
    : { rule: 'loading + molding', explanation: 'No table: the inserts are loaded with the mold open, so loading and molding add.' };
}
