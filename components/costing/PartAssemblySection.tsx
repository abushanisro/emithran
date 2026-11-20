'use client';

import { useMemo, useState } from 'react';

import { TableRowDialog } from '@/components/costing/TableRowDialog';
import { newRowId, tableOf, tablePatch, withRow, withoutRow } from '@/lib/costing/joint-table';
import {
  PART_ASSEMBLY_SCENARIO_KEYS, weldMeasures, weldVocabulary,
  type PartAssemblySummary, type WeldField, type WeldRow, type WeldView,
} from '@/lib/costing/part-assembly-view';

interface Props {
  partAssembly: PartAssemblySummary | null | undefined;
  /** The weldment's scenario overrides (unset keys: the engine decides). */
  overrides: Record<string, unknown> | null | undefined;
  /** Writes scenario keys; null clears one. */
  onChange: (patch: Record<string, unknown>) => void;
  /** The page of a component (a BOM child), to open it. */
  hrefOf?: (componentId: string) => string;
}

const headClass = 'text-[11px] font-medium uppercase tracking-wide text-muted-foreground';
const linkButton = 'text-xs text-primary hover:underline disabled:opacity-50';
const seconds = (s: number) => (s >= 60 ? `${Math.round((s / 60) * 10) / 10} min` : `${Math.round(s * 10) / 10} s`);

/** A weld as its table row: the stored row of its id (every weld is one the engineer entered). */
function rowOf(table: readonly WeldRow[], w: WeldView): WeldRow {
  return table.find((r) => r.id === w.id) ?? { id: w.id, process: w.process, operation: w.operation, ...(w.count != null ? { count: w.count } : {}) };
}

/**
 * The Cost Guide's weldment inputs (memory/Part Assembly): the components welded (BOM children, or the part itself when it has none), the
 * plate and material the welds are made in, and the weld table. Each weld is costed on the route's welder; the route is chosen where every
 * process's is, in Process Routing (Workflow Builder), and this panel says which one is quoted.
 */
export function PartAssemblySection({ partAssembly: pa, overrides, onChange, hrefOf }: Props) {
  const table = tableOf<WeldField>(PART_ASSEMBLY_SCENARIO_KEYS.welds, overrides);
  const [editing, setEditing] = useState<{ row: WeldRow; isNew: boolean } | null>(null);
  const vocabulary = useMemo(() => weldVocabulary(pa?.thicknessMm ?? null), [pa?.thicknessMm]);
  const save = (next: WeldRow[]) => { onChange(tablePatch(PART_ASSEMBLY_SCENARIO_KEYS.welds, next)); };
  if (!pa) return <p className="text-xs text-muted-foreground">Costing the weldment…</p>;
  const notRoutes = pa.options.filter((o) => !o.complete && o.reason);

  return (
    <div className="space-y-3 text-xs">
      <p className="text-muted-foreground">
        Quoted: <span className="text-foreground">{pa.routeLabel ?? 'no complete route'}</span>
        {' '}· change it in Process Routing
      </p>
      {notRoutes.map((o) => <p key={o.route} className="text-muted-foreground">{o.label}: {o.reason}</p>)}

      <section className="space-y-1">
        <h4 className={headClass}>Components</h4>
        {pa.components.length === 0 && <p className="text-muted-foreground">None: add the parts welded together under it in the BOM.</p>}
        <ul className="divide-y divide-border rounded-md border border-border">
          {pa.components.map((c) => (
            <li key={c.id} className="flex items-center gap-2 px-2 py-1.5">
              <span className="flex-1 min-w-0 truncate">
                {hrefOf && pa.components.length > 1 ? <a className="text-primary hover:underline" href={hrefOf(c.id)}>{c.name}</a> : c.name}
                <span className="text-muted-foreground"> × {c.quantity}</span>
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">
                {c.massKg != null
                  ? <span title={c.massSource === 'volume' ? 'No weight in the BOM: its volume at its material\'s density.' : 'Its weight in the BOM.'}>{c.massKg} kg{c.massSource === 'volume' ? '*' : ''}</span>
                  : <span className="text-amber-600" title="Its load time is read by weight: set the part's material (its volume then gives the weight) or its weight in the BOM.">no weight</span>}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-muted-foreground">
          Plate: {pa.thicknessMm != null ? <span className="text-foreground">{pa.thicknessMm} mm</span> : <span className="text-amber-600">not known</span>}
          {' '}({pa.thicknessSource}) · Material: {pa.material ? <span className="text-foreground">{pa.material}</span> : 'not set'}
          {pa.material && pa.cutCodeFamily == null ? ' (no cut code: laser seams and bevels cannot be timed)' : ''}
        </p>
      </section>

      <section className="space-y-1">
        <div className="flex items-center justify-between">
          <h4 className={headClass}>Welds</h4>
          <button type="button" className={linkButton} onClick={() => { setEditing({ row: vocabulary.rekind({ id: newRowId(table, 'weld'), process: 'MIG Welding' }, 'MIG Welding'), isNew: true }); }}>+ Add weld</button>
        </div>
        {pa.welds.length === 0 && <p className="text-muted-foreground">None yet: add each weld (fillet, groove, plug, spots, laser seam) with Add weld.</p>}
        <ul className="divide-y divide-border rounded-md border border-border">
          {pa.welds.map((w) => (
            <li key={w.id} className={`px-2 py-1.5 ${w.enabled ? '' : 'opacity-50'}`}>
              <div className="flex items-center gap-2">
                <span className="flex-1 min-w-0 truncate text-foreground" title={w.label}>{w.label}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{w.cycleSec != null ? seconds(w.cycleSec) : ''}</span>
                <button type="button" className={linkButton} onClick={() => { setEditing({ row: rowOf(table, w), isNew: false }); }}>Edit</button>
                <button type="button" className={linkButton} onClick={() => { save(withoutRow(table, w.id)); }} title="Remove the weld.">Remove</button>
              </div>
              <div className="truncate text-muted-foreground" title={weldMeasures(w)}>
                {w.routeProcess ?? w.process} · {w.operation} on {w.feature === 'SimpleHole' ? 'a hole' : `the ${w.feature.toLowerCase()}`} · {weldMeasures(w)}
                {w.wireKg != null ? ` · ${w.wireKg} kg wire` : ''}
              </div>
              {w.enabled && w.reason && <div className="text-red-600">{w.reason}</div>}
            </li>
          ))}
        </ul>
      </section>

      {pa.wireCost > 0 && <p className="text-muted-foreground" title="The MIG wire the welds deposit, at memory/Part Assembly's arc efficiency (0.5), on the weld lines.">MIG wire {pa.wireCost.toFixed(2)} per weldment</p>}
      {pa.components.some((c) => c.massSource === 'volume') && <p className="text-muted-foreground">* weighed by its volume at its material&apos;s density (no weight in the BOM).</p>}
      <p className="text-muted-foreground">The weldment&apos;s welding: each component&apos;s cost is added once by the BOM roll-up.</p>

      {editing && (
        <TableRowDialog
          key={editing.row.id} vocabulary={vocabulary} initial={editing.row} isNew={editing.isNew}
          noun="weld" kindLabel="Weld" namePlaceholder="Optional, e.g. Bracket to frame"
          description="Each weld is costed on the route's welder: by hand or by robot for MIG and spot welds, on the laser seam welder for a laser seam."
          onClose={() => { setEditing(null); }}
          onSave={(row) => { save(withRow(table, row)); setEditing(null); }}
        />
      )}
    </div>
  );
}
