'use client';

import {
  BAR_TUBE_SCENARIO_KEYS, barTubeRouteOf, sectionLabel, stockFormLabel, toolKeyLabel, type BarTubeSummary,
} from '@/lib/costing/bar-tube-view';

interface Props {
  barTube: BarTubeSummary | null | undefined;
  /** The quoted route's tools (USD): an investment each, spread over the job, kept out of the piece cost. */
  tooling?: { key: string; description: string; detail: string; costUsd: number | null; perPartUsd: number | null }[] | undefined;
  /** The part's scenario overrides (unset keys: the engine decides). */
  overrides: Record<string, unknown> | null | undefined;
  /** Writes one scenario key; null clears it. */
  onChange: (patch: Record<string, string | number | null>) => void;
}

const rowClass = 'flex items-start gap-2 py-0.5';
const labelClass = 'text-xs text-muted-foreground w-24 shrink-0';
const controlClass = 'flex-1 min-w-0 text-xs border border-border rounded px-2 py-1 bg-background focus:outline-hidden focus:ring-1 focus:ring-primary/40';
const n = (v: number) => (Math.round(v * 10) / 10).toLocaleString('en-US');

/**
 * The Cost Guide's bar and tube panel: the stock the cad-engine read (form, section, length, parts per stock length), each bend with the
 * method that makes it, the end cuts, forms and openings, and the routes the engine compared (the cheapest complete one quoted unless one is
 * set here).
 */
export function BarTubeSection({ barTube: b, tooling, overrides, onChange }: Props) {
  const forced = barTubeRouteOf(overrides);
  if (!b) return <p className="text-xs text-muted-foreground">Not costed as bar or tube yet: see the warning on the Cost tab.</p>;
  const ends = b.ends.filter((e) => e.variant !== 'square');
  return (
    <div className="space-y-1 text-xs">
      <div className={rowClass}>
        <span className={labelClass}>Route</span>
        <select
          className={`${controlClass} cursor-pointer`}
          value={forced ?? ''}
          onChange={(e) => { onChange({ [BAR_TUBE_SCENARIO_KEYS.route]: e.target.value || null }); }}
          title="Auto quotes the cheapest complete route; a route set here is quoted even when another is cheaper."
        >
          <option value="">Auto (cheapest{!forced ? `: ${b.routeLabel}` : ''})</option>
          {b.options.map((o) => <option key={o.route} value={o.route}>{o.label}</option>)}
        </select>
      </div>

      <div className={rowClass} title="The section cut normal to the centreline (cad-engine bar_tube), and the stock form it is bought as.">
        <span className={labelClass}>{b.plate ? 'Plate' : 'Stock'}</span>
        <span className="flex-1 min-w-0 tabular-nums">
          {b.plate
            ? `${n(b.plate.thicknessMm)} mm plate · blank ${n(b.plate.blankLengthMm)} x ${n(b.plate.blankWidthMm)} mm · ${n(b.plate.cutLengthMm)} mm cut`
            : `${stockFormLabel(b.stockForm)} ${sectionLabel(b)} · ${n(b.developedLengthMm)} mm long`}
        </span>
      </div>
      <div className={rowClass} title="The stock bought per part: its share of a stock length (after the trim and the kerf), a sheet, or a billet.">
        <span className={labelClass}>Material</span>
        <span className="flex-1 min-w-0 tabular-nums">
          {b.materialMassKg} kg per part{b.partsPerStock != null ? ` · ${b.partsPerStock} per ${b.plate ? 'sheet' : b.stockForm === 'GENERIC_EXTRUSION' ? 'billet' : 'length'}` : ''}
          {b.stockMissing && <span className="block text-amber-600">Not costed: {b.stockMissing}</span>}
        </span>
      </div>

      {b.bendPlan.length > 0 && (
        <div className={rowClass}>
          <span className={labelClass}>Bends</span>
          <ul className="flex-1 min-w-0 space-y-0.5">
            {b.bendPlan.map((p) => (
              <li key={p.index} className="tabular-nums" title={p.reason ?? toolKeyLabel(p.toolKey) ?? undefined}>
                {p.index + 1}. {n(p.clrMm)} mm CLR, {n(p.angleDeg)}° ·{' '}
                {p.method
                  ? <span className="text-foreground">{p.method}{p.toolKey ? ` (${p.toolKey}${p.mandrel ? ', mandrel' : ''})` : ''}</span>
                  : <span className="text-amber-600">no method can make it</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {(ends.length > 0 || b.forms.length > 0 || b.holeCount > 0 || b.openingCount > 0) && (
        <div className={rowClass} title="Read from the part: end cuts other than square, end forms, and openings through the wall.">
          <span className={labelClass}>Features</span>
          <span className="flex-1 min-w-0">
            {[
              ...ends.map((e) => `${e.end} ${e.variant}${e.cutAngleDeg ? ` ${n(e.cutAngleDeg)}°` : ''}`),
              ...b.forms.map((f) => `${f.end} ${f.variant}`),
              ...(b.holeCount ? [`${b.holeCount} hole${b.holeCount === 1 ? '' : 's'}`] : []),
              ...(b.openingCount ? [`${b.openingCount} opening${b.openingCount === 1 ? '' : 's'}`] : []),
            ].join(' · ')}
          </span>
        </div>
      )}

      {tooling && tooling.length > 0 && (
        <div className={rowClass}>
          <span className={labelClass}>Tooling</span>
          <ul className="flex-1 min-w-0 space-y-0.5">
            {tooling.map((t) => (
              <li key={t.key} className="tabular-nums" title={t.detail}>
                {t.description} ·{' '}
                {t.costUsd != null
                  ? `${t.costUsd.toLocaleString('en-US')} USD${t.perPartUsd != null ? ` (${t.perPartUsd.toFixed(4)} per part)` : ''}`
                  : <span className="text-amber-600">not priced</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className={rowClass}>
        <span className={labelClass}>Routes</span>
        <span className="flex-1 min-w-0 space-y-0.5">
          {b.options.map((o) => (
            <span key={o.route} className={`block ${o.route === b.route ? 'text-foreground' : 'text-muted-foreground'}`} title={o.reason ?? undefined}>
              {o.label}{o.totalCost != null ? ` · ${o.totalCost.toFixed(2)}` : ' · not costed'}
              {o.totalCost == null && o.reason && <span className="block text-[11px] leading-snug">{o.reason.length > 140 ? `${o.reason.slice(0, 140)}…` : o.reason}</span>}
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}
