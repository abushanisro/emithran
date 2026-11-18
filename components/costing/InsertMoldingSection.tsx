'use client';

import { useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import {
  insertEntryOf, insertEntryPatch, insertRouteRows, shotCycleOf, type InsertEntry, type InsertMoldingSummary,
} from '@/lib/costing/insert-molding-view';

interface Props {
  insertMolding: InsertMoldingSummary | null | undefined;
  /** The part's scenario overrides. */
  overrides: Record<string, unknown> | null | undefined;
  /** Writes scenario keys; null clears one. */
  onChange: (patch: Record<string, unknown>) => void;
  /** The page of an insert that is a BOM child, to open it. */
  hrefOf?: (itemId: string) => string;
  /** The summary's currency symbol: the route costs are already in its currency. */
  currencySymbol?: string | undefined;
}

const headClass = 'text-[11px] font-medium uppercase tracking-wide text-muted-foreground';
const boxClass = 'divide-y divide-border rounded-md border border-border';
const rowClass = 'flex items-baseline justify-between gap-3 px-2 py-1.5';
const controlClass = 'w-full min-w-0 text-sm border border-border rounded-md px-2 py-1.5 bg-background focus:outline-hidden focus:ring-1 focus:ring-brand-500';
const seconds = (s: number | null) => (s == null ? '—' : `${s.toFixed(1)} s`);
const grams = (kg: number) => `${Math.round(kg * 10_000) / 10} g`;

function Row({ label, children, title }: { label: ReactNode; children: ReactNode; title?: string }) {
  return (
    <li className={rowClass} title={title}>
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right tabular-nums">{children}</span>
    </li>
  );
}

/** The inserts entered in the Cost Guide, for a part with no inserts under it in the BOM. Weight is entered in grams, stored in kg. */
function InsertEntryForm({ initial, onSave, onCancel }: { initial: InsertEntry; onSave: (entry: InsertEntry) => void; onCancel?: (() => void) | undefined }) {
  const [entry, setEntry] = useState<InsertEntry>(initial);
  const number = (v: string) => (v === '' ? null : Number(v));
  const changed = entry.count !== initial.count || entry.weightKg !== initial.weightKg || entry.name !== initial.name;
  return (
    <div className="grid grid-cols-[4.5rem_5.5rem_1fr] gap-2 rounded-md border border-border p-2">
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">Per part</span>
        <input className={controlClass} type="number" min={1} step={1} value={entry.count ?? ''} onChange={(e) => { setEntry({ ...entry, count: number(e.target.value) }); }} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">Weight (g)</span>
        <input
          className={controlClass} type="number" min={0} step="any"
          value={entry.weightKg == null ? '' : Math.round(entry.weightKg * 1e6) / 1e3}
          onChange={(e) => { const g = number(e.target.value); setEntry({ ...entry, weightKg: g == null ? null : g / 1000 }); }}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-muted-foreground">Insert</span>
        <input className={controlClass} value={entry.name} placeholder="e.g. M3 brass heat-set insert" onChange={(e) => { setEntry({ ...entry, name: e.target.value }); }} />
      </label>
      <div className="col-span-3 flex items-center justify-between gap-2">
        <span className="text-muted-foreground">Load time is read by insert weight.</span>
        <span className="flex gap-2">
          {onCancel && <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>}
          <Button size="sm" disabled={!changed || entry.count == null} onClick={() => { onSave(entry); }}>Save inserts</Button>
        </span>
      </div>
    </div>
  );
}

/**
 * The Cost Guide's insert molding inputs and what the engine decided. The part is molded on an insert press with its inserts loaded every
 * shot; the inserts are its BOM children, or a count and weight entered here. The load method (manual, 3-axis or 6-axis robot) is a route,
 * chosen in Process Routing like every process; this panel lists each method's cost and which is quoted.
 */
export function InsertMoldingSection({ insertMolding: im, overrides, onChange, hrefOf, currencySymbol = '$' }: Props) {
  const [editing, setEditing] = useState(false);
  if (!im) return <p className="text-xs text-muted-foreground">Costing the insert molding…</p>;

  const fromBom = im.inserts.some((i) => i.source === 'bom');
  const entered = insertEntryOf(overrides);
  const showEntered = !fromBom && entered.count != null && !editing;
  const shot = shotCycleOf(im);

  return (
    <div className="space-y-4 text-xs">
      <section className="space-y-1.5">
        <div className="flex items-baseline justify-between">
          <h4 className={headClass}>Inserts</h4>
          {showEntered && <button type="button" className="text-brand-600 hover:underline" onClick={() => { setEditing(true); }}>Edit</button>}
        </div>
        {fromBom ? (
          <ul className={boxClass}>
            {im.inserts.map((i) => (
              <Row
                key={i.id ?? i.name}
                label={<>{hrefOf && i.id ? <a className="text-brand-600 hover:underline" href={hrefOf(i.id)}>{i.name}</a> : <span className="text-foreground">{i.name}</span>} × {i.perPart}</>}
              >
                {i.massKg != null ? `${grams(i.massKg)} each` : <span className="text-amber-600" title="Its load time is read by weight: set its weight or material in the BOM.">no weight</span>}
              </Row>
            ))}
          </ul>
        ) : showEntered ? (
          <ul className={boxClass}>
            <Row label={<><span className="text-foreground">{entered.name || 'Insert'}</span> × {entered.count}</>}>
              {entered.weightKg != null ? `${grams(entered.weightKg)} each` : <span className="text-amber-600" title="Its load time is read by weight.">no weight</span>}
            </Row>
          </ul>
        ) : (
          <>
            <p className="text-muted-foreground">Add the inserts as BOM children of this part, or enter them here.</p>
            <InsertEntryForm
              initial={entered}
              onSave={(e) => { onChange(insertEntryPatch(e)); setEditing(false); }}
              onCancel={editing ? () => { setEditing(false); } : undefined}
            />
          </>
        )}
      </section>

      <section className="space-y-1.5">
        <h4 className={headClass}>Cycle</h4>
        {im.press.name ? (
          <ul className={boxClass}>
            <Row label="Press">
              <span className="text-foreground">{im.press.name}</span>
              <span className="block text-muted-foreground">{im.press.tableConfiguration ? `${im.press.tableConfiguration} table` : 'No rotary or shuttle table'}</span>
            </Row>
            <Row label={<>Insert loading{im.loaderName && <span className="block">{im.loaderName}</span>}</>}>{seconds(im.loadSecPerPart)}</Row>
            <Row label="Molding">{seconds(im.moldingCycleSec)}</Row>
            <Row label={<span className="font-medium text-foreground">Shot cycle</span>} title={shot.explanation}>
              <span className="font-medium text-foreground">{seconds(im.shotSec)}</span>
              <span className="block text-muted-foreground">{shot.rule}</span>
            </Row>
          </ul>
        ) : (
          <p className="rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
            No insert press fits: {im.press.reasons[0] ?? 'none takes this part'}
          </p>
        )}
        {im.toolingNote && <p className="text-muted-foreground">{im.toolingNote}</p>}
      </section>

      <section className="space-y-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <h4 className={headClass}>Load method · cost per part</h4>
          <span className="text-muted-foreground">change in Process Routing</span>
        </div>
        <ul className={boxClass}>
          {insertRouteRows(im).map((r) => (
            <li key={r.route} className={`${rowClass} ${r.quoted ? 'bg-muted/60' : ''}`} title={r.reason ?? undefined}>
              <span className={r.quoted ? 'font-medium text-foreground' : 'text-muted-foreground'}>
                {r.method}
                {r.quoted && <span className="ml-2 rounded-sm bg-brand-600 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-white">Quoted</span>}
              </span>
              <span className="text-right tabular-nums">
                {r.cost != null ? (
                  <>
                    <span className={r.quoted ? 'font-medium text-foreground' : ''}>{currencySymbol}{r.cost.toFixed(2)}</span>
                    {r.sameAsQuoted && <span className="block text-muted-foreground">same as quoted</span>}
                  </>
                ) : (
                  <span className="text-amber-600">{r.reason ?? 'not costed'}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
