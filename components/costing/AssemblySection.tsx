'use client';

import { useState } from 'react';

import {
  ASSEMBLY_ROUTE_OPTIONS, ASSEMBLY_SCENARIO_KEYS, JOINT_CHOICES, JOINT_FIELD_LABELS, JOINT_PROCESSES, jointMeasures, jointTableOf, jointTablePatch,
  missingMeasures, newJointId, withDerivedEnabled, withJoint, withoutJoint,
  type AssemblySummary, type AssemblyJointView, type JointField, type JointRow,
} from '@/lib/costing/assembly-view';

interface Props {
  assembly: AssemblySummary | null | undefined;
  /** The assembly's scenario overrides (unset keys: the engine decides). */
  overrides: Record<string, unknown> | null | undefined;
  /** Writes scenario keys; null clears one. */
  onChange: (patch: Record<string, unknown>) => void;
  /** The page of a component (a BOM child), to open it. */
  hrefOf?: (componentId: string) => string;
}

const rowClass = 'flex items-start gap-2 py-0.5';
const labelClass = 'text-xs text-muted-foreground w-24 shrink-0';
const controlClass = 'min-w-0 text-xs border border-border rounded px-2 py-1 bg-background focus:outline-hidden focus:ring-1 focus:ring-brand-500';
const buttonClass = 'text-xs px-2 py-0.5 rounded border border-border hover:bg-muted';
const FLAGS: ReadonlySet<JointField> = new Set(['prep', 'cleanUp']);

/** The edit form of one joint: its process, then the measures that process needs (required) or takes (optional). */
function JointForm({ initial, onSave, onCancel }: { initial: JointRow; onSave: (row: JointRow) => void; onCancel: () => void }) {
  const [row, setRow] = useState<JointRow>(initial);
  const spec = JOINT_PROCESSES.find((p) => p.process === row.process) ?? { process: row.process, label: row.process, required: ['count'] as JointField[], optional: [] as JointField[] };
  const missing = missingMeasures(row);
  const set = (f: JointField | 'label', v: string | number | boolean | undefined) => {
    setRow((r) => {
      const next = Object.fromEntries(Object.entries(r).filter(([k]) => k !== f)) as JointRow;
      return v === undefined || v === '' ? next : { ...next, [f]: v };
    });
  };
  const choicesOf = (f: JointField): readonly string[] | null => {
    const c = JOINT_CHOICES[f];
    if (!c) return null;
    return Array.isArray(c) ? c : (c as Readonly<Record<string, readonly string[]>>)[row.process] ?? null;
  };
  const field = (f: JointField, required: boolean) => {
    const label = `${JOINT_FIELD_LABELS[f]}${required ? '' : ' (optional)'}`;
    if (FLAGS.has(f)) {
      return (
        <label key={f} className="flex items-center gap-1 text-xs">
          <input type="checkbox" checked={row[f] === true} onChange={(e) => { set(f, e.target.checked || undefined); }} /> {JOINT_FIELD_LABELS[f]}
        </label>
      );
    }
    const choices = choicesOf(f);
    return (
      <label key={f} className="flex flex-col gap-0.5 text-xs">
        <span className="text-muted-foreground">{label}</span>
        {choices ? (
          <select className={`${controlClass} cursor-pointer`} value={typeof row[f] === 'string' ? row[f] : ''} onChange={(e) => { set(f, e.target.value || undefined); }}>
            <option value="">{required ? 'Choose' : 'Default'}</option>
            {choices.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        ) : (
          <input
            className={controlClass} type="number" min={0} step="any" inputMode="decimal"
            value={typeof row[f] === 'number' ? row[f] : ''}
            onChange={(e) => { set(f, e.target.value === '' ? undefined : Number(e.target.value)); }}
          />
        )}
      </label>
    );
  };
  return (
    <div className="space-y-2 rounded border border-border p-2">
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-0.5 text-xs col-span-2">
          <span className="text-muted-foreground">Joint</span>
          <select
            className={`${controlClass} cursor-pointer`} value={row.process}
            onChange={(e) => { setRow({ id: row.id, process: e.target.value, ...(row.label ? { label: row.label } : {}), count: typeof row.count === 'number' ? row.count : 1 }); }}
          >
            {JOINT_PROCESSES.map((p) => <option key={p.process} value={p.process}>{p.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-0.5 text-xs col-span-2">
          <span className="text-muted-foreground">Name (optional)</span>
          <input className={controlClass} value={row.label ?? ''} onChange={(e) => { set('label', e.target.value || undefined); }} placeholder="Chassis to bracket fillet" />
        </label>
        {spec.required.map((f) => field(f, true))}
        {spec.optional.filter((f) => !FLAGS.has(f)).map((f) => field(f, false))}
        <div className="col-span-2 flex gap-3">{spec.optional.filter((f) => FLAGS.has(f)).map((f) => field(f, false))}</div>
      </div>
      {missing.length > 0 && <p className="text-xs text-amber-600">Needs: {missing.map((f) => JOINT_FIELD_LABELS[f]).join(', ')}</p>}
      <div className="flex gap-2">
        <button type="button" className={buttonClass} disabled={missing.length > 0} onClick={() => { onSave(row); }}>Save joint</button>
        <button type="button" className={buttonClass} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

/** A joint as its table row: the stored row of its id, else one built from what the engine read (a derived joint not yet edited). */
function rowOf(table: readonly JointRow[], j: AssemblyJointView): JointRow {
  const stored = table.find((r) => r.id === j.id);
  if (stored) return stored;
  const row: JointRow = { id: j.id, process: j.process, count: j.count };
  if (j.operation) row.operation = j.operation;
  if (j.timeS != null) row.timeS = j.timeS;
  return row;
}

/**
 * The Cost Guide's assembly settings and what the engine read. An assembly's own work is costed: each component (BOM child) loaded, every
 * joint made, the finished assembly unloaded; the components' own costs are added to it by the BOM roll-up. The screws are derived from the
 * components' threaded holes; every other joint is set here.
 */
export function AssemblySection({ assembly: a, overrides, onChange, hrefOf }: Props) {
  const table = jointTableOf(overrides);
  const [editing, setEditing] = useState<JointRow | null>(null);
  const route = typeof overrides?.[ASSEMBLY_SCENARIO_KEYS.route] === 'string' ? (overrides[ASSEMBLY_SCENARIO_KEYS.route] as string) : '';
  const save = (next: JointRow[]) => { onChange(jointTablePatch(next)); };

  return (
    <div className="space-y-2 text-xs">
      <div className={rowClass}>
        <span className={labelClass}>Route</span>
        <select
          className={`${controlClass} flex-1 cursor-pointer`} value={route}
          onChange={(e) => { onChange({ [ASSEMBLY_SCENARIO_KEYS.route]: e.target.value || null }); }}
          title="Manual: every weld by hand. Robotic welding: the MIG, TIG and spot welds on a robot (its programming spread over the batch). Auto: the cheaper complete one."
        >
          <option value="">Auto (cheapest complete{a?.routeLabel && !route ? `: ${a.routeLabel}` : ''})</option>
          {ASSEMBLY_ROUTE_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
      </div>

      {a && (
        <>
          <div className={rowClass}>
            <span className={labelClass}>Components</span>
            <span className="flex-1 min-w-0 space-y-0.5">
              {a.components.length === 0 && <span className="block text-muted-foreground">None: add the assembly&apos;s parts under it in the BOM.</span>}
              {a.components.map((c) => (
                <span key={c.id} className="block tabular-nums">
                  {hrefOf ? <a className="text-brand-600 hover:underline" href={hrefOf(c.id)}>{c.name}</a> : c.name}
                  {` x ${c.quantity} · `}
                  {c.massKg != null ? `${c.massKg} kg` : <span className="text-amber-600" title="Its load time is read by weight: set the part's weight in the BOM, or analyse its model.">no weight</span>}
                  {c.maxDimensionMm != null ? ` · ${Math.round(c.maxDimensionMm)} mm` : ''}
                  {c.threadedHoles > 0 ? ` · ${c.threadedHoles} threaded hole${c.threadedHoles > 1 ? 's' : ''}` : ''}
                </span>
              ))}
            </span>
          </div>

          <div className={rowClass}>
            <span className={labelClass}>Joints</span>
            <span className="flex-1 min-w-0 space-y-1">
              {a.joints.length === 0 && <span className="block text-muted-foreground">None yet: screws come from the components&apos; threaded holes; add any other joint below.</span>}
              {a.joints.map((j) => (
                <span key={j.id} className={`block ${j.enabled ? '' : 'opacity-50'}`}>
                  <span className="flex items-center gap-1">
                    {j.source === 'derived' && (
                      <input
                        type="checkbox" checked={j.enabled} title="Derived from the part's threaded holes: untick to leave it out."
                        onChange={(e) => { save(withDerivedEnabled(table, j, e.target.checked)); }}
                      />
                    )}
                    <span className="flex-1 min-w-0 text-foreground">{j.label}</span>
                    <button type="button" className={buttonClass} onClick={() => { setEditing(rowOf(table, j)); }}>Edit</button>
                    {(j.source === 'engineer' || table.some((r) => r.id === j.id && r.enabled !== false)) && (
                      <button
                        type="button" className={buttonClass}
                        title={j.source === 'derived' ? 'Undo the edit: back to what the threaded holes give.' : 'Remove the joint.'}
                        onClick={() => { save(withoutJoint(table, j.id)); }}
                      >{j.source === 'derived' ? 'Reset' : 'Remove'}</button>
                    )}
                  </span>
                  <span className="block text-muted-foreground tabular-nums">
                    {j.routeProcess ?? j.process}{j.operation ? ` · ${j.operation}` : ''} · {jointMeasures(j)}
                    {j.cycleSec != null ? ` · ${j.cycleSec} s` : ''}
                    {j.consumablesCost ? ` · consumables ${j.consumablesCost.toFixed(2)}` : ''}
                  </span>
                  {j.enabled && j.reason && <span className="block text-red-600">{j.reason}</span>}
                </span>
              ))}
              {editing ? (
                <JointForm
                  key={editing.id} initial={editing}
                  onCancel={() => { setEditing(null); }}
                  onSave={(row) => { save(withJoint(table, row)); setEditing(null); }}
                />
              ) : (
                <button type="button" className={buttonClass} onClick={() => { setEditing({ id: newJointId(table), process: 'MIG Welding', count: 1 }); }}>Add joint</button>
              )}
            </span>
          </div>

          {(a.consumablesCost > 0 || a.adhesiveKg > 0) && (
            <div className={rowClass} title="Weld wire, gas, contact tips, nozzles and anti-spatter spray are on the weld lines. memory/Assembly gives no adhesive price: its mass is shown, not charged.">
              <span className={labelClass}>Consumables</span>
              <span className="flex-1 tabular-nums">
                {a.consumablesCost > 0 ? `${a.consumablesCost.toFixed(2)} per assembly on the weld lines` : ''}
                {a.adhesiveKg > 0 ? `${a.consumablesCost > 0 ? ' · ' : ''}${a.adhesiveKg} kg adhesive (not priced)` : ''}
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
          <p className="text-muted-foreground">The assembly&apos;s own work only: each component&apos;s cost is added once by the BOM roll-up.</p>
        </>
      )}
    </div>
  );
}
