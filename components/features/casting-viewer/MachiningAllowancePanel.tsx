"use client";

import { useState } from "react";

import { usePatchScenarioOverrides } from "@/lib/api/hooks/useBOMItems";
import {
  useDecideMachiningAllowance,
  type AllowanceBasis,
  type MachiningAllowanceSummary,
} from "@/lib/api/hooks/useMachiningAllowance";
import {
  BASIS_LABEL,
  RMAG_GRADES,
  SHORT_STATUS,
  STATUS_CLASS,
  STATUS_LABEL,
  decisionRequest,
  initialForm,
  sourceLine,
  valueLine,
  type DecisionForm,
} from "@/lib/features/machining-allowance-ui";
import { featureSelectionKey } from "@/lib/features/machining-feature-tree";

/**
 * The machining allowance of a sand-cast part: each machined feature with its value, where the value comes from and the as-cast size; the
 * engineer marks a feature machined or not and records a value with its source and reason; the part's RMAG grade picks a licensed dataset
 * value. Selecting a row highlights the feature in the 3D view. Shown only: no cost uses it.
 */
export function MachiningAllowancePanel({
  itemId,
  allowance,
  scenarioOverrides,
  selectedKey,
  onSelect,
}: {
  itemId: string;
  allowance: MachiningAllowanceSummary | null | undefined;
  /** The part's Cost Guide overrides: its RMAG grade is machiningAllowanceRmag, when set. */
  scenarioOverrides: Record<string, unknown> | null | undefined;
  selectedKey: string | null;
  onSelect?: (key: string | null) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const patch = usePatchScenarioOverrides();
  if (!allowance) return null;
  const rmag = scenarioOverrides?.machiningAllowanceRmag;

  const keyOf = (f: { featureId: string | null; occurrenceIndex: number }) =>
    f.featureId ? featureSelectionKey.occurrence(f.featureId, f.occurrenceIndex) : null;
  const toggle = (featureKey: string, selection: string | null) => {
    const next = open === featureKey ? null : featureKey;
    setOpen(next);
    onSelect?.(next ? selection : null);
  };

  return (
    <div data-testid="machining-allowance" className="mx-1 my-1 space-y-1 rounded border border-border/60 bg-muted/20 p-1.5 text-[10px]">
      <div className="font-medium text-foreground">Machining allowance <span className="font-normal text-muted-foreground">(shown only, not costed)</span></div>
      <div className="text-muted-foreground">
        Stock left on each machined face, from the drawing, a licensed standard, an approved foundry profile or an estimate, in that
        order. Not pattern shrinkage.
      </div>
      <div className="flex items-center gap-1">
        <label htmlFor={`rmag-${itemId}`} className="text-muted-foreground">RMAG grade</label>
        <select
          id={`rmag-${itemId}`}
          value={typeof rmag === "string" ? rmag : ""}
          disabled={patch.isPending}
          onChange={(e) => {
            patch.mutate({ id: itemId, patch: { machiningAllowanceRmag: e.target.value || null } });
          }}
          className="rounded border border-border bg-background px-1 py-0.5"
        >
          <option value="">not set</option>
          {RMAG_GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
        <span className="text-muted-foreground">used only with a licensed dataset</span>
      </div>

      {allowance.features.length === 0 && allowance.notMachined.length === 0 && (
        <div className="text-muted-foreground">No feature needs machining (set the required tolerances in the GD&amp;T tab).</div>
      )}

      {allowance.features.map((f) => {
        const isOpen = open === f.featureKey;
        const selection = keyOf(f);
        return (
          <div key={f.featureKey} data-testid="machining-allowance-row">
            <button
              type="button"
              aria-expanded={isOpen}
              onClick={() => { toggle(f.featureKey, selection); }}
              className={`flex w-full items-baseline gap-1 rounded px-0.5 text-left hover:bg-muted/50 ${selectedKey && selectedKey === selection ? "bg-muted/60" : ""}`}
            >
              <span>{isOpen ? "▾" : "▸"}</span>
              <span className="flex-1 text-foreground">{f.label}</span>
              <span className="font-medium text-foreground">{valueLine(f)}</span>
              <span className={`font-semibold ${STATUS_CLASS[f.status]}`}>{SHORT_STATUS[f.status]}</span>
            </button>
            {isOpen && (
              <div className="ml-3 space-y-0.5 border-l border-border pl-1.5">
                <div><span className={`font-medium ${STATUS_CLASS[f.status]}`}>{STATUS_LABEL[f.status]}</span></div>
                <div className="text-muted-foreground">Source: {sourceLine(f)}</div>
                {f.asCast && <div className="text-muted-foreground">As cast: {f.asCast.detail}</div>}
                {f.notes.map((n) => <div key={n} className="text-amber-700 dark:text-amber-500">{n}</div>)}
                {!selection && <div className="text-muted-foreground">Not tied to a model feature: no highlight.</div>}
                <DecisionEditor itemId={itemId} featureKey={f.featureKey} start={initialForm(f)} />
              </div>
            )}
          </div>
        );
      })}

      {allowance.notMachined.length > 0 && (
        <div className="space-y-0.5 border-t border-border/60 pt-1">
          <div className="text-muted-foreground">Marked not machined</div>
          {allowance.notMachined.map((n) => (
            <div key={n.featureKey}>
              <button
                type="button"
                aria-expanded={open === n.featureKey}
                onClick={() => { toggle(n.featureKey, null); }}
                className="flex w-full items-baseline gap-1 rounded px-0.5 text-left hover:bg-muted/50"
              >
                <span>{open === n.featureKey ? "▾" : "▸"}</span>
                <span className="flex-1 text-foreground">{n.label}</span>
                <span className="text-muted-foreground">{n.reason}{n.setBy ? ` (${n.setBy})` : ""}</span>
              </button>
              {open === n.featureKey && (
                <div className="ml-3 border-l border-border pl-1.5">
                  <DecisionEditor itemId={itemId} featureKey={n.featureKey} start={{ machined: true, allowanceMm: "", sides: "1", basis: "", reason: "" }} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Records the engineer's decision on one feature: machined with a value, its source and reason, or not machined with the reason. */
function DecisionEditor({ itemId, featureKey, start }: { itemId: string; featureKey: string; start: DecisionForm }) {
  const decide = useDecideMachiningAllowance(itemId);
  const [form, setForm] = useState<DecisionForm>(start);
  const [touched, setTouched] = useState(false);
  const built = decisionRequest(featureKey, form);
  const set = (p: Partial<DecisionForm>) => { setForm((f) => ({ ...f, ...p })); };

  return (
    <form
      className="mt-1 space-y-1 rounded border border-border/60 bg-background/40 p-1"
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if ("request" in built) decide.mutate(built.request, { onSuccess: () => { setTouched(false); set({ reason: "" }); } });
      }}
    >
      <div className="flex gap-2">
        {([true, false] as const).map((m) => (
          <label key={String(m)} className="flex items-center gap-0.5">
            <input type="radio" checked={form.machined === m} onChange={() => { set({ machined: m }); }} />
            {m ? "Machined" : "Not machined"}
          </label>
        ))}
      </div>
      {form.machined && (
        <div className="flex flex-wrap items-center gap-1">
          <input
            aria-label="Allowance per face (mm)"
            inputMode="decimal"
            value={form.allowanceMm}
            onChange={(e) => { set({ allowanceMm: e.target.value }); }}
            placeholder="mm per face"
            className="w-20 rounded border border-border bg-background px-1 py-0.5"
          />
          <select
            aria-label="Sides"
            value={form.sides}
            onChange={(e) => { set({ sides: e.target.value as "1" | "2" }); }}
            className="rounded border border-border bg-background px-1 py-0.5"
          >
            <option value="1">1 side</option>
            <option value="2">2 sides</option>
          </select>
          <select
            aria-label="Source of the value"
            value={form.basis}
            onChange={(e) => { set({ basis: e.target.value as AllowanceBasis | "" }); }}
            className="rounded border border-border bg-background px-1 py-0.5"
          >
            <option value="">source…</option>
            {(Object.keys(BASIS_LABEL) as AllowanceBasis[]).map((b) => <option key={b} value={b}>{BASIS_LABEL[b]}</option>)}
          </select>
        </div>
      )}
      <textarea
        aria-label="Reason"
        rows={2}
        maxLength={500}
        value={form.reason}
        onChange={(e) => { set({ reason: e.target.value }); }}
        placeholder={form.machined ? "Where the value comes from (drawing note, PMI, spec, why this estimate)" : "Why it is not machined"}
        className="w-full rounded border border-border bg-background px-1 py-0.5"
      />
      {touched && "error" in built && <div className="text-red-600" role="alert">{built.error}</div>}
      <button
        type="submit"
        disabled={decide.isPending}
        className="rounded border border-border px-2 py-0.5 text-foreground hover:bg-muted/50 disabled:opacity-50"
      >
        {decide.isPending ? "Saving…" : "Record"}
      </button>
    </form>
  );
}
