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

const RAPID_PROTOTYPING = 'Rapid Prototyping';

/**
 * The Cost Guide section's title: the process group the part is priced in (backend additive-domain.ts), from the quote; before one exists,
 * the part's own Process when it is Rapid Prototyping, else Additive Manufacturing.
 */
export function additiveSectionTitle(additive: AdditiveSummary | null | undefined, processGroup: unknown): string {
  return additive?.processGroup ?? (processGroup === RAPID_PROTOTYPING ? RAPID_PROTOTYPING : 'Additive Manufacturing');
}

/** A cleaned hole's or void's size as the engineer reads it: a hole by its diameter, a void by its volume. */
export function cleaningSizeLabel(f: Pick<AdditiveSummary['cleaning'][number], 'measure' | 'size'>): string {
  return f.measure === 'diameter' ? `Ø ${Math.round(f.size * 10) / 10} mm` : `${Math.round(f.size).toLocaleString('en-US')} mm³`;
}

/** A direction as the engineer reads it: "+z (Z up)". */
export function directionLabel(axis: string): string {
  const sign = axis.startsWith('-') ? 'down' : 'up';
  return `${axis} (${axis.slice(1).toUpperCase()} ${sign})`;
}
