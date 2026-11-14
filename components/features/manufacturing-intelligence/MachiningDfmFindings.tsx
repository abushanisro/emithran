'use client';

import { useState } from 'react';

import { type MachiningDfmCheck, type MachiningDfmFinding, useMachiningDfm } from '@/lib/api/hooks/useBOMItems';
import { machiningDfmHighlight } from '@/lib/features/machining-dfm-highlight';
import type { FeatureNodeV2 } from '@/lib/types/manufacturing';

const SEVERITY_CLASS = {
  critical: { card: 'border-red-500/30 bg-red-500/10', badge: 'text-red-400 bg-red-500/20' },
  major: { card: 'border-orange-500/30 bg-orange-500/10', badge: 'text-orange-400 bg-orange-500/20' },
  minor: { card: 'border-amber-500/30 bg-amber-500/10', badge: 'text-amber-400 bg-amber-500/20' },
} as const;

const STATUS_ICON = {
  passed: <span className="text-emerald-400 text-sm leading-none">✓</span>,
  failed: <span className="text-amber-400 text-sm leading-none">!</span>,
  not_evaluated: <span className="text-muted-foreground text-sm leading-none">•</span>,
} as const;

interface Props {
  itemId: string;
  features: readonly FeatureNodeV2[];
  onSelectHighlight?: ((node: FeatureNodeV2 | null) => void) | undefined;
}

/** The findings of a machined part and the selection that highlights a finding's instances on the model. */
function useFindings({ itemId, features, onSelectHighlight }: Props) {
  const { data, isLoading, error } = useMachiningDfm(itemId, true);
  const [selected, setSelected] = useState<string | null>(null);
  const keyOf = (f: MachiningDfmFinding) => `${f.rule}_${f.severity}`;
  const select = (f: MachiningDfmFinding) => {
    const key = keyOf(f);
    if (selected === key) { setSelected(null); onSelectHighlight?.(null); return; }
    setSelected(key);
    onSelectHighlight?.(machiningDfmHighlight(f, features));
  };
  return { data, isLoading, error, selected, keyOf, select };
}

function CheckRow({ check, onClick, active }: { check: MachiningDfmCheck; onClick?: (() => void) | undefined; active?: boolean }) {
  const body = (
    <>
      <span className="shrink-0 mt-0.5 w-3">{STATUS_ICON[check.status]}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-1.5 flex-wrap">
          <span className="font-medium text-foreground">{check.name}</span>
          {check.status !== 'not_evaluated' && <span className="font-mono text-foreground/70">{check.detail}</span>}
        </div>
        {check.status === 'not_evaluated'
          ? <p className="text-muted-foreground mt-0.5 leading-snug">Not evaluated: {check.detail}</p>
          : <p className="text-muted-foreground mt-0.5 leading-snug">Limit {check.limit} · {check.source}</p>}
      </div>
    </>
  );
  return onClick
    ? <button type="button" onClick={onClick} title="Click to highlight on the model" className={`w-full text-left px-2 py-1.5 flex items-start gap-2 hover:bg-muted/40 ${active ? 'bg-primary/10' : ''}`}>{body}</button>
    : <div className="px-2 py-1.5 flex items-start gap-2">{body}</div>;
}

/**
 * The design-for-machining findings of a part, graded against the machining reference limits. A finding is clicked to
 * highlight the instances it is about on the model. Every check is listed with its limit and where the limit is from;
 * one that could not be judged says why and is never shown as passed.
 */
export function MachiningDfmFindings(props: Props) {
  const { data, isLoading, error, selected, keyOf, select } = useFindings(props);
  const [showChecks, setShowChecks] = useState(false);

  if (isLoading) return <p className="text-[11px] text-muted-foreground">Checking the part against the machining reference…</p>;
  if (error || !data) return <p className="text-[11px] text-muted-foreground">The machining checks could not be loaded.</p>;
  if (data.status !== 'ok' || !data.result) return <p className="text-[11px] text-muted-foreground">{data.reasons.join(' ') || 'No machining checks yet.'}</p>;
  const { findings, checks } = data.result;
  const count = (status: MachiningDfmCheck['status']) => checks.filter((c) => c.status === status).length;

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Design for machining</h3>
        <span className="text-[10px] text-muted-foreground tabular-nums">{count('failed')} failed · {count('passed')} passed · {count('not_evaluated')} not evaluated</span>
      </div>
      {findings.length === 0 && <p className="text-[11px] text-muted-foreground">No check that could be measured is failed.</p>}
      {findings.map((f) => {
        const cls = SEVERITY_CLASS[f.severity];
        const key = keyOf(f);
        const instances = f.occurrences.length;
        return (
          <button key={key} type="button" onClick={() => { select(f); }}
            className={`w-full text-left rounded border p-2 space-y-1 transition-shadow ${cls.card} ${selected === key ? 'ring-1 ring-primary' : ''}`}
            title={instances > 0 ? 'Click to highlight on the model' : 'This finding is about the part as a whole'}>
            <div className="flex items-center gap-1.5">
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase ${cls.badge}`}>{f.severity}</span>
              <span className="text-[10px] text-muted-foreground">{f.rule}</span>
              {instances > 0 && <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">{instances} instance{instances === 1 ? '' : 's'}</span>}
            </div>
            <p className="text-xs leading-snug">{f.label}</p>
            <p className="text-[11px] text-muted-foreground">Limit: {f.limit} · {f.source}</p>
            <p className="text-[11px] text-muted-foreground">→ {f.recommendation}</p>
          </button>
        );
      })}
      <div>
        <button type="button" onClick={() => { setShowChecks((v) => !v); }} className="text-[10px] text-muted-foreground underline underline-offset-2">
          {showChecks ? 'Hide' : 'Show'} all {checks.length} checks
        </button>
        {showChecks && (
          <div className="mt-1 divide-y divide-border/30 border border-border/40 rounded text-[11px]">
            {checks.map((c) => <CheckRow key={c.rule} check={c} />)}
          </div>
        )}
      </div>
    </div>
  );
}

/** The same checks as rows of the Validation tab's DFM Checks list; a failed check highlights its instances when clicked. */
export function MachiningDfmCheckRows(props: Props) {
  const { data, isLoading, selected, keyOf, select } = useFindings(props);
  if (isLoading) return <div className="px-2 py-1.5 text-muted-foreground">Checking the part against the machining reference…</div>;
  const result = data?.status === 'ok' ? data.result : null;
  if (!result) return null;
  return (
    <>
      {result.checks.map((c) => {
        // The most severe finding of the check is the one a click highlights.
        const finding = result.findings.find((f) => f.rule === c.rule && f.occurrences.length > 0);
        return <CheckRow key={c.rule} check={c} onClick={finding ? () => { select(finding); } : undefined} active={!!finding && selected === keyOf(finding)} />;
      })}
    </>
  );
}
