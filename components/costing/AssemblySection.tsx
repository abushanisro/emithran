'use client';

import { useState } from 'react';

import { TableRowDialog } from '@/components/costing/TableRowDialog';
import {
  ASSEMBLY_JOINTS, ASSEMBLY_SCENARIO_KEYS, jointMeasures, withDerivedEnabled,
  type AssemblySummary, type AssemblyJointView, type JointField, type JointRow,
} from '@/lib/costing/assembly-view';
import { newRowId, tableOf, tablePatch, withRow, withoutRow } from '@/lib/costing/joint-table';

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
const linkButton = 'text-xs text-primary hover:underline disabled:opacity-50';
const seconds = (s: number) => (s >= 60 ? `${Math.round((s / 60) * 10) / 10} min` : `${Math.round(s * 10) / 10} s`);

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
  const table = tableOf<JointField>(ASSEMBLY_SCENARIO_KEYS.joints, overrides);
  const [editing, setEditing] = useState<{ row: JointRow; isNew: boolean } | null>(null);
  const save = (next: JointRow[]) => { onChange(tablePatch(ASSEMBLY_SCENARIO_KEYS.joints, next)); };
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
                {hrefOf && a.components.length > 1 ? <a className="text-primary hover:underline" href={hrefOf(c.id)}>{c.name}</a> : c.name}
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
          <button type="button" className={linkButton} onClick={() => { setEditing({ row: { id: newRowId(table, 'joint'), process: 'MIG Welding', count: 1 }, isNew: true }); }}>+ Add joint</button>
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
                    <button type="button" className={linkButton} onClick={() => { save(withoutRow(table, j.id)); }} title={j.source === 'derived' ? 'Back to what the threaded holes give.' : 'Remove the joint.'}>
                      {j.source === 'derived' ? 'Reset' : 'Remove'}
                    </button>
                  )}
                </div>
                <div className="truncate text-muted-foreground" title={jointMeasures(j)}>
                  {a.components.length > 1 && j.componentId ? `${a.components.find((c) => c.id === j.componentId)?.name ?? ''} · ` : ''}
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
        <TableRowDialog
          key={editing.row.id} vocabulary={ASSEMBLY_JOINTS} initial={editing.row} isNew={editing.isNew}
          noun="joint" kindLabel="Joint type" namePlaceholder="Optional, e.g. Bracket to frame"
          description="Each joint is costed by its Assembly process on the route's machine."
          // A joint found in the part's threaded holes stays a screw joint: its kind is the hole's.
          kindLocked={!editing.isNew && editing.row.id.startsWith('screw:')}
          onClose={() => { setEditing(null); }}
          onSave={(row) => { save(withRow(table, row)); setEditing(null); }}
        />
      )}
    </div>
  );
}
