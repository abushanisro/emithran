'use client';

import { useState } from 'react';

import { NumberField } from '@/components/costing/NumberField';
import { FORGING_SCENARIO_KEYS, forgingOverrideCount, formatForming, parseBlows, type ForgingSummary } from '@/lib/costing/forging-view';
import { parsePositive } from '@/lib/costing/sand-scenario';

interface Props {
  forging: ForgingSummary | null | undefined;
  /** The part's scenario overrides (unset keys: the engine decides). */
  overrides: Record<string, unknown> | null | undefined;
  /** Writes one scenario key; null clears it. */
  onChange: (patch: Record<string, string | number | null>) => void;
}

const rowClass = 'flex items-center gap-2 py-0.5';
const labelClass = 'text-xs text-muted-foreground w-24 shrink-0';
const controlClass = 'flex-1 min-w-0 text-xs border border-border rounded px-2 py-1 bg-background focus:outline-hidden focus:ring-1 focus:ring-primary/40';

/**
 * The Cost Guide's forging settings. Every one is the engine's until set: complexity, the bar, the heating, the blows and the flash land, each
 * field showing the engine's value as its placeholder. The mult length and the forming force are results, shown, not set. The routes are
 * compared and picked in the Workflow Builder (Process Routing: Manual).
 */
export function ForgingSection({ forging, overrides, onChange }: Props) {
  const number = (key: string) => (typeof overrides?.[key] === 'number' ? overrides[key] : null);
  const text = (key: string) => (typeof overrides?.[key] === 'string' ? overrides[key] : '');
  const set = (key: string) => (v: string | number | null) => { onChange({ [key]: v }); };
  const overridden = forgingOverrideCount(overrides);
  const [open, setOpen] = useState(overridden > 0);
  const complexity = number(FORGING_SCENARIO_KEYS.complexity);
  return (
    <div className="space-y-1 text-xs">
      {/* The part complexity score sets the flash the forging carries and the pressure its finishing blow needs (memory/Forging
          partComplexityBasedData). Unset, the data's least score for a 3D part is used and the Cost tab says so. */}
      <div className={rowClass}>
        <span className={labelClass}>Complexity</span>
        <select
          className={`${controlClass} cursor-pointer`}
          value={complexity != null ? String(complexity) : ''}
          onChange={(e) => { set(FORGING_SCENARIO_KEYS.complexity)(e.target.value ? Number(e.target.value) : null); }}
          title="1 simple to 12 complex: the flash the forging carries and the pressure of its finishing blow (partComplexityBasedData)."
        >
          <option value="">{`Default (${forging?.complexity ?? 7})`}</option>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>

      {forging && (
        <>
          <div className={rowClass}>
            <span className={labelClass}>Quoted</span>
            <span className="flex-1 min-w-0 text-foreground">{forging.routeLabel}</span>
          </div>
          <details open={open} onToggle={(e) => { setOpen(e.currentTarget.open); }}>
            <summary className="cursor-pointer select-none text-[11px] text-muted-foreground" title="Each setting is the engine's until you set it; empty a field to give it back to the engine.">
              Forging settings: {overridden > 0 ? `${overridden} overridden` : 'automatic'} · <span className="font-medium text-primary hover:text-primary">Override</span>
            </summary>
            <div className="space-y-1 pt-1">
              <NumberField
                label="Bar Ø, mm"
                value={number(FORGING_SCENARIO_KEYS.barDiameterMm)}
                placeholder={String(forging.barDiameterMm)}
                parse={parsePositive}
                onCommit={set(FORGING_SCENARIO_KEYS.barDiameterMm)}
                title="The round bar the mults are sawn from. Empty: the thinnest bar that keeps the mult within the billet ratio range (roundBarSizes)."
              />
              <div className={rowClass} title="The mult's length follows from the bar and the metal it carries.">
                <span className={labelClass}>Mult length</span>
                <span className="flex-1 tabular-nums">{forging.multLengthMm} mm</span>
              </div>
              <div className={rowClass}>
                <span className={labelClass}>Heating</span>
                <select
                  className={`${controlClass} cursor-pointer`}
                  value={text(FORGING_SCENARIO_KEYS.heating)}
                  onChange={(e) => { set(FORGING_SCENARIO_KEYS.heating)(e.target.value || null); }}
                  title="Empty: induction when the bar and mult suit a coil, else a gas furnace."
                >
                  <option value="">{`Auto (${forging.heating === 'induction' ? 'induction' : 'gas furnace'})`}</option>
                  <option value="induction">Induction</option>
                  <option value="furnace">Gas furnace</option>
                </select>
              </div>
              <NumberField
                label="Blows"
                value={number(FORGING_SCENARIO_KEYS.hits)}
                placeholder={String(forging.hits)}
                parse={parseBlows}
                onCommit={set(FORGING_SCENARIO_KEYS.hits)}
                title="Blows of the screw press and the hammer. Empty: the data's (baseNumberOfHits, less the stages the plant disables). A mechanical press strikes once per station."
              />
              <div className={rowClass} title="The force (or, on a hammer, the blow energy) the forming step needs, from the settings above.">
                <span className={labelClass}>Forming</span>
                <span className="flex-1 tabular-nums">{formatForming(forging.forming)}</span>
              </div>
              {forging.flash && (
                <>
                  <NumberField
                    label="Flash thick, mm"
                    value={number(FORGING_SCENARIO_KEYS.flashThicknessMm)}
                    placeholder={String(forging.flash.thicknessMm)}
                    parse={parsePositive}
                    onCommit={set(FORGING_SCENARIO_KEYS.flashThicknessMm)}
                    title="The flash land thickness: what the trim shears. Empty: Vieregge's rule for the forged mass."
                  />
                  <NumberField
                    label="Flash width, mm"
                    value={number(FORGING_SCENARIO_KEYS.flashWidthMm)}
                    placeholder={String(forging.flash.widthMm)}
                    parse={parsePositive}
                    onCommit={set(FORGING_SCENARIO_KEYS.flashWidthMm)}
                    title="The flash land width: it adds to the area the finishing force acts on. Empty: Vieregge's rule for the forged mass."
                  />
                </>
              )}
            </div>
          </details>
        </>
      )}
    </div>
  );
}
