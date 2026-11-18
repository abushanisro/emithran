import type { CostSummaryDto } from '@/lib/api/hooks/useBOMItems';

export type AdditiveSummary = NonNullable<CostSummaryDto['additive']>;

/** The scenario keys of the additive settings set over the engine's (backend additive-cost.service.ts ADDITIVE_*_KEY). */
export const ADDITIVE_SCENARIO_KEYS = {
  route: 'additiveRoute',
  buildDirection: 'additiveBuildDirection',
} as const;

/** The six directions the cad-engine measures a build along (backend additive-route.ts BUILD_AXES). */
export const BUILD_DIRECTIONS = ['+z', '-z', '+x', '-x', '+y', '-y'] as const;

/** The build direction set in the Cost Guide, or null: the engine's choice (least support at the material's angle). */
export function buildDirectionOf(overrides: Record<string, unknown> | null | undefined): string | null {
  const v = overrides?.[ADDITIVE_SCENARIO_KEYS.buildDirection];
  return typeof v === 'string' && (BUILD_DIRECTIONS as readonly string[]).includes(v) ? v : null;
}

/** A direction as the engineer reads it: "+z (Z up)". */
export function directionLabel(axis: string): string {
  const sign = axis.startsWith('-') ? 'down' : 'up';
  return `${axis} (${axis.slice(1).toUpperCase()} ${sign})`;
}
