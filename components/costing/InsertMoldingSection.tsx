'use client';

import { useEffect, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import {
  insertEntryOf, insertEntryPatch, shotCycleOf, type InsertEntry, type InsertMoldingSummary,
} from '@/lib/costing/insert-molding-view';

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
const boxClass = 'divide-y divide-border rounded-md border border-border';
const rowClass = 'flex items-baseline justify-between gap-3 px-2 py-1.5';
const controlClass = 'w-full min-w-0 text-sm border border-border rounded-md px-2 py-1.5 bg-background focus:outline-hidden focus:ring-1 focus:ring-primary/40';
const seconds = (s: number | null) => (s == null ? '—' : `${s.toFixed(1)} s`);
/** An insert with no weight is loaded in the lightest componentLoadTime band (insert-molding.ts loadTimeRow). */
const NO_WEIGHT_NOTE = 'Loaded in the lightest load-time band (up to 0.2 kg by hand, 0.5 kg by robot). Enter its weight for an exact band.';
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
function InsertEntryForm({ saved, start, onSave, onCancel }: {
  /** What is saved; Save is enabled once the form differs from it. */
  saved: InsertEntry;
  /** What the form starts from: the saved entry, or the CAD's insert count when nothing is saved. */
  start: InsertEntry;
  onSave: (entry: InsertEntry) => void;
  onCancel: () => void;
}) {
  const [entry, setEntry] = useState<InsertEntry>(start);
  const number = (v: string) => (v === '' ? null : Number(v));
  const changed = entry.count !== saved.count || entry.weightKg !== saved.weightKg || entry.name !== saved.name;
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
          <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button size="sm" disabled={!changed || entry.count == null} onClick={() => { onSave(entry); }}>Save inserts</Button>
        </span>
      </div>
    </div>
  );
}

/**
 * The Cost Guide's insert molding input: the inserts loaded every shot (its BOM children, or a count and weight entered here, shown read-only
 * with Edit and Delete). What the engine decided (press and cycle) is in the Cost tab (InsertMoldingCycle); the routes are in the Workflow Builder.
 */
export function InsertMoldingSection({ insertMolding: im, overrides, onChange, hrefOf }: Props) {
  const [editing, setEditing] = useState(false);
  // What was just saved or deleted, shown until the part's overrides come back with it.
  const [local, setLocal] = useState<InsertEntry | 'deleted' | null>(null);
  useEffect(() => { setLocal(null); }, [overrides]);
  if (!im) return <p className="text-xs text-muted-foreground">Costing the insert molding…</p>;

  const fromBom = im.inserts.some((i) => i.source === 'bom');
  const entered = insertEntryOf(overrides);
  const saved = local === 'deleted' ? null : local ?? (entered.count != null ? entered : null);
  // Nothing entered: the engine loads the CAD's insert candidates; shown as such, and Edit confirms or corrects them.
  const fromCad = !fromBom && !saved ? im.inserts.find((i) => i.source === 'cad') ?? null : null;
  const cad = im.cadInsertCandidates != null && im.cadInsertCandidates > 0 ? im.cadInsertCandidates : null;
  const save = (e: InsertEntry) => { onChange(insertEntryPatch(e)); setLocal(e.count == null ? 'deleted' : e); setEditing(false); };
  const remove = () => { onChange(insertEntryPatch({ count: null, weightKg: null, name: '' })); setLocal('deleted'); setEditing(false); };
  const action = 'text-primary hover:underline';

  return (
    <div className="space-y-4 text-xs">
      <section className="space-y-1.5">
        <div className="flex items-baseline justify-between">
          <h4 className={headClass}>Inserts</h4>
          {!fromBom && !editing && (
            <span className="flex gap-3">
              <button type="button" className={action} onClick={() => { setEditing(true); }}>{saved || fromCad ? 'Edit' : 'Add'}</button>
              {saved && <button type="button" className="text-red-600 hover:underline" onClick={remove}>Delete</button>}
            </span>
          )}
        </div>
        {fromBom ? (
          <ul className={boxClass}>
            {im.inserts.map((i) => (
              <Row
                key={i.id ?? i.name}
                label={<>{hrefOf && i.id ? <a className={action} href={hrefOf(i.id)}>{i.name}</a> : <span className="text-foreground">{i.name}</span>} × {i.perPart}</>}
              >
                {i.massKg != null ? `${grams(i.massKg)} each` : <span className="text-muted-foreground" title={NO_WEIGHT_NOTE}>weight not given</span>}
              </Row>
            ))}
          </ul>
        ) : editing ? (
          <InsertEntryForm
            saved={saved ?? { count: null, weightKg: null, name: '' }}
            start={saved ?? { count: cad, weightKg: null, name: '' }}
            onSave={save}
            onCancel={() => { setEditing(false); }}
          />
        ) : fromCad ? (
          <ul className={boxClass}>
            <Row label={<><span className="text-foreground">Insert candidates from CAD</span> × {fromCad.perPart}</>}>
              <span className="text-muted-foreground" title={NO_WEIGHT_NOTE}>weight not given</span>
            </Row>
          </ul>
        ) : saved ? (
          <ul className={boxClass}>
            <Row label={<><span className="text-foreground">{saved.name || 'Insert'}</span> × {saved.count}</>}>
              {saved.weightKg != null ? `${grams(saved.weightKg)} each` : <span className="text-muted-foreground" title={NO_WEIGHT_NOTE}>weight not given</span>}
            </Row>
          </ul>
        ) : (
          <p className="rounded-md border border-dashed border-border px-2 py-1.5 text-muted-foreground">
            No inserts yet{cad ? `: CAD found ${String(cad)} candidates` : ''}. Add them here, or as BOM children of this part.
          </p>
        )}
      </section>
    </div>
  );
}

/** The Cost tab's insert molding cycle: the press the engine chose, the insert loading, the molding and the shot they make. */
export function InsertMoldingCycle({ insertMolding: im }: { insertMolding: InsertMoldingSummary }) {
  if (!im.press.name) {
    return <p className="text-xs text-amber-600">{im.press.reasons[0] ?? 'No insert press takes this part.'}</p>;
  }
  const shot = shotCycleOf(im);
  return (
    <ul className={`${boxClass} text-xs`}>
      <Row label="Press">
        <span className="text-foreground">{im.press.name}</span>
        <span className="block text-muted-foreground">{im.press.tablePress && im.press.tableConfiguration ? `${im.press.tableConfiguration} table` : 'No rotary or shuttle table'}</span>
      </Row>
      {im.shotSec == null ? (
        <li className={`${rowClass} text-amber-600`}>
          Not timed yet: {im.inserts.length === 0 ? 'enter the inserts in the Cost Guide.' : 'see Insert Pick and Place below.'}
        </li>
      ) : (
        <>
          <Row label={<>Insert loading{im.loaderName && <span className="block">{im.loaderName}</span>}</>}>{seconds(im.loadSecPerPart)}</Row>
          <Row label="Molding">{seconds(im.moldingCycleSec)}</Row>
          <Row label={<span className="font-medium text-foreground">Shot cycle</span>} title={shot.explanation}>
            <span className="font-medium text-foreground">{seconds(im.shotSec)}</span>
            <span className="block text-muted-foreground">{shot.rule}</span>
          </Row>
        </>
      )}
    </ul>
  );
}
