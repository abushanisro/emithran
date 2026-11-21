import type { BOMItem, CostSummaryDto } from '@/lib/api/hooks/useBOMItems';

export type HydroformingSummary = NonNullable<CostSummaryDto['hydroforming']>;
export type HydroformingTooling = NonNullable<CostSummaryDto['hydroformingTooling']>;

/** The process group of hydroforming (backend part-family-process-group.ts HYDROFORMING_PROCESS_GROUP). */
export const HYDROFORMING_PROCESS_GROUP = 'Sheet Metal - Hydroforming';

/** Whether an item is hydroformed: its Process is Sheet Metal - Hydroforming (the backend's isHydroforming). */
export function isHydroformingItem(item: Pick<BOMItem, 'scenarioOverrides'> | null | undefined): boolean {
  return item?.scenarioOverrides?.processGroup === HYDROFORMING_PROCESS_GROUP;
}

/** The Cost Guide keys of a hydroformed part (backend hydroforming-route.ts HYDROFORMING_KEYS). */
export const HYDROFORMING_SCENARIO_KEYS = { route: 'hydroformRoute', partsPerTray: 'hydroformPartsPerTray', intensifier: 'hydroformIntensifier' } as const;

/** The two routes (backend hydroforming-route.ts HYDROFORMING_ROUTES). */
export const HYDROFORMING_ROUTE_OPTIONS = [
  { key: 'deep-draw', label: 'Hydroform Deep Draw' },
  { key: 'fluid-cell', label: 'Hydroform Fluid Cell' },
] as const;

/** The route set in the Cost Guide, or null: the engine quotes the route memory's depth / width rule gives. */
export function hydroformRouteOf(overrides: Record<string, unknown> | null | undefined): string | null {
  const v = overrides?.[HYDROFORMING_SCENARIO_KEYS.route];
  return typeof v === 'string' && HYDROFORMING_ROUTE_OPTIONS.some((o) => o.key === v) ? v : null;
}

/** The parts per tray set in the Cost Guide (a whole number, at least 1), or null: the data's default. The backend reads it the same way. */
export function partsPerTrayOf(overrides: Record<string, unknown> | null | undefined): number | null {
  const raw = overrides?.[HYDROFORMING_SCENARIO_KEYS.partsPerTray];
  const v = Number(raw);
  return raw != null && raw !== '' && Number.isFinite(v) && v >= 1 ? Math.floor(v) : null;
}

/** Whether the Cost Guide includes the intensifier in the tool (off unless set). */
export function intensifierOf(overrides: Record<string, unknown> | null | undefined): boolean {
  const v = overrides?.[HYDROFORMING_SCENARIO_KEYS.intensifier];
  return v === true || v === 'true';
}

/** Memory's rule as an engineer reads it: "depth / width 60 / 80 = 0.75 ≥ 0.65 → Hydroform Deep Draw". */
export function ruleLine(rule: HydroformingSummary['rule']): string {
  const label = HYDROFORMING_ROUTE_OPTIONS.find((o) => o.key === rule.route)?.label ?? rule.route;
  const n = (v: number) => (Math.round(v * 10) / 10).toLocaleString('en-US');
  return `depth / width ${n(rule.depthMm)} / ${n(rule.widthMm)} = ${rule.ratio.toFixed(2)} ${rule.ratio >= rule.threshold ? '≥' : '<'} ${rule.threshold} → ${label}`;
}

/** The parts formed a cycle, with where the number comes from (Fluid Cell only). */
export function trayLine(tray: NonNullable<HydroformingSummary['partsPerTray']>): string {
  const source = tray.requested != null
    ? tray.requested > tray.value ? `${tray.requested} asked, ${tray.value} fit the tray` : 'set in the Cost Guide'
    : "the data's default";
  return `${tray.value} per cycle (${source}${tray.max != null ? `; the tray holds ${tray.max}` : ''})`;
}
