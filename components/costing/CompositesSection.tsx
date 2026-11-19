'use client';

import { NumberField } from '@/components/costing/NumberField';
import { COMPOSITES_SCENARIO_KEYS, parsePlyCount, plyGroups, type CompositesSummary } from '@/lib/costing/composites-view';

interface Props {
  composites: CompositesSummary | null | undefined;
  /** The part's scenario overrides (unset keys: the engine decides). */
  overrides: Record<string, unknown> | null | undefined;
  /** Writes one scenario key; null clears it. */
  onChange: (patch: Record<string, string | number | null>) => void;
}

const rowClass = 'flex items-start gap-2 py-0.5';
const labelClass = 'text-xs text-muted-foreground w-24 shrink-0';
const controlClass = 'flex-1 min-w-0 text-xs border border-border rounded px-2 py-1 bg-background focus:outline-hidden focus:ring-1 focus:ring-primary/40';
const area = (mm2: number) => `${Math.round(mm2).toLocaleString('en-US')} mm²`;

/**
 * The Cost Guide's composites settings and what the engine read from the laminate. The plies are the laminate's thickness over the material's
 * cured ply thickness, a ply covering the region at least as thick as its place in the stack (drop-offs); a level rising by the core stock's
 * thickness is a honeycomb core. The ply count and the core can be set over the engine's; the layup route is picked in the Workflow Builder.
 */
export function CompositesSection({ composites: c, overrides, onChange }: Props) {
  const plyCount = typeof overrides?.[COMPOSITES_SCENARIO_KEYS.plyCount] === 'number' ? (overrides[COMPOSITES_SCENARIO_KEYS.plyCount] as number) : null;
  const core = overrides?.[COMPOSITES_SCENARIO_KEYS.core] === 'none' ? 'none' : '';
  const set = (key: string) => (v: string | number | null) => { onChange({ [key]: v }); };
  const geometryPlies = c ? (c.plySource === 'geometry' ? c.plies.length : null) : null;
  return (
    <div className="space-y-1 text-xs">
      <NumberField
        label="Plies"
        value={plyCount}
        placeholder={geometryPlies != null ? String(geometryPlies) : 'from the laminate'}
        parse={parsePlyCount}
        onCommit={set(COMPOSITES_SCENARIO_KEYS.plyCount)}
        title="Plies at the laminate's thickest. Empty: the laminate's thickness over the material's cured ply thickness."
      />
      <div className={rowClass}>
        <span className={labelClass}>Core</span>
        <select
          className={`${controlClass} cursor-pointer`}
          value={core}
          onChange={(e) => { set(COMPOSITES_SCENARIO_KEYS.core)(e.target.value || null); }}
          title="Auto: a region rising over the laminate by the honeycomb stock's thickness is a core. None: every thickness is plies."
        >
          <option value="">Auto (honeycomb where the laminate rises by the core stock)</option>
          <option value="none">None: solid laminate</option>
        </select>
      </div>

      {c && (
        <>
          <div className={rowClass}>
            <span className={labelClass}>Quoted</span>
            <span className="flex-1 min-w-0 text-foreground">{c.routeLabel}</span>
          </div>
          <div className={rowClass} title="The laminate at its thickest (any core excluded), over the cured thickness of one ply of the material.">
            <span className={labelClass}>Laminate</span>
            <span className="flex-1 tabular-nums">{c.laminateMm} mm · {c.plyThicknessMm} mm per ply</span>
          </div>
          <div className={rowClass} title="Each ply covers the region of the part at least as thick as its place in the stack: thinner regions get fewer plies (drop-offs).">
            <span className={labelClass}>Ply stack</span>
            <span className="flex-1 tabular-nums space-y-0.5">
              {plyGroups(c.plies).map((g) => (
                <span key={g.level} className="block">
                  {g.count} {g.count === 1 ? 'ply' : 'plies'} over {area(g.areaMm2)}{g.level > 0 ? ` (drop-off ${g.level})` : ''}
                </span>
              ))}
              {c.plySource === 'scenario' && <span className="block text-muted-foreground">count set in the Cost Guide</span>}
            </span>
          </div>
          <div className={rowClass} title="A honeycomb core placed by hand: its area, outline and depth.">
            <span className={labelClass}>Core</span>
            <span className="flex-1 tabular-nums">{c.core ? `${area(c.core.areaMm2)} · ${c.core.depthMm} mm deep` : 'none'}</span>
          </div>
          <div className={rowClass} title="Parts sharing one autoclave cycle: a share of its length when the autoclave is shared with other work (autoclavesIsShared).">
            <span className={labelClass}>Autoclave load</span>
            <span className="flex-1 tabular-nums">{c.partsPerLoad != null ? `${c.partsPerLoad} parts per cycle` : 'no autoclave takes the tool'}</span>
          </div>
          <div className={rowClass} title="Prepreg bought for one part (plies with their trim, over the material's utilization) and the plies' mass.">
            <span className={labelClass}>Prepreg</span>
            <span className="flex-1 tabular-nums">{c.boughtAreaM2} m² bought · {c.plyMassKg} kg laid</span>
          </div>
          <div className={rowClass}>
            <span className={labelClass}>Routes</span>
            <span className="flex-1 min-w-0 space-y-0.5">
              {c.options.map((o) => (
                <span key={o.route} className={`block ${o.route === c.route ? 'text-foreground' : 'text-muted-foreground'}`} title={o.reason ?? undefined}>
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
