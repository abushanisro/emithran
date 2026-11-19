import type { BOMItem, CostSummaryDto } from '@/lib/api/hooks/useBOMItems';

export type MultiShotSummary = NonNullable<CostSummaryDto['multiShot']>;

/** The process group of multi-shot molding (backend part-family-process-group.ts MULTI_SHOT_PROCESS_GROUP). */
export const MULTI_SHOT_PROCESS_GROUP = 'Assembly Plastic Molding';

/** The Cost Guide keys of a multi-shot part (backend multi-shot.ts MULTI_SHOT_ROUTE_KEY, MULTI_SHOT_SHOTS_KEY). */
export const MULTI_SHOT_SCENARIO_KEYS = { route: 'multiShotRoute', shots: 'multiShotShots' } as const;

/** An extra shot entered in the Cost Guide (a part with no shot children): its material grade and its share of the part's volume. */
export interface ShotEntry { grade: string; volumePct: number }

/** Whether an item is multi-shot molded: its Process is Assembly Plastic Molding (the backend's isMultiShot). */
export function isMultiShotItem(item: Pick<BOMItem, 'scenarioOverrides'> | null | undefined): boolean {
  return item?.scenarioOverrides?.processGroup === MULTI_SHOT_PROCESS_GROUP;
}

/** The Cost Guide's extra shots, read as the backend reads them (shotEntriesOf): a grade and a share strictly between 0 and 100 %. */
export function shotEntriesOf(overrides: Record<string, unknown> | null | undefined): ShotEntry[] {
  const raw = overrides?.[MULTI_SHOT_SCENARIO_KEYS.shots];
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((e: unknown) => {
    const r = (e ?? {}) as Record<string, unknown>;
    const pct = typeof r.volumePct === 'number' ? r.volumePct : Number.NaN;
    return typeof r.grade === 'string' && r.grade.trim() && pct > 0 && pct < 100 ? [{ grade: r.grade.trim(), volumePct: pct }] : [];
  });
}

/** The scenario patch of the extra shots: cleared when there are none. */
export function shotEntriesPatch(entries: readonly ShotEntry[]): Record<string, unknown> {
  return { [MULTI_SHOT_SCENARIO_KEYS.shots]: entries.length > 0 ? entries.map((e) => ({ grade: e.grade, volumePct: e.volumePct })) : null };
}

/** Why the extra shots cannot be saved, or null: each needs a material, and together they leave the first shot (the part) some volume. */
export function shotEntriesProblem(entries: readonly ShotEntry[]): string | null {
  if (entries.some((e) => !e.grade.trim())) return 'Pick a material for every shot.';
  if (entries.some((e) => !(e.volumePct > 0 && e.volumePct < 100))) return 'Each shot is a share of the part between 0 and 100 %.';
  const total = entries.reduce((t, e) => t + e.volumePct, 0);
  if (total >= 100) return `The extra shots take ${total} % of the part: the first shot needs some of it.`;
  return null;
}

/** How the press cycle is made up: the stations mold at once, so the press waits for the longest shot (or the loading), then indexes. */
export const MULTI_SHOT_CYCLE_RULE = 'longest shot + index';
