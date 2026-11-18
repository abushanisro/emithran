'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  JOINT_CHOICES, JOINT_FIELD_LABELS, JOINT_PROCESSES, jointMeasures, jointTableOf, jointTablePatch,
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

const headClass = 'text-[11px] font-medium uppercase tracking-wide text-muted-foreground';
const controlClass = 'w-full min-w-0 text-sm border border-border rounded-md px-2 py-1.5 bg-background focus:outline-hidden focus:ring-1 focus:ring-brand-500';
const linkButton = 'text-xs text-brand-600 hover:underline disabled:opacity-50';
const FLAGS: ReadonlySet<JointField> = new Set(['prep', 'cleanUp']);
const seconds = (s: number) => (s >= 60 ? `${Math.round((s / 60) * 10) / 10} min` : `${Math.round(s * 10) / 10} s`);

/** The joint dialog: its kind, then exactly the measures that kind needs (required) or takes (optional). */
function JointDialog({ initial, isNew, onSave, onClose }: { initial: JointRow; isNew: boolean; onSave: (row: JointRow) => void; onClose: () => void }) {
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
    const choices = choicesOf(f);
    return (
      <label key={f} className="flex flex-col gap-1 text-xs">
        <span className="text-muted-foreground">{JOINT_FIELD_LABELS[f]}{required ? ' *' : ''}</span>
        {choices ? (
          <select className={`${controlClass} cursor-pointer`} value={typeof row[f] === 'string' ? row[f] : ''} onChange={(e) => { set(f, e.target.value || undefined); }}>
            <option value="">{required ? 'Choose…' : 'Default'}</option>
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
  const flags = spec.optional.filter((f) => FLAGS.has(f));
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isNew ? 'Add joint' : 'Edit joint'}</DialogTitle>
          <DialogDescription>Each joint is costed by its Assembly process on the route&apos;s machine. Fields marked * are needed to cost it.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <label className="col-span-2 flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">Joint type</span>
            <select
              className={`${controlClass} cursor-pointer`} value={row.process} disabled={!isNew && row.id.startsWith('screw:')}
              onChange={(e) => { setRow({ id: row.id, process: e.target.value, ...(row.label ? { label: row.label } : {}), count: typeof row.count === 'number' ? row.count : 1 }); }}
            >
              {JOINT_PROCESSES.map((p) => <option key={p.process} value={p.process}>{p.label}</option>)}
            </select>
          </label>
          <label className="col-span-2 flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">Name</span>
            <input className={controlClass} value={row.label ?? ''} onChange={(e) => { set('label', e.target.value || undefined); }} placeholder="Optional, e.g. Bracket to frame" />
          </label>
          {spec.required.map((f) => field(f, true))}
          {spec.optional.filter((f) => !FLAGS.has(f)).map((f) => field(f, false))}
          {flags.length > 0 && (
            <div className="col-span-2 flex gap-4">
              {flags.map((f) => (
                <label key={f} className="flex items-center gap-1.5 text-xs">
                  <input type="checkbox" checked={row[f] === true} onChange={(e) => { set(f, e.target.checked || undefined); }} /> {JOINT_FIELD_LABELS[f]}
                </label>
              ))}
            </div>
          )}
        </div>
        {missing.length > 0 && <p className="text-xs text-amber-600">Still needed: {missing.map((f) => JOINT_FIELD_LABELS[f]).join(', ')}</p>}
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={missing.length > 0} onClick={() => { onSave(row); }}>{isNew ? 'Add joint' : 'Save'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
 * The Cost Guide's assembly inputs: the components (BOM children, or the part itself when it has none) and the joints. Screws are derived
 * from the threaded holes; every other joint is added here. The route is chosen where every process's is, in Process Routing (Workflow
 * Builder); this panel only says which one is quoted.
 */
export function AssemblySection({ assembly: a, overrides, onChange, hrefOf }: Props) {
  const table = jointTableOf(overrides);
  const [editing, setEditing] = useState<{ row: JointRow; isNew: boolean } | null>(null);
  const save = (next: JointRow[]) => { onChange(jointTablePatch(next)); };
  if (!a) return <p className="text-xs text-muted-foreground">Costing the assembly…</p>;

  return (
    <div className="space-y-3 text-xs">
      <p className="text-muted-foreground">
        Quoted: <span className="text-foreground">{a.routeLabel ?? 'no complete route'}</span>
        {' '}· change it in Process Routing
      </p>

      <section className="space-y-1">
        <h4 className={headClass}>Components</h4>
        {a.components.length === 0 && <p className="text-muted-foreground">None: add the assembly&apos;s parts under it in the BOM.</p>}
        <ul className="divide-y divide-border rounded-md border border-border">
          {a.components.map((c) => (
            <li key={c.id} className="flex items-center gap-2 px-2 py-1.5">
              <span className="flex-1 min-w-0 truncate">
                {hrefOf && a.components.length > 1 ? <a className="text-brand-600 hover:underline" href={hrefOf(c.id)}>{c.name}</a> : c.name}
                <span className="text-muted-foreground"> × {c.quantity}</span>
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {c.massKg != null
                  ? <span title={c.massSource === 'volume' ? 'No weight in the BOM: its volume at its material\'s density.' : 'Its weight in the BOM.'}>{c.massKg} kg{c.massSource === 'volume' ? '*' : ''}</span>
                  : <span className="text-amber-600" title="Its load time is read by weight: set the part's material (its volume then gives the weight) or its weight in the BOM.">no weight</span>}
                {c.threadedHoles > 0 ? ` · ${c.threadedHoles} threaded` : ''}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-1">
        <div className="flex items-center justify-between">
          <h4 className={headClass}>Joints</h4>
          <button type="button" className={linkButton} onClick={() => { setEditing({ row: { id: newJointId(table), process: 'MIG Welding', count: 1 }, isNew: true }); }}>+ Add joint</button>
        </div>
        {a.joints.length === 0 && <p className="text-muted-foreground">None yet: screws come from threaded holes; add welds, rivets, sealing or bonding with Add joint.</p>}
        <ul className="divide-y divide-border rounded-md border border-border">
          {a.joints.map((j) => {
            const edited = table.some((r) => r.id === j.id && r.enabled !== false);
            return (
              <li key={j.id} className={`px-2 py-1.5 ${j.enabled ? '' : 'opacity-50'}`}>
                <div className="flex items-center gap-2">
                  {j.source === 'derived' && (
                    <input type="checkbox" checked={j.enabled} title="Found in the part's threaded holes: untick to leave it out." onChange={(e) => { save(withDerivedEnabled(table, j, e.target.checked)); }} />
                  )}
                  <span className="flex-1 min-w-0 truncate text-foreground" title={j.label}>{j.label}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">{j.cycleSec != null ? seconds(j.cycleSec) : ''}</span>
                  <button type="button" className={linkButton} onClick={() => { setEditing({ row: rowOf(table, j), isNew: false }); }}>Edit</button>
                  {(j.source === 'engineer' || edited) && (
                    <button type="button" className={linkButton} onClick={() => { save(withoutJoint(table, j.id)); }} title={j.source === 'derived' ? 'Back to what the threaded holes give.' : 'Remove the joint.'}>
                      {j.source === 'derived' ? 'Reset' : 'Remove'}
                    </button>
                  )}
                </div>
                <div className="truncate text-muted-foreground" title={jointMeasures(j)}>
                  {j.operation ?? j.routeProcess ?? j.process} · {jointMeasures(j)}{j.consumablesCost ? ` · consumables ${j.consumablesCost.toFixed(2)}` : ''}
                </div>
                {j.enabled && j.reason && <div className="text-red-600">{j.reason}</div>}
              </li>
            );
          })}
        </ul>
      </section>

      {(a.consumablesCost > 0 || a.adhesiveKg > 0) && (
        <p className="text-muted-foreground" title="Weld wire, gas, tips, nozzles and spray are on the weld lines. memory/Assembly gives no adhesive price: its mass is shown, not charged.">
          {a.consumablesCost > 0 ? `Weld consumables ${a.consumablesCost.toFixed(2)} per assembly` : ''}
          {a.adhesiveKg > 0 ? `${a.consumablesCost > 0 ? ' · ' : ''}${a.adhesiveKg} kg adhesive (not priced)` : ''}
        </p>
      )}
      {a.components.some((c) => c.massSource === 'volume') && <p className="text-muted-foreground">* weighed by its volume at its material&apos;s density (no weight in the BOM).</p>}
      <p className="text-muted-foreground">The assembly&apos;s own work: each component&apos;s cost is added once by the BOM roll-up.</p>

      {editing && (
        <JointDialog
          key={editing.row.id} initial={editing.row} isNew={editing.isNew}
          onClose={() => { setEditing(null); }}
          onSave={(row) => { save(withJoint(table, row)); setEditing(null); }}
        />
      )}
    </div>
  );
}
