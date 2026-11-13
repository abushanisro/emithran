'use client';

import { useEffect, useState } from 'react';

import {
  HOT_BOX_GUIDANCE,
  REFRACTORY_COAT_CHOICES,
  REFRACTORY_DRY_METHODS,
  REFRACTORY_GUIDANCE,
  SAND_CORE_PROCESSES,
  SAND_MOULDING_PROCESSES,
  SAND_SCENARIO_KEYS,
  choiceOf,
  parseCavities,
  parsePositive,
  type FieldCommit,
} from '@/lib/costing/sand-scenario';


interface Props {
  /** The part's scenario overrides (the user's choices; unset keys are not shown as chosen). */
  overrides: Record<string, unknown> | null | undefined;
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

/** The Cost Guide choices of a sand casting (what the route decided is in the Cost tab: SandRouteSummary). Every choice is optional; unset means the engine decides or, for the energy price and the tooling life, charges nothing. */
export function SandCastingSection({ overrides, onChange }: Props) {
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
        placeholder="the location's price"
        parse={parsePositive}
        onCommit={(v) => { onChange({ [SAND_SCENARIO_KEYS.energyPrice]: v }); }}
        title="Electricity price for melting, hot-box cores and drying ovens, for this part. Empty: the location's sourced price (reference data, e.g. USA: EIA industrial average); a location with none has its energy not charged, and the lines say so."
      />
      <NumberField
        label="Box temp, °C"
        value={number(SAND_SCENARIO_KEYS.hotBoxCoreboxTemp)}
        placeholder="published: 232 (450 °F)"
        parse={parsePositive}
        onCommit={(v) => { onChange({ [SAND_SCENARIO_KEYS.hotBoxCoreboxTemp]: v }); }}
        title={`Hot box core making. ${HOT_BOX_GUIDANCE.coreboxTemp}`}
      />
      <NumberField
        label="Cure temp, °C"
        value={number(SAND_SCENARIO_KEYS.hotBoxCureTemp)}
        placeholder="published: 48.9 (120 °F)"
        parse={parsePositive}
        onCommit={(v) => { onChange({ [SAND_SCENARIO_KEYS.hotBoxCureTemp]: v }); }}
        title={`Hot box core making. ${HOT_BOX_GUIDANCE.cureTemp}`}
      />
      <NumberField
        label="Cured depth, mm"
        value={number(SAND_SCENARIO_KEYS.hotBoxCuredDepth)}
        placeholder="published: 12.7 (1/2 in skin)"
        parse={parsePositive}
        onCommit={(v) => { onChange({ [SAND_SCENARIO_KEYS.hotBoxCuredDepth]: v }); }}
        title={`Hot box core making. ${HOT_BOX_GUIDANCE.curedDepth}`}
      />
      <div className={rowClass} title="Refractory coating is not costed unless you choose it. The coating methods, rates and densities are in the reference data; the drying time and the coating's price are yours to set.">
        <span className={labelClass}>Refractory coat</span>
        <select
          className={`${controlClass} cursor-pointer`}
          value={text(SAND_SCENARIO_KEYS.refractoryCoat)}
          onChange={(e) => { onChange({ [SAND_SCENARIO_KEYS.refractoryCoat]: choiceOf(e.target.value) }); }}
        >
          <option value="">Not coated</option>
          {REFRACTORY_COAT_CHOICES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
      </div>
      {text(SAND_SCENARIO_KEYS.refractoryCoat) !== '' && (
        <>
          <div className={rowClass} title="How the coated mould or cores are dried.">
            <span className={labelClass}>Drying</span>
            <select
              className={`${controlClass} cursor-pointer`}
              value={text(SAND_SCENARIO_KEYS.refractoryDryMethod)}
              onChange={(e) => { onChange({ [SAND_SCENARIO_KEYS.refractoryDryMethod]: choiceOf(e.target.value) }); }}
            >
              <option value="">Not set: the drying is not costed</option>
              {REFRACTORY_DRY_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
          <NumberField
            label="Drying, min"
            value={number(SAND_SCENARIO_KEYS.refractoryDryMinutes)}
            placeholder="set: time for a load"
            parse={parsePositive}
            onCommit={(v) => { onChange({ [SAND_SCENARIO_KEYS.refractoryDryMinutes]: v }); }}
            title={REFRACTORY_GUIDANCE.dryMinutes}
          />
          <NumberField
            label="Coating, USD/kg"
            value={number(SAND_SCENARIO_KEYS.refractoryCoatPrice)}
            placeholder="not set: coating not charged"
            parse={parsePositive}
            onCommit={(v) => { onChange({ [SAND_SCENARIO_KEYS.refractoryCoatPrice]: v }); }}
            title={REFRACTORY_GUIDANCE.price}
          />
        </>
      )}
    </div>
  );
}
