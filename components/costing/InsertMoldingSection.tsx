'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { insertEntryOf, insertEntryPatch, type InsertEntry, type InsertMoldingSummary } from '@/lib/costing/insert-molding-view';

interface Props {
  insertMolding: InsertMoldingSummary | null | undefined;
  /** The part's scenario overrides. */
  overrides: Record<string, unknown> | null | undefined;
  /** Writes scenario keys; null clears one. */
  onChange: (patch: Record<string, unknown>) => void;
  /** The page of an insert that is a BOM child, to open it. */
  hrefOf?: (itemId: string) => string;
}

const headClass = 'text-[11px] font-medium uppercase tracking-wide text-muted-foreground';
const controlClass = 'w-full min-w-0 text-sm border border-border rounded-md px-2 py-1.5 bg-background focus:outline-hidden focus:ring-1 focus:ring-brand-500';
const seconds = (s: number | null) => (s == null ? '—' : `${Math.round(s * 100) / 100} s`);

/** The inserts entered in the Cost Guide, for a part with no inserts under it in the BOM. */
function InsertEntryForm({ initial, onSave }: { initial: InsertEntry; onSave: (entry: InsertEntry) => void }) {
  const [entry, setEntry] = useState<InsertEntry>(initial);
  const number = (v: string) => (v === '' ? null : Number(v));
  const changed = entry.count !== initial.count || entry.weightKg !== initial.weightKg || entry.name !== initial.name;
  return (
    <div className="grid grid-cols-3 gap-2">
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">Inserts per part</span>
        <input className={controlClass} type="number" min={1} step={1} value={entry.count ?? ''} onChange={(e) => { setEntry({ ...entry, count: number(e.target.value) }); }} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">Weight each (kg)</span>
        <input className={controlClass} type="number" min={0} step="any" value={entry.weightKg ?? ''} onChange={(e) => { setEntry({ ...entry, weightKg: number(e.target.value) }); }} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">Name</span>
        <input className={controlClass} value={entry.name} placeholder="e.g. M4 brass insert" onChange={(e) => { setEntry({ ...entry, name: e.target.value }); }} />
      </label>
      <div className="col-span-3 flex justify-end">
        <Button size="sm" variant="outline" disabled={!changed} onClick={() => { onSave(entry); }}>Save inserts</Button>
      </div>
    </div>
  );
}

/**
 * The Cost Guide's insert molding inputs and what the engine decided. The part is molded on an insert press with its inserts loaded every
 * shot; the inserts are its BOM children, or a count and weight entered here. The load method (manual, 3-axis or 6-axis robot) is a route,
 * chosen in Process Routing like every process; this panel says which is quoted.
 */
export function InsertMoldingSection({ insertMolding: im, overrides, onChange, hrefOf }: Props) {
  if (!im) return <p className="text-xs text-muted-foreground">Costing the insert molding…</p>;
  const fromBom = im.inserts.some((i) => i.source === 'bom');
  return (
    <div className="space-y-3 text-xs">
      <p className="text-muted-foreground">
        Quoted: <span className="text-foreground">{im.routeLabel}</span> · change it in Process Routing
      </p>

      <section className="space-y-1">
        <h4 className={headClass}>Inserts</h4>
        {fromBom ? (
          <ul className="divide-y divide-border rounded-md border border-border">
            {im.inserts.map((i) => (
              <li key={i.id ?? i.name} className="flex items-center gap-2 px-2 py-1.5">
                <span className="flex-1 min-w-0 truncate">
                  {hrefOf && i.id ? <a className="text-brand-600 hover:underline" href={hrefOf(i.id)}>{i.name}</a> : i.name}
                  <span className="text-muted-foreground"> × {i.perPart}</span>
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {i.massKg != null ? `${i.massKg} kg` : <span className="text-amber-600" title="Its load time is read by weight: set its weight or material in the BOM.">no weight</span>}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <>
            <p className="text-muted-foreground">No inserts under this part in the BOM: enter them here.</p>
            <InsertEntryForm initial={insertEntryOf(overrides)} onSave={(e) => { onChange(insertEntryPatch(e)); }} />
          </>
        )}
      </section>

      <section className="space-y-1">
        <h4 className={headClass}>Press and shot</h4>
        {im.press.name ? (
          <ul className="divide-y divide-border rounded-md border border-border">
            <li className="flex justify-between gap-2 px-2 py-1.5"><span>{im.press.name}</span><span className="text-muted-foreground">{im.press.tableConfiguration ?? 'No table'}</span></li>
            <li className="flex justify-between gap-2 px-2 py-1.5"><span className="text-muted-foreground">Loading per part{im.loaderName ? ` (${im.loaderName})` : ''}</span><span className="tabular-nums">{seconds(im.loadSecPerPart)}</span></li>
            <li className="flex justify-between gap-2 px-2 py-1.5"><span className="text-muted-foreground">Molding cycle</span><span className="tabular-nums">{seconds(im.moldingCycleSec)}</span></li>
            <li className="flex justify-between gap-2 px-2 py-1.5" title={im.press.tablePress ? 'The table loads the next lower mold half while the other is molded: the shot is the longer of the two.' : 'No table: the inserts are loaded with the mold open, so loading and molding add.'}>
              <span className="text-muted-foreground">Shot ({im.press.tablePress ? 'load during molding' : 'load + mold'})</span><span className="tabular-nums">{seconds(im.shotSec)}</span>
            </li>
          </ul>
        ) : (
          <p className="text-red-600">No insert press: {im.press.reasons[0] ?? 'none fits this part'}</p>
        )}
        {im.toolingNote && <p className="text-muted-foreground">{im.toolingNote}</p>}
      </section>

      <section className="space-y-1">
        <h4 className={headClass}>Routes</h4>
        <ul className="space-y-0.5">
          {im.options.map((o) => (
            <li key={o.route} className={o.route === im.route ? 'text-foreground' : 'text-muted-foreground'} title={o.reason ?? undefined}>
              {o.label}{o.totalCost != null ? ` · ${o.totalCost.toFixed(2)}` : ' · incomplete'}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
