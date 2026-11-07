'use client';

import { useState } from 'react';

import { type PlasticDfmFinding, usePlasticDfm } from '@/lib/api/hooks/useBOMItems';
import type { FeatureNodeV2 } from '@/lib/types/manufacturing';

const SEVERITY_CLASS = {
  Critical: { card: 'border-red-500/30 bg-red-500/10', badge: 'text-red-400 bg-red-500/20', color: '#ef4444' },
  Major: { card: 'border-orange-500/30 bg-orange-500/10', badge: 'text-orange-400 bg-orange-500/20', color: '#f97316' },
  Minor: { card: 'border-amber-500/30 bg-amber-500/10', badge: 'text-amber-400 bg-amber-500/20', color: '#eab308' },
} as const;

/** The faces of a finding as the node the viewer highlights (the same shape every highlight in the cost guide uses). */
export function findingHighlight(f: PlasticDfmFinding): FeatureNodeV2 {
  return { id: `dfm_${f.rule}_${f.severity}`, feature_type: 'Blank', occurrences: [{ centroid: [0, 0, 0], face_ids: f.faces }] };
}

/**
 * The design-for-molding findings of a plastic part, graded by the staged rule data for the part's material. Each finding can be clicked to highlight what is wrong
 * on the model; the rules the analysis cannot judge yet are listed with the reason, never shown as passed.
 */
export function PlasticDfmFindings({ itemId, onSelectHighlight }: { itemId: string; onSelectHighlight: (node: FeatureNodeV2 | null) => void }) {
  const { data, isLoading, error } = usePlasticDfm(itemId, true);
  const [selected, setSelected] = useState<string | null>(null);
  const [showUnjudged, setShowUnjudged] = useState(false);

  if (isLoading) return <p className="text-[11px] text-muted-foreground">Checking the part against the rule data…</p>;
  if (error || !data) return <p className="text-[11px] text-muted-foreground">The rule-based checks could not be loaded.</p>;
  if (data.status !== 'ok' || !data.result) return <p className="text-[11px] text-muted-foreground">{data.reasons.join(' ') || 'No rule-based checks yet.'}</p>;
  const { findings, passed, notEvaluated, notes, process, materialType } = data.result;

  const select = (f: PlasticDfmFinding) => {
    const key = `${f.rule}_${f.severity}_${f.featureIds.join(',')}`;
    if (selected === key) { setSelected(null); onSelectHighlight(null); return; }
    setSelected(key);
    onSelectHighlight(f.faces.length > 0 ? findingHighlight(f) : null);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Rule-based checks</h3>
        <span className="text-[10px] text-muted-foreground truncate" title="The rule data is chosen by the process and the material type">{process} · {materialType ?? 'general limits'}</span>
      </div>
      {[...data.reasons, ...(notes ?? [])].map((r) => <p key={r} className="text-[10px] text-amber-500">{r}</p>)}
      {findings.length === 0 && <p className="text-[11px] text-muted-foreground">No rule that could be measured is violated ({passed.length} passed).</p>}
      {findings.map((f) => {
        const cls = SEVERITY_CLASS[f.severity];
        const key = `${f.rule}_${f.severity}_${f.featureIds.join(',')}`;
        return (
          <button key={key} type="button" onClick={() => { select(f); }}
            className={`w-full text-left rounded border p-2 space-y-1 transition-shadow ${cls.card} ${selected === key ? 'ring-1 ring-primary' : ''}`}
            title={f.faces.length > 0 ? 'Click to highlight on the model' : 'This finding has no faces to highlight'}>
            <div className="flex items-center gap-1.5">
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase ${cls.badge}`}>{f.severity}</span>
              <span className="text-[10px] text-muted-foreground">{f.rule}</span>
              {f.faces.length > 0 && <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">{f.faces.length} face{f.faces.length === 1 ? '' : 's'}</span>}
            </div>
            <p className="text-xs leading-snug">{f.label}</p>
            {f.note && <p className="text-[11px] text-muted-foreground">{f.note}</p>}
          </button>
        );
      })}
      {notEvaluated.length > 0 && (
        <div>
          <button type="button" onClick={() => { setShowUnjudged((v) => !v); }} className="text-[10px] text-muted-foreground underline underline-offset-2">
            {showUnjudged ? 'Hide' : 'Show'} {notEvaluated.length} rule{notEvaluated.length === 1 ? '' : 's'} that could not be judged
          </button>
          {showUnjudged && (
            <ul className="mt-1 space-y-0.5">
              {notEvaluated.map((n) => <li key={n.rule} className="text-[10px] text-muted-foreground"><span className="font-medium">{n.rule}</span>: {n.reason}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
