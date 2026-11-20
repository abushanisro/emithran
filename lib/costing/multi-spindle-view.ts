import type { BOMItem, CostSummaryDto } from '@/lib/api/hooks/useBOMItems';

export type MultiSpindleSummary = NonNullable<CostSummaryDto['multiSpindle']>;

/** The process group of multi-spindle machining (backend part-family-process-group.ts MULTI_SPINDLE_PROCESS_GROUP). */
export const MULTI_SPINDLE_PROCESS_GROUP = 'Multi-Spindle Machining';

/** Whether an item is made on a multi-spindle: its Process is Multi-Spindle Machining (the backend's isMultiSpindle). */
export function isMultiSpindleItem(item: Pick<BOMItem, 'scenarioOverrides'> | null | undefined): boolean {
  return item?.scenarioOverrides?.processGroup === MULTI_SPINDLE_PROCESS_GROUP;
}

/** The scenario key of the multi-spindle route set over the engine's choice (backend multi-spindle-cost.service.ts MULTI_SPINDLE_ROUTE_KEY). */
export const MULTI_SPINDLE_SCENARIO_KEYS = { route: 'multiSpindleRoute' } as const;

/** The route set in the Cost Guide, or null: the engine quotes the cheapest complete one. */
export function multiSpindleRouteOf(overrides: Record<string, unknown> | null | undefined): string | null {
  const v = overrides?.[MULTI_SPINDLE_SCENARIO_KEYS.route];
  return typeof v === 'string' && v ? v : null;
}

const mm = (n: number) => `${Number.isInteger(n) ? String(n) : n.toFixed(2)} mm`;

/** The bar in one line: its size and form, then what the part needed of it ("5/8" round bar · needs 15.62 mm"). */
export function barLine(bar: MultiSpindleSummary['bar']): string {
  return `${bar.sizeLabel} · needs ${mm(bar.requiredMm)}${bar.snapped ? '' : ' (as supplied)'}`;
}

/** What each part takes of the bar: its length with the parting tool and the facing stock. */
export function lengthPerPartLine(bar: MultiSpindleSummary['bar']): string {
  return `${mm(bar.lengthPerPartMm)} (parting ${mm(bar.partingWidthMm)}, facing ${mm(bar.facingStockMm)})`;
}
