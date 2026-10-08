'use client';

// GD&T tab: required tolerances per geometric cost driver (feature instance).
//
//   Select a Geometric Cost Driver   every detected feature instance, grouped
//                                    by type, with its status: held by the
//                                    primary process, needs machining, or
//                                    undecided (GET /bom-items/:id/machining-need)
//   Edit Tolerances...               Auto / Manual per category for the
//                                    selected feature (feature_tolerances)
//   Tolerance Policy...              what Auto means for every feature
//                                    (scenario_overrides.tolerancePolicy)
//   toleranced features              every feature with a requirement, each
//                                    value with where it came from
//   drawing callouts                 the drawing's feature control frames, for
//                                    reference: a drawing callout names no
//                                    face, so it is entered on its feature here
//
// Everything shown is the backend's resolution; nothing is decided here.

import { ChevronDown, ChevronRight, CircleAlert, CircleCheck, CircleHelp, Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useGdtAnalysis } from '@/lib/api/hooks/useBOMItems';
import {
  useFeatureTolerances,
  useMachiningNeed,
  useSetFeatureTolerances,
  useSetTolerancePolicy,
  type FeatureInstance,
  type FeatureMachiningNeed,
  type GtolCategory,
  type ResolvedRequirement,
  type TolerancePolicy,
} from '@/lib/api/hooks/useFeatureTolerances';
import { GDT_CATEGORIES, formatRequirement, type GdtCategoryMeta } from '@/lib/features/gdt-categories';
import type { FeatureGraph, FeatureNodeV2 } from '@/lib/types/manufacturing';

const SOURCE_LABEL: Record<ResolvedRequirement['source'], string> = {
  manual: 'Manual',
  policy_uniform: 'Policy',
  cad_model: 'CAD model',
  cad_model_replaced: 'CAD model (replaced)',
};

const POLICY_LABEL: Record<TolerancePolicy['mode'], string> = {
  assume_achieved: 'Assume achieved by the selected operation',
  uniform: 'Use the following values',
  cad: 'Use CAD model values',
};

export function GcdToleranceTab({ itemId, fg, onSelectHighlight }: {
  itemId: string;
  fg: FeatureGraph | null;
  onSelectHighlight?: (node: FeatureNodeV2 | null) => void;
}) {
  const { data: view, isLoading } = useFeatureTolerances(itemId);
  const { data: need } = useMachiningNeed(itemId);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<FeatureInstance | null>(null);
  const [policyOpen, setPolicyOpen] = useState(false);
  // Groups start collapsed (a part can carry hundreds of edges and walls).
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const needByLabel = useMemo(
    () => new Map((need?.result?.features ?? []).map((f) => [f.label, f])),
    [need],
  );
  const v2 = fg?.feature_graph_v2?.features ?? [];
  const highlight = (inst: FeatureInstance) => {
    const entry = v2.find((x) => x.id === inst.featureId);
    const occ = entry?.occurrences[inst.occurrenceIndex];
    if (entry && occ) onSelectHighlight?.({ id: `gcd-${inst.label}`, feature_type: entry.feature_type, occurrences: [occ] });
  };

  if (isLoading) return <div className="p-3 text-xs text-muted-foreground flex items-center gap-1.5"><Loader2 className="h-3 w-3 animate-spin" />Loading features…</div>;
  const instances = view?.instances ?? [];
  if (instances.length === 0) {
    return (
      <div className="p-4 text-center text-xs text-muted-foreground">
        No detected features yet. Refresh Analysis extracts the part&apos;s features; each one then takes its required tolerances here.
      </div>
    );
  }

  const groups = new Map<string, typeof instances>();
  for (const i of instances) groups.set(i.instance.featureType, [...(groups.get(i.instance.featureType) ?? []), i]);
  const selectedEntry = instances.find((i) => i.instance.label === selected) ?? null;
  const toleranced = instances.filter((i) => i.requirements.length > 0);

  return (
    <div className="flex flex-col gap-2 p-2 text-xs">
      <div className="flex items-center justify-between">
        <span className="font-semibold">Select a Geometric Cost Driver</span>
        <span className="text-[10px] text-muted-foreground truncate" title={view ? POLICY_LABEL[view.policy.mode] : ''}>
          Policy: {view ? POLICY_LABEL[view.policy.mode] : '—'}
        </span>
      </div>

      {need && !need.assessed && (
        <p className="text-[10px] text-amber-600 dark:text-amber-400 leading-tight">
          Status not assessed: {need.reason}{need.missing.length ? ` (${need.missing.join(', ')})` : ''}
        </p>
      )}

      {/* ── Feature tree ── */}
      <div className="border border-border rounded max-h-64 overflow-y-auto">
        <div className="grid grid-cols-[2.5rem_1fr] px-2 py-1 bg-muted/50 text-[10px] font-semibold text-muted-foreground sticky top-0">
          <span>Status</span><span>Name</span>
        </div>
        {[...groups.entries()].map(([type, members]) => {
          const open = expanded.has(type);
          const flagged = members.filter((m) => needByLabel.get(m.instance.label)?.verdict === 'needs_machining').length;
          const toleranced = members.filter((m) => m.requirements.length > 0).length;
          return (
            <div key={type}>
              <button
                type="button"
                onClick={() => { setExpanded((s) => { const n = new Set(s); if (n.has(type)) n.delete(type); else n.add(type); return n; }); }}
                className="w-full flex items-center gap-1 px-2 py-0.5 hover:bg-muted/40 text-left"
              >
                {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                <span className="font-medium">{type}</span>
                <span className="text-muted-foreground">[{members.length}]</span>
                {flagged > 0 && <span className="ml-auto text-[10px] text-amber-600">{flagged} need machining</span>}
                {flagged === 0 && toleranced > 0 && <span className="ml-auto text-[10px] text-violet-500">{toleranced} toleranced</span>}
              </button>
              {open && members.map(({ instance, requirements }) => (
                <button
                  key={instance.label}
                  type="button"
                  onClick={() => { setSelected(instance.label); highlight(instance); }}
                  onDoubleClick={() => instance.key && setEditing(instance)}
                  className={`w-full grid grid-cols-[2.5rem_1fr] items-center px-2 py-0.5 text-left hover:bg-muted/40 ${selected === instance.label ? 'bg-violet-500/10' : ''}`}
                >
                  <StatusIcon need={needByLabel.get(instance.label)} />
                  <span className="pl-4 truncate">
                    {instance.label}
                    {requirements.length > 0 && <span className="text-violet-500"> · {requirements.length} tol.</span>}
                  </span>
                </button>
              ))}
            </div>
          );
        })}
      </div>

      <div className="flex justify-end gap-1.5">
        <Button
          size="sm" variant="outline" className="h-7 text-xs"
          disabled={!selectedEntry?.instance.key}
          title={selectedEntry && !selectedEntry.instance.key ? 'This feature has no stable face identity; re-run analysis.' : undefined}
          onClick={() => selectedEntry && setEditing(selectedEntry.instance)}
        >Edit Tolerances…</Button>
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setPolicyOpen(true); }}>Tolerance Policy…</Button>
      </div>

      {selectedEntry && <SelectedStatus need={needByLabel.get(selectedEntry.instance.label)} instance={selectedEntry.instance} />}

      {/* ── Toleranced features ── */}
      {toleranced.length > 0 && (
        <div className="border-t border-border/50 pt-1.5 space-y-1.5">
          {toleranced.map(({ instance, requirements }) => (
            <div key={instance.label}>
              <div className="flex items-center justify-between">
                <button type="button" className="font-medium hover:text-violet-500" onClick={() => { setSelected(instance.label); highlight(instance); }}>
                  {instance.label}
                </button>
                {instance.key && (
                  <Button size="sm" variant="outline" className="h-6 px-2 text-[11px]" onClick={() => { setEditing(instance); }}>Revise</Button>
                )}
              </div>
              {requirements.map((r) => (
                <div key={r.category} className="flex justify-between text-[11px] text-muted-foreground pl-2">
                  <span>{formatRequirement(r.category, r.value)}</span>
                  <span title={r.note}>{SOURCE_LABEL[r.source]}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {(view?.orphanedManual.length ?? 0) > 0 && (
        <p className="text-[10px] text-amber-600 dark:text-amber-400">
          {view!.orphanedManual.length} manual tolerance{view!.orphanedManual.length === 1 ? '' : 's'} belong to features that changed on re-analysis and no longer apply.
        </p>
      )}
      {(view?.unappliedCad.length ?? 0) > 0 && (
        <div className="text-[10px] text-muted-foreground">
          CAD tolerances not applied:
          {view!.unappliedCad.map((u, i) => <div key={i} className="pl-2">{u.type} {u.toleranceMm} mm — {u.reason}</div>)}
        </div>
      )}

      <DrawingCallouts itemId={itemId} />

      {editing && view && (
        <EditTolerancesDialog
          itemId={itemId}
          instance={editing}
          current={instances.find((i) => i.instance.label === editing.label)?.requirements ?? []}
          policy={view.policy}
          onClose={() => { setEditing(null); }}
        />
      )}
      {policyOpen && view && <TolerancePolicyDialog itemId={itemId} policy={view.policy} onClose={() => { setPolicyOpen(false); }} />}
    </div>
  );
}

function StatusIcon({ need }: { need: FeatureMachiningNeed | undefined }) {
  if (!need) return <span className="text-muted-foreground/50">—</span>;
  if (need.verdict === 'needs_machining') return <span title="Needs machining"><CircleAlert className="h-3.5 w-3.5 text-amber-500" /></span>;
  if (need.verdict === 'undecided') return <span title="Could not be assessed"><CircleHelp className="h-3.5 w-3.5 text-muted-foreground" /></span>;
  return <span title="Held by the primary process"><CircleCheck className="h-3.5 w-3.5 text-emerald-500" /></span>;
}

function SelectedStatus({ need, instance }: { need: FeatureMachiningNeed | undefined; instance: FeatureInstance }) {
  return (
    <div className="rounded border border-border/60 bg-muted/20 p-2 space-y-0.5 text-[11px]">
      <div className="flex justify-between"><span className="font-medium">{instance.label}</span>
        {instance.sizeMm != null && <span className="text-muted-foreground">size {instance.sizeMm} mm ({instance.sizeSource})</span>}
      </div>
      {!need ? <p className="text-muted-foreground">Not assessed.</p> : (
        <>
          <p>{need.verdict === 'needs_machining' ? 'Needs machining' : need.verdict === 'undecided' ? 'Could not be assessed' : 'Held by the primary process'}</p>
          {need.forming && <p className="text-muted-foreground">Formed by {need.forming.operation} (the casting does not form it)</p>}
          {need.candidates.length > 0 && <p className="text-muted-foreground">Finished by one of: {need.candidates.map((c) => c.operation).join(' / ')} (the cheapest is costed)</p>}
          {need.reasons.map((r, i) => <p key={i} className="text-muted-foreground leading-tight">{r}</p>)}
        </>
      )}
    </div>
  );
}

// ── Edit Tolerances ───────────────────────────────────────────────────────────

type Draft = Record<GtolCategory, { mode: 'auto' | 'manual'; value: string }>;

function EditTolerancesDialog({ itemId, instance, current, policy, onClose }: {
  itemId: string;
  instance: FeatureInstance;
  current: ResolvedRequirement[];
  policy: TolerancePolicy;
  onClose: () => void;
}) {
  const save = useSetFeatureTolerances(itemId);
  const manual = new Map(current.filter((r) => r.source === 'manual').map((r) => [r.category, r.value]));
  const auto = new Map(current.filter((r) => r.source !== 'manual').map((r) => [r.category, r]));
  const initial = Object.fromEntries(GDT_CATEGORIES.map((c) => [c.key, manual.has(c.key)
    ? { mode: 'manual', value: String(manual.get(c.key)) }
    : { mode: 'auto', value: '' }])) as Draft;
  const [draft, setDraft] = useState<Draft>(initial);
  const [error, setError] = useState<string | null>(null);

  const autoText = (c: GdtCategoryMeta) => {
    const a = auto.get(c.key);
    if (a) return `${c.plusMinus ? '±' : ''}${a.value} ${c.unit} (${SOURCE_LABEL[a.source]})`;
    if (policy.mode === 'uniform' && policy.values[c.key] != null) return `${c.plusMinus ? '±' : ''}${policy.values[c.key]} ${c.unit} (Policy)`;
    return '<unspecified>';
  };

  const submit = async (close: boolean) => {
    const values: Partial<Record<GtolCategory, number | null>> = {};
    for (const c of GDT_CATEGORIES) {
      const d = draft[c.key];
      if (d.mode === 'manual') {
        const v = Number(d.value);
        if (!(v > 0)) { setError(`${c.label}: enter a positive value or choose Auto.`); return; }
        if (manual.get(c.key) !== v) values[c.key] = v;
      } else if (manual.has(c.key)) {
        values[c.key] = null;
      }
    }
    setError(null);
    if (Object.keys(values).length > 0) await save.mutateAsync({ featureKey: instance.key!, values });
    if (close) onClose();
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-4xl p-0 overflow-hidden" style={{ maxHeight: '90vh' }}>
        <DialogHeader className="px-4 pt-3 pb-2 border-b">
          <DialogTitle>Tolerance Editor — {instance.label}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-[1fr_20rem] min-h-0" style={{ maxHeight: '68vh' }}>
          <div className="overflow-y-auto p-3 space-y-2 border-r">
            <p className="text-xs font-semibold">Set Tolerance and Roughness</p>
            {GDT_CATEGORIES.map((c) => {
              const d = draft[c.key];
              return (
                <fieldset key={c.key} className="border border-border/60 rounded px-2 py-1">
                  <legend className="text-[11px] px-1">{c.label}{c.plusMinus ? ' (±)' : ''}{c.note ? ` — ${c.note}` : ''}</legend>
                  <label className="flex items-center gap-2 text-xs">
                    <input type="radio" checked={d.mode === 'auto'} onChange={() => { setDraft({ ...draft, [c.key]: { ...d, mode: 'auto' } }); }} className="accent-violet-600" />
                    Auto <span className="text-muted-foreground">[{autoText(c)}]</span>
                  </label>
                  <label className="flex items-center gap-2 text-xs">
                    <input type="radio" checked={d.mode === 'manual'} onChange={() => { setDraft({ ...draft, [c.key]: { ...d, mode: 'manual' } }); }} className="accent-violet-600" />
                    Manual
                    <input
                      type="number" min={0} step="any"
                      value={d.value}
                      onChange={(e) => { setDraft({ ...draft, [c.key]: { mode: 'manual', value: e.target.value } }); }}
                      placeholder="<none>"
                      className="ml-auto w-24 border border-border rounded px-1.5 py-0.5 text-right bg-background"
                    />
                    <span className="w-8 text-muted-foreground">{c.unit}</span>
                  </label>
                </fieldset>
              );
            })}
          </div>
          <ToleranceLegend />
        </div>
        <DialogFooter className="px-4 py-2 border-t items-center">
          {error && <span className="text-xs text-destructive mr-auto">{error}</span>}
          <Button size="sm" onClick={() => submit(true)} disabled={save.isPending}>OK</Button>
          <Button size="sm" variant="outline" onClick={onClose}>Cancel</Button>
          <Button size="sm" variant="outline" onClick={() => submit(false)} disabled={save.isPending}>Apply</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ToleranceLegend() {
  const group = (g: GdtCategoryMeta['group']) => GDT_CATEGORIES.filter((c) => c.group === g);
  const Row = ({ c }: { c: GdtCategoryMeta }) => (
    <div className="flex items-center justify-between gap-2 py-0.5">
      <span className="text-xs">{c.label.replace(' (coordinate)', '')}{c.note ? ' *' : ''}</span>
      <span className="w-12 text-center border border-border rounded text-sm leading-6">{c.symbol}</span>
    </div>
  );
  return (
    <div className="overflow-y-auto p-3 bg-muted/10">
      <p className="text-xs font-semibold mb-1">Description</p>
      <p className="text-lg font-bold text-center mb-2">Tolerances</p>
      <p className="text-[11px] font-semibold">Geometric Tolerances</p>
      {group('geometric').map((c) => <Row key={c.key} c={c} />)}
      <p className="text-[11px] font-semibold mt-2">Coordinate Tolerances</p>
      {group('coordinate').map((c) => <Row key={c.key} c={c} />)}
      <p className="text-[11px] font-semibold mt-2">Surface Texture</p>
      {group('surface').map((c) => <Row key={c.key} c={c} />)}
      <p className="text-[10px] text-muted-foreground mt-2">* Bar and tube only. ± values are entered as the plus/minus amount; geometric tolerances as the tolerance zone width.</p>
    </div>
  );
}

// ── Tolerance Policy ──────────────────────────────────────────────────────────

function TolerancePolicyDialog({ itemId, policy, onClose }: { itemId: string; policy: TolerancePolicy; onClose: () => void }) {
  const save = useSetTolerancePolicy(itemId);
  const [mode, setMode] = useState<TolerancePolicy['mode']>(policy.mode);
  const [values, setValues] = useState<Record<string, string>>(
    policy.mode === 'uniform' ? Object.fromEntries(Object.entries(policy.values).map(([k, v]) => [k, String(v)])) : {},
  );
  const rb = policy.mode === 'cad' ? policy.replaceBelow : null;
  const [replace, setReplace] = useState(rb != null);
  const [threshold, setThreshold] = useState(rb ? String(rb.thresholdMm) : '');
  const [withMm, setWithMm] = useState(rb ? String(rb.withMm) : '');
  const [error, setError] = useState<string | null>(null);

  const build = (): TolerancePolicy | string => {
    if (mode === 'assume_achieved') return { mode };
    if (mode === 'uniform') {
      const out: Partial<Record<GtolCategory, number>> = {};
      for (const [k, v] of Object.entries(values)) {
        if (v.trim() === '') continue;
        const n = Number(v);
        if (!(n > 0)) return `${k}: enter a positive value or leave it empty.`;
        out[k as GtolCategory] = n;
      }
      return Object.keys(out).length ? { mode, values: out } : 'Enter at least one value.';
    }
    if (!replace) return { mode: 'cad', replaceBelow: null };
    const t = Number(threshold); const w = Number(withMm);
    return t > 0 && w > 0 ? { mode: 'cad', replaceBelow: { thresholdMm: t, withMm: w } } : 'Enter both replace values.';
  };
  const submit = async (close: boolean) => {
    const p = build();
    if (typeof p === 'string') { setError(p); return; }
    setError(null);
    await save.mutateAsync(p);
    if (close) onClose();
  };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-4xl p-0 overflow-hidden" style={{ maxHeight: '90vh' }}>
        <DialogHeader className="px-4 pt-3 pb-2 border-b">
          <DialogTitle>Tolerance Policy Editor</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-[1fr_20rem] min-h-0" style={{ maxHeight: '68vh' }}>
          <div className="overflow-y-auto p-3 space-y-3 text-xs border-r">
            <p className="text-muted-foreground">
              Enter required tolerance and roughness values for each feature with Edit Tolerances. This policy decides
              what a feature&apos;s Auto categories mean; the values decide which operations the part needs.
            </p>
            <label className="flex items-start gap-2">
              <input type="radio" checked={mode === 'assume_achieved'} onChange={() => { setMode('assume_achieved'); }} className="mt-0.5 accent-violet-600" />
              <span><b>Assume tolerance and roughness achieved by the manufacturing operation selected for the feature is sufficient</b></span>
            </label>
            <div>
              <label className="flex items-start gap-2">
                <input type="radio" checked={mode === 'uniform'} onChange={() => { setMode('uniform'); }} className="mt-0.5 accent-violet-600" />
                <span><b>Use the following values</b> for every feature:</span>
              </label>
              {mode === 'uniform' && (
                <div className="grid grid-cols-[1fr_6rem_2rem] gap-x-2 gap-y-0.5 pl-6 pt-1">
                  {GDT_CATEGORIES.map((c) => (
                    <div key={c.key} className="contents">
                      <span className="text-[11px] self-center">{c.label}{c.plusMinus ? ' (±)' : ''}</span>
                      <input
                        type="number" min={0} step="any" value={values[c.key] ?? ''}
                        onChange={(e) => { setValues({ ...values, [c.key]: e.target.value }); }}
                        className="border border-border rounded px-1.5 py-0.5 text-right bg-background"
                      />
                      <span className="text-muted-foreground self-center">{c.unit}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label className="flex items-start gap-2">
                <input type="radio" checked={mode === 'cad'} onChange={() => { setMode('cad'); }} className="mt-0.5 accent-violet-600" />
                <span><b>Use CAD model values</b> (tolerances carried in the STEP model, applied to the feature whose faces they name)</span>
              </label>
              {mode === 'cad' && (
                <div className="pl-6 pt-1 space-y-1">
                  <p className="text-muted-foreground">CAD models sometimes contain overly tight default tolerances. To ignore very small values, replace them:</p>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={replace} onChange={(e) => { setReplace(e.target.checked); }} />
                    Replace CAD tolerance values less than
                    <input type="number" min={0} step="any" value={threshold} onChange={(e) => { setThreshold(e.target.value); }} className="w-20 border border-border rounded px-1.5 py-0.5 text-right bg-background" />
                    mm with
                    <input type="number" min={0} step="any" value={withMm} onChange={(e) => { setWithMm(e.target.value); }} className="w-20 border border-border rounded px-1.5 py-0.5 text-right bg-background" />
                    mm
                  </label>
                </div>
              )}
            </div>
          </div>
          <ToleranceLegend />
        </div>
        <DialogFooter className="px-4 py-2 border-t items-center">
          {error && <span className="text-xs text-destructive mr-auto">{error}</span>}
          <Button size="sm" onClick={() => submit(true)} disabled={save.isPending}>OK</Button>
          <Button size="sm" variant="outline" onClick={onClose}>Cancel</Button>
          <Button size="sm" variant="outline" onClick={() => submit(false)} disabled={save.isPending}>Apply</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Drawing callouts (reference) ──────────────────────────────────────────────

function DrawingCallouts({ itemId }: { itemId: string }) {
  const { data: gdt } = useGdtAnalysis(itemId);
  const [open, setOpen] = useState(false);
  const features = gdt?.source && gdt.source !== 'no_data' ? gdt.features ?? [] : [];
  if (features.length === 0 && !gdt?.generalTolerance) return null;
  return (
    <div className="border-t border-border/50 pt-1.5">
      <button type="button" onClick={() => { setOpen(!open); }} className="flex items-center gap-1 font-medium">
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        Drawing callouts ({features.length})
      </button>
      {open && (
        <div className="pl-4 pt-1 space-y-0.5 text-[11px]">
          <p className="text-[10px] text-muted-foreground">
            From the {gdt!.source === 'step_pmi' ? 'STEP model' : 'drawing'}. A drawing callout names no face: enter it on the feature it applies to with Edit Tolerances.
          </p>
          {features.map((f, i) => (
            <div key={i} className="flex justify-between">
              <span className="capitalize">{f.type}{f.datum ? ` | ${f.datum}` : ''}</span>
              <span className="tabular-nums text-muted-foreground">{f.toleranceMm} mm</span>
            </div>
          ))}
          {gdt?.generalTolerance && <p className="text-[10px] text-muted-foreground">General: {gdt.generalTolerance}</p>}
        </div>
      )}
    </div>
  );
}
