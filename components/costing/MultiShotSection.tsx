'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { X } from '@/components/ui/icons';
import { useRawMaterials } from '@/lib/api/hooks/useRawMaterials';
import {
  MULTI_SHOT_CYCLE_RULE, MULTI_SHOT_PROCESS_GROUP, shotEntriesOf, shotEntriesPatch, shotEntriesProblem, type MultiShotSummary, type ShotEntry,
} from '@/lib/costing/multi-shot-view';

interface Props {
  multiShot: MultiShotSummary | null | undefined;
  /** The part's scenario overrides. */
  overrides: Record<string, unknown> | null | undefined;
  /** Writes scenario keys; null clears one. */
  onChange: (patch: Record<string, unknown>) => void;
  /** The page of a BOM child (a shot or a component), to open it. */
  hrefOf?: (itemId: string) => string;
}

const headClass = 'text-[11px] font-medium uppercase tracking-wide text-muted-foreground';
const boxClass = 'divide-y divide-border rounded-md border border-border';
const rowClass = 'flex items-baseline justify-between gap-3 px-2 py-1.5';
const controlClass = 'w-full min-w-0 text-sm border border-border rounded-md px-2 py-1.5 bg-background focus:outline-hidden focus:ring-1 focus:ring-brand-500';
const seconds = (s: number | null) => (s == null ? '—' : `${s.toFixed(1)} s`);
const cm3 = (mm3: number) => `${(mm3 / 1000).toFixed(1)} cm³`;

function Row({ label, children, title }: { label: ReactNode; children: ReactNode; title?: string }) {
  return (
    <li className={rowClass} title={title}>
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right tabular-nums">{children}</span>
    </li>
  );
}

/**
 * The extra shots' editor: a moldable grade and a share of the part per shot. Saved the moment the shots are complete (a grade picked, a share
 * left), never held for a second button: Apply prices what is saved, so a picked grade waiting on "Save shots" was a shot Apply never saw.
 */
function ShotEntriesForm({ start, onSave, onCancel }: { start: ShotEntry[]; onSave: (entries: ShotEntry[]) => void; onCancel?: (() => void) | undefined }) {
  const [entries, setEntries] = useState<ShotEntry[]>(start.length > 0 ? start : [{ grade: '', volumePct: 30 }]);
  // The grades a multi-shot part can mold (the backend offers only molding feedstock for this process).
  const { data } = useRawMaterials({ processGroup: MULTI_SHOT_PROCESS_GROUP, limit: 1000 });
  const grades = useMemo(() => [...new Set((data?.items ?? []).map((m) => m.materialGrade ?? m.material).filter(Boolean))].sort(), [data]);
  const problem = shotEntriesProblem(entries);
  const commit = (next: ShotEntry[]) => {
    setEntries(next);
    if (shotEntriesProblem(next) == null) onSave(next);
  };
  const with_ = (i: number, patch: Partial<ShotEntry>) => entries.map((e, j) => (j === i ? { ...e, ...patch } : e));
  return (
    <div className="space-y-2 rounded-md border border-border p-2">
      {entries.map((e, i) => (
        <div key={i} className="grid grid-cols-[1fr_5rem_auto] items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">Shot {i + 2} material</span>
            <select className={controlClass} value={e.grade} onChange={(ev) => { commit(with_(i, { grade: ev.target.value })); }}>
              <option value="">Pick a grade…</option>
              {grades.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">% of part</span>
            <input className={controlClass} type="number" min={1} max={99} value={e.volumePct}
              onChange={(ev) => { setEntries(with_(i, { volumePct: Number(ev.target.value) })); }} onBlur={() => { commit(entries); }} />
          </label>
          <Button size="sm" variant="ghost" aria-label={`Remove shot ${i + 2}`} onClick={() => { commit(entries.filter((_, j) => j !== i)); }}><X className="h-3.5 w-3.5" /></Button>
        </div>
      ))}
      <div className="flex items-center justify-between gap-2">
        <button type="button" className="text-brand-600 hover:underline" onClick={() => { setEntries([...entries, { grade: '', volumePct: 20 }]); }}>+ Add shot</button>
        {onCancel && <Button size="sm" variant="ghost" onClick={onCancel}>Close</Button>}
      </div>
      {problem && entries.length > 0 && <p className="text-amber-600">{problem}</p>}
    </div>
  );
}

/**
 * The Cost Guide's multi-shot inputs: the shots (the part's moldable BOM children, else the part and the extra materials entered here, read-only
 * with Edit and Delete) and the components loaded every shot. The press and the cycle the engine chose are in the Cost tab (MultiShotCycle); the
 * press orientations are the routes in the Workflow Builder.
 */
export function MultiShotSection({ multiShot: ms, overrides, onChange, hrefOf }: Props) {
  const [editing, setEditing] = useState(false);
  // What was just saved, shown until the part's overrides come back with it.
  const [local, setLocal] = useState<ShotEntry[] | null>(null);
  useEffect(() => { setLocal(null); }, [overrides]);
  if (!ms) return <p className="text-xs text-muted-foreground">Costing the multi-shot molding…</p>;

  const fromBom = ms.shots.length > 0 && ms.shots.every((s) => s.source === 'bom');
  const entries = local ?? shotEntriesOf(overrides);
  // One shot is not a multi-shot part: until the engine costs two, the panel keeps the shot form open (with what is saved, if anything), so the
  // place to add the material never hides behind a saved-but-not-costed state.
  const asking = !fromBom && ms.shots.length < 2 && !editing;
  const save = (next: ShotEntry[]) => { onChange(shotEntriesPatch(next)); setLocal(next); setEditing(false); };
  const action = 'text-brand-600 hover:underline';
  const link = (name: string, id: string | null) => (hrefOf && id ? <a className={action} href={hrefOf(id)}>{name}</a> : <span className="text-foreground">{name}</span>);

  return (
    <div className="space-y-4 text-xs">
      <section className="space-y-1.5">
        <div className="flex items-baseline justify-between">
          <h4 className={headClass}>Shots</h4>
          {!fromBom && !editing && !asking && (
            <span className="flex gap-3">
              <button type="button" className={action} onClick={() => { setEditing(true); }}>{entries.length > 0 ? 'Edit' : 'Add shot'}</button>
              {entries.length > 0 && <button type="button" className="text-red-600 hover:underline" onClick={() => { save([]); }}>Delete</button>}
            </span>
          )}
        </div>
        {asking ? (
          <div className="space-y-1.5">
            <p className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
              What is the second shot? {ms.shots[0] ? `Shot 1 is the part (${ms.shots[0].grade ?? 'its material'}).` : ''} Pick the material molded onto it and its share of the part,
              or add each shot as a BOM child with its own CAD and material.
            </p>
            <ShotEntriesForm key={JSON.stringify(entries)} start={entries} onSave={save} />
            {entries.length > 0 && <p className="text-muted-foreground">Saved; costing the shots…</p>}
          </div>
        ) : editing ? (
          <ShotEntriesForm start={entries} onSave={save} onCancel={() => { setEditing(false); }} />
        ) : ms.shots.length >= 2 ? (
          <ul className={boxClass}>
            {ms.shots.map((s, i) => (
              <Row key={`${s.name}-${String(i)}`} label={<>{i + 1}. {link(s.name, s.source === 'bom' ? s.itemId : null)}<span className="block">{s.grade ?? 'no material'}</span></>}>
                {s.volumePct != null ? `${String(s.volumePct)} %` : cm3(s.volumeMm3)}
              </Row>
            ))}
          </ul>
        ) : (
          <p className="rounded-md border border-dashed border-border px-2 py-1.5 text-muted-foreground">
            One shot so far. Add the second material here (a share of the part), or add each shot as a BOM child of this part with its CAD and material.
          </p>
        )}
      </section>

      {ms.components.length > 0 && (
        <section className="space-y-1.5">
          <h4 className={headClass}>Loaded components</h4>
          <ul className={boxClass}>
            {ms.components.map((c) => (
              <Row key={c.id ?? c.name} label={<>{link(c.name, c.id)} × {c.perPart}</>}>
                {c.massKg != null ? `${(Math.round(c.massKg * 10_000) / 10).toString()} g each` : <span className="text-muted-foreground">weight not given</span>}
              </Row>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** The Cost tab's multi-shot cycle: the press the engine chose, each shot's cycle, the index and the cycle they make. */
export function MultiShotCycle({ multiShot: ms }: { multiShot: MultiShotSummary }) {
  if (ms.shots.length < 2) return <p className="text-xs text-amber-600">Not timed yet: a multi-shot part needs a second shot (Cost Guide).</p>;
  if (!ms.press.name) return <p className="text-xs text-amber-600">{ms.press.reasons[0] ?? 'No multi-shot press molds the shots.'}</p>;
  const p = ms.press;
  return (
    <ul className={`${boxClass} text-xs`}>
      <Row label="Press">
        <span className="text-foreground">{p.name}</span>
        <span className="block text-muted-foreground">
          {[p.orientation, p.units != null ? `${String(p.units)} units` : null, p.stations != null ? `${String(p.stations)} station${p.stations === 1 ? '' : 's'}` : null, p.rotatingStack ? 'rotary stack' : null].filter(Boolean).join(' · ')}
        </span>
      </Row>
      {ms.shots.map((s, i) => (
        <Row key={`${s.name}-${String(i)}`} label={<>Shot {i + 1}<span className="block">{s.grade ?? s.name}</span></>}>{seconds(s.cycleSec)}</Row>
      ))}
      {ms.loadSecPerPart != null && (
        <Row label={<>Component loading{ms.loaderName && <span className="block">{ms.loaderName}</span>}</>}>{seconds(ms.loadSecPerPart)}</Row>
      )}
      <Row label="Tool index">{seconds(p.indexSec)}</Row>
      <Row label={<span className="font-medium text-foreground">Cycle</span>} title="Every station molds at once: the press waits for the longest shot (or the loading), then the mold indexes.">
        <span className="font-medium text-foreground">{seconds(ms.cycleSec)}</span>
        <span className="block text-muted-foreground">{MULTI_SHOT_CYCLE_RULE}</span>
      </Row>
    </ul>
  );
}
