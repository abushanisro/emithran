'use client';

import { useEffect, useState } from 'react';

import {
  SAND_CORE_PROCESSES,
  SAND_MOULDING_PROCESSES,
  SAND_SCENARIO_KEYS,
  choiceOf,
  parseCavities,
  parsePositive,
  type FieldCommit,
} from '@/lib/costing/sand-scenario';

interface SandCastingBreakdown {
  mouldingProcess: string;
  mouldingMachine: string;
  cavities: number;
  coresMade: number;
  coresLeftSolid: number;
  complete: boolean;
}

interface Props {
  /** The part's scenario overrides (the user's choices; unset keys are not shown as chosen). */
  overrides: Record<string, unknown> | null | undefined;
  /** What the route decided, when it could be built. */
  route: SandCastingBreakdown | undefined;
  /** Writes one scenario key; null clears it. */
  onChange: (patch: Record<string, string | number | null>) => void;
}

const rowClass = 'flex items-center gap-2 py-0.5';
const labelClass = 'text-xs text-muted-foreground w-24 shrink-0';
const controlClass = 'flex-1 min-w-0 text-xs border border-border rounded px-2 py-1 bg-background focus:outline-hidden focus:ring-1 focus:ring-brand-500';

/** A text field that commits on blur: an unusable number keeps the field and changes nothing. */
function NumberField({ label, value, placeholder, parse, onCommit, title }: {
  label: string;
  value: number | null;
  placeholder: string;
  parse: (text: string) => FieldCommit;
  onCommit: (v: number | null) => void;
  title: string;
}) {
  const [draft, setDraft] = useState(value == null ? '' : String(value));
  useEffect(() => { setDraft(value == null ? '' : String(value)); }, [value]);
  const parsed = parse(draft);
  return (
    <div className={rowClass} title={title}>
      <span className={labelClass}>{label}</span>
      <input
        className={`${controlClass} ${parsed === 'invalid' ? 'border-red-500' : ''}`}
        inputMode="decimal"
        value={draft}
        placeholder={placeholder}
        aria-invalid={parsed === 'invalid'}
        onChange={(e) => { setDraft(e.target.value); }}
        onBlur={() => {
          if (parsed === 'invalid') { setDraft(value == null ? '' : String(value)); return; }
          if (parsed !== value) onCommit(parsed);
        }}
      />
    </div>
  );
}

/** The Cost Guide choices of a sand casting, and what the route decided. Every choice is optional; unset means the engine decides or, for the energy price and the tooling life, charges nothing. */
export function SandCastingSection({ overrides, route, onChange }: Props) {
  const text = (key: string) => (typeof overrides?.[key] === 'string' ? overrides[key] : '');
  const number = (key: string) => (typeof overrides?.[key] === 'number' ? overrides[key] : null);
  return (
    <div className="space-y-1">
      <div className={rowClass}>
        <span className={labelClass}>Moulding</span>
        <select
          className={`${controlClass} cursor-pointer`}
          value={text(SAND_SCENARIO_KEYS.mouldingProcess)}
          onChange={(e) => { onChange({ [SAND_SCENARIO_KEYS.mouldingProcess]: choiceOf(e.target.value) }); }}
        >
          <option value="">Cheapest process</option>
          {SAND_MOULDING_PROCESSES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>
      <div className={rowClass}>
        <span className={labelClass}>Cores</span>
        <select
          className={`${controlClass} cursor-pointer`}
          value={text(SAND_SCENARIO_KEYS.coreProcess)}
          onChange={(e) => { onChange({ [SAND_SCENARIO_KEYS.coreProcess]: choiceOf(e.target.value) }); }}
        >
          <option value="">Hot Box when it can, else the cheapest</option>
          {SAND_CORE_PROCESSES.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>
      <NumberField
        label="Cavities"
        value={number(SAND_SCENARIO_KEYS.cavities)}
        placeholder="most that fit"
        parse={parseCavities}
        onCommit={(v) => { onChange({ [SAND_SCENARIO_KEYS.cavities]: v }); }}
        title="Cavities per mould. Empty: the most of a layout that fits the flask (one on manual moulding)."
      />
      <NumberField
        label="Energy, USD/kWh"
        value={number(SAND_SCENARIO_KEYS.energyPrice)}
        placeholder="not set: energy not charged"
        parse={parsePositive}
        onCommit={(v) => { onChange({ [SAND_SCENARIO_KEYS.energyPrice]: v }); }}
        title="Electricity price for melting. It is not in the reference data, so nothing is assumed: until you set it, melting energy is not charged."
      />
      {route && (
        <div className="pt-1 border-t border-border/50 mt-1 space-y-0.5">
          <div className="flex items-center justify-between text-[11px]"><span className="text-muted-foreground">Costed with</span><span className="font-medium text-right">{route.mouldingProcess} · {route.mouldingMachine}</span></div>
          <div className="flex items-center justify-between text-[11px]"><span className="text-muted-foreground">Cavities</span><span className="font-medium">{route.cavities}</span></div>
          <div className="flex items-center justify-between text-[11px]"><span className="text-muted-foreground">Cores</span><span className="font-medium">{route.coresMade}{route.coresLeftSolid > 0 ? ` (+${route.coresLeftSolid} left solid, machined later)` : ''}</span></div>
          {!route.complete && <p className="text-[10px] text-amber-600 dark:text-amber-500 leading-tight">Incomplete: a step no machine can do is shown as a gap and left out of the total.</p>}
        </div>
      )}
      <p className="text-[10px] text-muted-foreground/60 leading-tight pt-0.5">
        Core boxes are costed over annual volume × production life; patterns, core coating and sand are not costed.
      </p>
    </div>
  );
}
