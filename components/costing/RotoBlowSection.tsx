'use client';

import {
  ROTO_BLOW_ROUTE_OPTIONS, ROTO_BLOW_SCENARIO_KEYS, countOf, rotoBlowRouteOf, volumeLabel, type RotoBlowSummary,
} from '@/lib/costing/roto-blow-view';

interface Props {
  rotoBlow: RotoBlowSummary | null | undefined;
  /** The quoted route's molds and trim tooling (USD): an investment each, spread over the job, kept out of the piece cost. */
  tooling?: { key: string; description: string; detail: string; costUsd: number | null; perPartUsd: number | null }[] | undefined;
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
 * The Cost Guide's Roto & Blow Molding panel: the shell the cad-engine measured (envelope, wall, the air it closes in, its spouts), each
 * feature with the operation it takes, the parts per shot or per carousel arm, the molds and trim tooling, the routes compared (the cheapest
 * complete one quoted unless one is set here), and what the part is made with (colorant, labels, inserts, the oven time).
 */
export function RotoBlowSection({ rotoBlow: r, tooling, overrides, onChange }: Props) {
  const forced = rotoBlowRouteOf(overrides);
  const colored = overrides?.[ROTO_BLOW_SCENARIO_KEYS.colored] === true || overrides?.[ROTO_BLOW_SCENARIO_KEYS.colored] === 'true';
  const labels = countOf(overrides, ROTO_BLOW_SCENARIO_KEYS.labels);
  const inserts = countOf(overrides, ROTO_BLOW_SCENARIO_KEYS.inserts);
  const oven = countOf(overrides, ROTO_BLOW_SCENARIO_KEYS.ovenTime);
  const setCount = (key: string, value: string) => { onChange({ [key]: value === '' ? null : Math.max(0, Math.floor(Number(value))) }); };
  return (
    <div className="space-y-1 text-xs">
      <div className={rowClass}>
        <span className={labelClass}>Route</span>
        <select
          className={`${controlClass} cursor-pointer`}
          value={forced ?? ''}
          onChange={(e) => { onChange({ [ROTO_BLOW_SCENARIO_KEYS.route]: e.target.value || null }); }}
          title="Auto: the cheapest route the material allows and the part fits."
        >
          <option value="">Auto (cheapest{r && !forced ? `: ${r.routeLabel}` : ''})</option>
          {ROTO_BLOW_ROUTE_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
      </div>
      <div className={rowClass}>
        <span className={labelClass}>Made with</span>
        <span className="flex-1 min-w-0 flex flex-wrap items-center gap-x-3 gap-y-1">
          <label className="flex items-center gap-1 cursor-pointer" title="Colorant added to the resin (colorantCost a kg).">
            <input type="checkbox" checked={colored} onChange={(e) => { onChange({ [ROTO_BLOW_SCENARIO_KEYS.colored]: e.target.checked || null }); }} />
            colored
          </label>
          <label className="flex items-center gap-1" title="In-mold labels per part (defaultNumLabels when not set).">
            labels
            <input type="number" min={0} className="w-14 border border-border rounded px-1 py-0.5 bg-background" value={labels ?? ''} placeholder="0"
              onChange={(e) => { setCount(ROTO_BLOW_SCENARIO_KEYS.labels, e.target.value); }} />
          </label>
          <label className="flex items-center gap-1" title="Inserts molded into a rotomolded part (each placed at the load station, defaultInsertCost each).">
            inserts
            <input type="number" min={0} className="w-14 border border-border rounded px-1 py-0.5 bg-background" value={inserts ?? ''} placeholder="0"
              onChange={(e) => { setCount(ROTO_BLOW_SCENARIO_KEYS.inserts, e.target.value); }} />
          </label>
          <label className="flex items-center gap-1" title="A rotational mold's oven time (s). The reference holds no oven temperature, so it is taken as the cooling time unless set.">
            oven s
            <input type="number" min={0} className="w-16 border border-border rounded px-1 py-0.5 bg-background" value={oven ?? ''} placeholder={r?.coolingTimeS != null ? n(r.coolingTimeS) : ''}
              onChange={(e) => { setCount(ROTO_BLOW_SCENARIO_KEYS.ovenTime, e.target.value); }} />
          </label>
        </span>
      </div>

      {!r ? (
        <p className="text-xs text-muted-foreground">Not costed as a blow or roto molded part yet: see the warning on the Cost tab.</p>
      ) : (
        <>
          <div className={rowClass}>
            <span className={labelClass}>Quoted</span>
            <span className="flex-1 min-w-0 text-foreground">
              {r.routeLabel}{r.partsPerCycle != null ? ` · ${r.partsPerCycle} ${r.route === 'blow' ? 'per shot' : 'molds on the arm'}` : ''}
            </span>
          </div>
          <div className={rowClass} title="The part's envelope across the parting plane and along the pull, its wall, and the air the shell closes in.">
            <span className={labelClass}>Shell</span>
            <span className="flex-1 tabular-nums">
              {r.envelopeMm.map((v) => Math.round(v)).join(' x ')} mm · wall {n(r.wallMm)} mm · inside {volumeLabel(r.insideVolumeMm3)}
              {r.coolingTimeS != null && <span className="block text-muted-foreground">cools in {n(r.coolingTimeS)} s{r.partingLineMm != null ? ` · parting line ${Math.round(r.partingLineMm)} mm` : ''}</span>}
            </span>
          </div>
          {r.spouts.length > 0 && (
            <div className={rowClass}>
              <span className={labelClass}>Spout</span>
              <span className="flex-1 tabular-nums">{r.spouts.map((s) => `Ø ${n(s.diameterMm)} mm`).join(', ')}</span>
            </div>
          )}
          <div className={rowClass} title="The material bought for one part: the part, its flash and the plugs cut out of it.">
            <span className={labelClass}>Material</span>
            <span className="flex-1 tabular-nums">{r.materialMassKg} kg per part ({r.partMassKg} kg in the part)</span>
          </div>
          {r.features.length > 0 && (
            <div className={rowClass} title="Each CAD feature and the operation it takes, by the reference's thresholds.">
              <span className={labelClass}>Features</span>
              <span className="flex-1 min-w-0">
                <table className="w-full">
                  <tbody>
                    {r.features.map((f, i) => (
                      <tr key={`${f.id}:${f.operation}:${i}`} title={f.reason}>
                        <td className="pr-2 text-foreground">{f.featureType}</td>
                        <td className="pr-2">{f.operation}</td>
                        <td className="text-muted-foreground">{f.process}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </span>
            </div>
          )}
          {tooling && tooling.length > 0 && (
            <div className={rowClass} title="Molds and tools: investments kept out of the piece cost, spread over the job (annual volume x production life).">
              <span className={labelClass}>Tooling</span>
              <span className="flex-1 min-w-0 space-y-0.5">
                {tooling.map((t) => (
                  <span key={t.key} className="block tabular-nums" title={t.detail}>
                    {t.description}: {t.costUsd != null ? `$${t.costUsd.toLocaleString('en-US')}` : 'not priced'}
                    {t.perPartUsd != null && <span className="text-muted-foreground"> · ${t.perPartUsd} a part</span>}
                  </span>
                ))}
              </span>
            </div>
          )}
          <div className={rowClass}>
            <span className={labelClass}>Routes</span>
            <span className="flex-1 min-w-0 space-y-0.5">
              {r.options.map((o) => (
                <span key={o.route} className={`block ${o.route === r.route ? 'text-foreground' : 'text-muted-foreground'}`} title={o.reason ?? undefined}>
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
