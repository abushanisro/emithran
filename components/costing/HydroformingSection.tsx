'use client';

import {
  HYDROFORMING_ROUTE_OPTIONS, HYDROFORMING_SCENARIO_KEYS, hydroformRouteOf, intensifierOf, partsPerTrayOf, ruleLine, trayLine,
  type HydroformingSummary, type HydroformingTooling,
} from '@/lib/costing/hydroforming-view';

interface Props {
  hydroforming: HydroformingSummary | null | undefined;
  /** The quoted route's hydroform tool and the offline blanking die (USD): investments spread over the job, kept out of the piece cost. */
  tooling?: HydroformingTooling | undefined;
  /** The part's scenario overrides (unset keys: the engine decides). */
  overrides: Record<string, unknown> | null | undefined;
  /** Writes one scenario key; null clears it. */
  onChange: (patch: Record<string, string | number | boolean | null>) => void;
}

const rowClass = 'flex items-start gap-2 py-0.5';
const labelClass = 'text-xs text-muted-foreground w-24 shrink-0';
const controlClass = 'flex-1 min-w-0 text-xs border border-border rounded px-2 py-1 bg-background focus:outline-hidden focus:ring-1 focus:ring-primary/40';
const n = (v: number) => (Math.round(v * 10) / 10).toLocaleString('en-US');

/**
 * The Cost Guide's Sheet Metal - Hydroforming panel: the route (memory's depth / width rule unless one is set here), the draws, the blank and
 * its nest on sheet stock, the press and its forming time, the parts formed a cycle on a fluid cell tray, the hand adjusting and the holes
 * pierced after forming, the hydroform tool and the blanking die (not costed), and both routes compared.
 */
export function HydroformingSection({ hydroforming: h, tooling, overrides, onChange }: Props) {
  const forced = hydroformRouteOf(overrides);
  const tray = partsPerTrayOf(overrides);
  const intensifier = intensifierOf(overrides);
  return (
    <div className="space-y-1 text-xs">
      <div className={rowClass}>
        <span className={labelClass}>Route</span>
        <select
          className={`${controlClass} cursor-pointer`}
          value={forced ?? ''}
          onChange={(e) => { onChange({ [HYDROFORMING_SCENARIO_KEYS.route]: e.target.value || null }); }}
          title="Auto: memory's rule (depth / width at or above fluidCellFormingRatioThreshold: Deep Draw, else Fluid Cell), when a press takes the part."
        >
          <option value="">Auto (memory&apos;s rule{h && !forced ? `: ${h.routeLabel}` : ''})</option>
          {HYDROFORMING_ROUTE_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
      </div>
      <div className={rowClass}>
        <span className={labelClass}>Tooling</span>
        <span className="flex-1 min-w-0 flex flex-wrap items-center gap-x-3 gap-y-1">
          <label className="flex items-center gap-1" title="Fluid Cell: the parts formed on the tray a cycle (the data's 1 when not set), capped by what fits on the tray.">
            parts per tray
            <input type="number" min={1} className="w-14 border border-border rounded px-1 py-0.5 bg-background" value={tray ?? ''} placeholder="1"
              onChange={(e) => { onChange({ [HYDROFORMING_SCENARIO_KEYS.partsPerTray]: e.target.value === '' ? null : Math.max(1, Math.floor(Number(e.target.value))) }); }} />
          </label>
          <label className="flex items-center gap-1 cursor-pointer" title="Add the intensifier to the hydroform tool (intensifierPercentageMultiplier of the tool). The data does not say when a tool needs one.">
            <input type="checkbox" checked={intensifier} onChange={(e) => { onChange({ [HYDROFORMING_SCENARIO_KEYS.intensifier]: e.target.checked || null }); }} />
            intensifier
          </label>
        </span>
      </div>

      {!h ? (
        <p className="text-xs text-muted-foreground">Not costed as a hydroformed part yet: see the warning on the Cost tab.</p>
      ) : (
        <>
          <div className={rowClass}>
            <span className={labelClass}>Quoted</span>
            <span className="flex-1 min-w-0 text-foreground">
              {h.routeLabel}{h.route === 'deep-draw' ? ` · ${h.draws} draw${h.draws === 1 ? '' : 's'}` : ''}
              {!h.complete && <span className="text-amber-600 dark:text-amber-400"> · incomplete (see the Cost tab)</span>}
            </span>
          </div>
          <div className={rowClass} title={`Memory's rule (fluidCellFormingRatioThreshold), read on the ${h.rule.basis === 'part' ? 'whole part' : 'drawn form'}.`}>
            <span className={labelClass}>Rule</span>
            <span className="flex-1 min-w-0 tabular-nums">{ruleLine(h.rule)}</span>
          </div>
          {h.route === 'deep-draw' && h.drawRatiosPct.length > 0 && (
            <div className={rowClass} title="Each draw's reduction of the blank (drawReductionPercentage, derated for high-strength material).">
              <span className={labelClass}>Draws</span>
              <span className="flex-1 tabular-nums">{h.drawRatiosPct.map((p) => `${n(p)} %`).join(' → ')}</span>
            </div>
          )}
          <div className={rowClass} title="The blank: the part's developed sheet, with the addendum trimmed after drawing, blanked and pierced on the offline press.">
            <span className={labelClass}>Blank</span>
            <span className="flex-1 tabular-nums">
              {Math.round(h.blank.areaMm2).toLocaleString('en-US')} mm² · {h.blank.massKg} kg{h.blank.addendumMm > 0 ? ` · addendum ${n(h.blank.addendumMm)} mm` : ''}
              {h.nest && (
                <span className="block text-muted-foreground">
                  {h.nest.partsPerSheet} a {h.nest.sheetLengthMm} x {h.nest.sheetWidthMm} mm sheet ({h.nest.method === 'true_shape' ? 'true-shape' : 'rectangular'} nest, {n(h.nest.utilizationPct)} % used)
                </span>
              )}
            </span>
          </div>
          {h.press && (
            <div className={rowClass}>
              <span className={labelClass}>Press</span>
              <span className="flex-1 min-w-0">{h.press.name} · forms in {n(h.press.formingCycleTimeS)} s</span>
            </div>
          )}
          {h.partsPerTray && (
            <div className={rowClass}>
              <span className={labelClass}>Tray</span>
              <span className="flex-1 tabular-nums">{trayLine(h.partsPerTray)}</span>
            </div>
          )}
          {(h.handAdjustingLengthMm > 0 || h.throwPadAreaMm2 > 0) && (
            <div className={rowClass} title="Hand adjusting: curved flanges the press cannot finish. Throw pad: the pad laid on a fluid cell part before forming.">
              <span className={labelClass}>By hand</span>
              <span className="flex-1 tabular-nums">
                {[h.handAdjustingLengthMm > 0 ? `hand adjusting ${n(h.handAdjustingLengthMm)} mm` : null, h.throwPadAreaMm2 > 0 ? `throw pad ${Math.round(h.throwPadAreaMm2).toLocaleString('en-US')} mm²` : null].filter(Boolean).join(' · ')}
              </span>
            </div>
          )}
          {h.holes.pierced > 0 && (
            <div className={rowClass} title="Memory's Offline Blank pierces every hole with the blank, a hole in a wall the forming then shapes too. A hole with a position tolerance under toleranceLooseThresholdHole would be trimmed after forming (not modelled).">
              <span className={labelClass}>Holes</span>
              <span className="flex-1 tabular-nums">
                {h.holes.pierced} pierced with the blank{h.cappingTools > 0 ? ` (${h.cappingTools} capped)` : ''}
                {h.holes.inFormedWalls > 0 && <span className="block text-muted-foreground">{h.holes.inFormedWalls} of them in a formed wall</span>}
              </span>
            </div>
          )}
          {tooling && tooling.length > 0 && (
            <div className={rowClass} title="Investments kept out of the piece cost, spread over the job (annual volume x production life).">
              <span className={labelClass}>Tools</span>
              <span className="flex-1 min-w-0 space-y-0.5">
                {tooling.map((t) => (
                  <span key={t.key} className="block tabular-nums" title={t.detail}>
                    {t.description}: {t.costUsd != null ? `$${t.costUsd.toLocaleString('en-US')}` : 'not costed'}
                    {t.perPartUsd != null && <span className="text-muted-foreground"> · ${t.perPartUsd} a part</span>}
                    {t.costUsd == null && <span className="block text-muted-foreground">{t.detail.replace(/^Not costed: /, '')}</span>}
                  </span>
                ))}
              </span>
            </div>
          )}
          <div className={rowClass}>
            <span className={labelClass}>Routes</span>
            <span className="flex-1 min-w-0 space-y-0.5">
              {h.options.map((o) => (
                <span key={o.route} className={`block ${o.route === h.route ? 'text-foreground' : 'text-muted-foreground'}`} title={o.reason ?? undefined}>
                  {o.label}{o.totalCost != null ? ` · ${o.totalCost.toFixed(2)}` : o.reason ? ` · ${o.reason}` : ''}
                </span>
              ))}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
