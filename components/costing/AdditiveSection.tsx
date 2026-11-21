'use client';

import { ADDITIVE_SCENARIO_KEYS, BUILD_DIRECTIONS, buildDirectionOf, cleaningSizeLabel, directionLabel, type AdditiveSummary } from '@/lib/costing/additive-view';

interface Props {
  additive: AdditiveSummary | null | undefined;
  /** The part's scenario overrides (unset keys: the engine decides). */
  overrides: Record<string, unknown> | null | undefined;
  /** Writes one scenario key; null clears it. */
  onChange: (patch: Record<string, string | number | null>) => void;
}

const rowClass = 'flex items-start gap-2 py-0.5';
const labelClass = 'text-xs text-muted-foreground w-24 shrink-0';
const controlClass = 'flex-1 min-w-0 text-xs border border-border rounded px-2 py-1 bg-background focus:outline-hidden focus:ring-1 focus:ring-primary/40';
const mm = (v: number) => `${Math.round(v * 10) / 10} mm`;
const area = (v: number) => `${Math.round(v).toLocaleString('en-US')} mm²`;
const volume = (v: number) => `${Math.round(v).toLocaleString('en-US')} mm³`;

/**
 * The Cost Guide's additive settings and what the engine read from the build (Additive Manufacturing and Rapid Prototyping alike). The part is
 * built along the direction that needs the least support at its material's self-supporting angle (or the one set here); the material decides
 * the route (a metal powder is sintered, a resin cured, ...), and as many parts as the bed takes share one build. A Rapid Prototyping part's
 * cleaning is timed per hole and void, each listed with its size, depth and time.
 */
export function AdditiveSection({ additive: a, overrides, onChange }: Props) {
  const forced = buildDirectionOf(overrides);
  return (
    <div className="space-y-1 text-xs">
      <div className={rowClass}>
        <span className={labelClass}>Build direction</span>
        <select
          className={`${controlClass} cursor-pointer`}
          value={forced ?? ''}
          onChange={(e) => { onChange({ [ADDITIVE_SCENARIO_KEYS.buildDirection]: e.target.value || null }); }}
          title="The direction the part is built along (the plate below, layers stacked along it). Auto: the one needing the least support, then the lowest."
        >
          <option value="">Auto (least support{a && !forced ? `: ${a.buildDirection}` : ''})</option>
          {BUILD_DIRECTIONS.map((d) => <option key={d} value={d}>{directionLabel(d)}</option>)}
        </select>
      </div>

      {a && (
        <>
          <div className={rowClass}>
            <span className={labelClass}>Quoted</span>
            <span className="flex-1 min-w-0 text-foreground">{a.routeLabel}</span>
          </div>
          <div className={rowClass} title={a.buildDirectionSource === 'engineer' ? 'Set above.' : `The direction of least overhang at the material's ${a.selfSupportingDeg} degree self-supporting angle (tblSelfSupportingAngles; 45 degrees for a material it does not list).`}>
            <span className={labelClass}>Built along</span>
            <span className="flex-1 tabular-nums">
              {a.buildDirection} · {mm(a.buildHeightMm)} tall{a.layers != null ? `, ${a.layers.toLocaleString('en-US')} layers` : ''}
              <span className="block text-muted-foreground">{a.buildDirectionSource === 'engineer' ? 'set in the Cost Guide' : `least support at ${a.selfSupportingDeg}°`}</span>
            </span>
          </div>
          <div className={rowClass} title="The part's footprint on the plate; as many footprints (with the nesting allowance) as the bed takes share one build and its fixed steps.">
            <span className={labelClass}>Per build</span>
            <span className="flex-1 tabular-nums">
              {a.partsPerBuild != null ? `${a.partsPerBuild} parts` : 'no machine takes the part'} · footprint {a.footprintMm.map((v) => Math.round(v)).join(' x ')} mm
            </span>
          </div>
          <div className={rowClass} title="Down-facing surface flatter than the self-supporting angle needs support; the supports' volume (and, under a metal part, its support base) is built and broken off.">
            <span className={labelClass}>Supports</span>
            <span className="flex-1 tabular-nums">
              {a.overhangAreaMm2 > 0 ? `${area(a.overhangAreaMm2)} of overhang` : 'no overhang'}
              {a.supportVolumeMm3 > 0 ? ` · ${volume(a.supportVolumeMm3)} of support` : ''}
            </span>
          </div>
          <div className={rowClass} title="The material bought for one part: the part, its supports and the powder lost or spent.">
            <span className={labelClass}>Material</span>
            <span className="flex-1 tabular-nums">{a.materialMassKg} kg per part</span>
          </div>
          {a.cleaning.length > 0 && (
            <div className={rowClass} title="The loose powder or uncured resin cleared from each hole and void: its type's base time, times multipliers of its size (a hole's diameter, a void's volume) and its depth. Added to the base time every part takes.">
              <span className={labelClass}>Cleaning</span>
              <span className="flex-1 min-w-0">
                <table className="w-full tabular-nums">
                  <tbody>
                    {a.cleaning.map((f) => (
                      <tr key={f.id}>
                        <td className="pr-2 text-foreground">{f.label}</td>
                        <td className="pr-2 text-muted-foreground">{cleaningSizeLabel(f)}</td>
                        <td className="pr-2 text-muted-foreground">{mm(f.depthMm)} deep</td>
                        <td className="text-right">{Math.round(f.timeSec * 10) / 10} s</td>
                      </tr>
                    ))}
                    <tr className="border-t border-border">
                      <td className="pt-0.5 text-muted-foreground" colSpan={3}>{a.cleaning.length} hole(s) and void(s)</td>
                      <td className="pt-0.5 text-right">{Math.round(a.cleaning.reduce((s, f) => s + f.timeSec, 0) * 10) / 10} s</td>
                    </tr>
                  </tbody>
                </table>
              </span>
            </div>
          )}
          <div className={rowClass}>
            <span className={labelClass}>Routes</span>
            <span className="flex-1 min-w-0 space-y-0.5">
              {a.options.map((o) => (
                <span key={o.route} className={`block ${o.route === a.route ? 'text-foreground' : 'text-muted-foreground'}`} title={o.reason ?? undefined}>
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
