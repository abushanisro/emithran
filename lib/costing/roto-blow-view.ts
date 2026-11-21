import type { CostSummaryDto } from '@/lib/api/hooks/useBOMItems';

export type RotoBlowSummary = NonNullable<CostSummaryDto['rotoBlow']>;

/** The Cost Guide keys of a blow molded or rotomolded part (backend roto-blow-cost.service.ts ROTO_BLOW_KEYS). */
export const ROTO_BLOW_SCENARIO_KEYS = {
  route: 'rotoBlowRoute', colored: 'rotoBlowColored', labels: 'rotoBlowLabels', inserts: 'rotoBlowInserts', ovenTime: 'rotoOvenTimeS',
} as const;

/** The two routes (backend roto-blow-route.ts ROTO_BLOW_ROUTES). */
export const ROTO_BLOW_ROUTE_OPTIONS = [
  { key: 'blow', label: 'Extrusion blow molding' },
  { key: 'roto', label: 'Rotational molding' },
] as const;

/** The route set in the Cost Guide, or null: the engine quotes the cheapest complete one. */
export function rotoBlowRouteOf(overrides: Record<string, unknown> | null | undefined): string | null {
  const v = overrides?.[ROTO_BLOW_SCENARIO_KEYS.route];
  return typeof v === 'string' && ROTO_BLOW_ROUTE_OPTIONS.some((o) => o.key === v) ? v : null;
}

/** A whole number set in the Cost Guide (labels, inserts), or null when none is set. */
export function countOf(overrides: Record<string, unknown> | null | undefined, key: string): number | null {
  const v = Number(overrides?.[key]);
  return overrides?.[key] != null && overrides[key] !== '' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null;
}

/** A volume as an engineer reads it: litres above one, else cm³. */
export function volumeLabel(mm3: number): string {
  return mm3 >= 1e6 ? `${(Math.round(mm3 / 1e4) / 100).toLocaleString('en-US')} L` : `${Math.round(mm3 / 1000).toLocaleString('en-US')} cm³`;
}
