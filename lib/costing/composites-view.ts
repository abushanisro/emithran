import type { CostSummaryDto } from '@/lib/api/hooks/useBOMItems';

export type CompositesSummary = NonNullable<CostSummaryDto['composites']>;

/** The scenario keys of the composites settings set over the engine's (backend composites-cost.service.ts COMPOSITES_*_KEY). */
export const COMPOSITES_SCENARIO_KEYS = {
  route: 'compositesRoute',
  plyCount: 'compositesPlyCount',
  core: 'compositesCore',
} as const;

/** How many of the composites settings the engineer set (the route is picked in the Workflow Builder and not counted). */
export function compositesOverrideCount(overrides: Record<string, unknown> | null | undefined): number {
  return [COMPOSITES_SCENARIO_KEYS.plyCount, COMPOSITES_SCENARIO_KEYS.core].filter((k) => overrides?.[k] != null).length;
}

/** A whole, positive number of plies, or an empty field (the laminate's own). */
export function parsePlyCount(text: string): number | null | 'invalid' {
  const t = text.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isInteger(n) && n > 0 ? n : 'invalid';
}

/**
 * The ply stack as the Cost Guide lists it: the plies grouped by the region they cover, the whole part first, then each drop-off level
 * ("8 plies over 60,000 mm²", "4 plies over 10,000 mm², drop-off 1").
 */
export function plyGroups(plies: CompositesSummary['plies']): Array<{ level: number; count: number; areaMm2: number }> {
  const byLevel = new Map<number, { level: number; count: number; areaMm2: number }>();
  for (const p of plies) {
    const g = byLevel.get(p.level) ?? { level: p.level, count: 0, areaMm2: p.areaMm2 };
    g.count += 1;
    byLevel.set(p.level, g);
  }
  return [...byLevel.values()].sort((a, b) => a.level - b.level);
}
