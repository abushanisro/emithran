'use client';

import {
  MULTI_SPINDLE_SCENARIO_KEYS, barLine, lengthPerPartLine, multiSpindleRouteOf, type MultiSpindleSummary,
} from '@/lib/costing/multi-spindle-view';

import type { ReactNode } from 'react';

interface Props {
  multiSpindle: MultiSpindleSummary | null | undefined;
  /** The part's scenario overrides (unset keys: the engine decides). */
  overrides: Record<string, unknown> | null | undefined;
  /** Writes one scenario key; null clears it. */
  onChange: (patch: Record<string, string | number | null>) => void;
}

const rowClass = 'flex items-start gap-2 py-0.5';
const labelClass = 'text-xs text-muted-foreground w-24 shrink-0';
const controlClass = 'flex-1 min-w-0 text-xs border border-border rounded px-2 py-1 bg-background focus:outline-hidden focus:ring-1 focus:ring-primary/40';
const kg = (v: number | null) => (v == null ? '—' : `${v} kg`);

function Field({ label, title, children }: { label: string; title?: string; children: ReactNode }) {
  return (
    <div className={rowClass} title={title}>
      <span className={labelClass}>{label}</span>
      <span className="flex-1 min-w-0 tabular-nums">{children}</span>
    </div>
  );
}

/**
 * The Cost Guide's multi-spindle panel: the bar the part is made from (snapped to the location's preferred sizes: inch in USA, metric
 * elsewhere), what each part takes of it, and the routes the engine compared (the cheapest complete one quoted unless one is set here).
 * The machine and its station plan are in the Simultaneous Turning line's calculation on the Cost tab (its slowest station and index);
 * the stock form is the Blank Stock section's.
 */
export function MultiSpindleSection({ multiSpindle: m, overrides, onChange }: Props) {
  const forced = multiSpindleRouteOf(overrides);
  if (!m) return <p className="text-xs text-muted-foreground">Not costed on a multi-spindle yet: see the warning on the Cost tab.</p>;
  const bar = m.bar;
  return (
    <div className="space-y-1 text-xs">
      <div className={rowClass}>
        <span className={labelClass}>Route</span>
        <select
          className={`${controlClass} cursor-pointer`}
          value={forced ?? ''}
          onChange={(e) => { onChange({ [MULTI_SPINDLE_SCENARIO_KEYS.route]: e.target.value || null }); }}
          title="Auto quotes the cheapest complete route; a route set here is quoted even when another is cheaper."
        >
          <option value="">Auto (cheapest{!forced ? `: ${m.routeLabel}` : ''})</option>
          {m.options.map((o) => <option key={o.route} value={o.route}>{o.label}</option>)}
        </select>
      </div>

      <Field label="Bar" title="The part's OD (or across flats) plus the stock allowance on each side, snapped up to the location's preferred bar size.">
        {barLine(bar)}
        <span className="block text-muted-foreground">
          {bar.unitSystem === 'US' ? 'Inch sizes (USA)' : 'Metric sizes'} · allowance {bar.allowancePerSideMm} mm a side
        </span>
      </Field>
      <Field label="Per part" title="The bar each part takes: its length, the parting tool's width and the facing stock.">
        {lengthPerPartLine(bar)}
        {m.partsPerBar != null && (
          <span className="block text-muted-foreground">{m.partsPerBar} parts per {bar.barLengthMm} mm bar, {bar.remnantMm} mm remnant left in the feeder</span>
        )}
      </Field>
      <Field label="Material" title="The bar bought per part (its share of a whole bar, remnant included) against the part's own mass.">
        {kg(m.materialMassKg)} of bar for a {kg(m.partMassKg)} part
        {m.stockPricePerKg != null && <span className="block text-muted-foreground">{m.stockPricePerKg} USD/kg</span>}
        {m.stockMissing && <span className="block text-amber-600">Not costed: {m.stockMissing}</span>}
      </Field>

      <Field label="Routes">
        {m.options.map((o) => (
          <span key={o.route} className={`block ${o.route === m.route ? 'text-foreground' : 'text-muted-foreground'}`} title={o.reason ?? undefined}>
            {o.label}{o.totalCost != null ? ` · ${o.totalCost.toFixed(2)}` : ' · not costed'}
            {o.totalCost == null && o.reason && <span className="block text-[11px] leading-snug">{o.reason.length > 140 ? `${o.reason.slice(0, 140)}…` : o.reason}</span>}
          </span>
        ))}
      </Field>
    </div>
  );
}
