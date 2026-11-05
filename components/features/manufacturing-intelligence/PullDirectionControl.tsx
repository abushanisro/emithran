"use client";

import { useState } from "react";

import { useClearPlasticPullDirection, usePlasticPullDirection, useSetPlasticPullDirection } from "@/lib/api/hooks/usePlasticPullDirection";
import type { PullAxis } from "@/lib/api/plastic-pull-direction";
import { PULL_AXES, REASON_MAX, describePullDirection, heldBack, pullDirectionError } from "@/lib/plastic/pull-direction";

/**
 * The part's pull (mold-opening) direction: what it is now, and the engineer's way to fix it to an axis (with the reason, which is kept in the audit
 * trail) or to return to the automatic choice. Changing it analyses the part again along the new axis, so the features and the cost follow.
 */
export function PullDirectionControl({ itemId }: { itemId: string }) {
  const direction = usePlasticPullDirection(itemId);
  const set = useSetPlasticPullDirection(itemId);
  const clear = useClearPlasticPullDirection(itemId);
  const [axis, setAxis] = useState("");
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const d = direction.data;
  const current = d?.axis ?? null;
  const held = heldBack(d);
  const declared = d?.declaredAxis ?? null;
  const error = pullDirectionError({ axis, reason }, current);
  const busy = set.isPending || clear.isPending;
  const failure = (set.error ?? clear.error ?? direction.error) as { message?: string } | null;

  return (
    <div className="space-y-1 border-b border-border/40 px-3 py-2 text-[11px]">
      <div className="font-medium text-foreground">Pull direction</div>
      <div className="text-muted-foreground">{direction.isLoading ? "Reading…" : describePullDirection(d)}</div>
      {declared && d?.reason && <div className="text-muted-foreground">Reason: {d.reason}</div>}
      {held && (
        <div className="space-y-1 rounded border border-amber-500/40 bg-amber-500/10 p-1 text-amber-700 dark:text-amber-500" role="status">
          <div>{held.notice}</div>
          {d?.reason && (
            <button
              type="button"
              disabled={busy}
              onClick={() => { set.mutate({ axis: held.axis, reason: d.reason ?? "" }); }}
              className="rounded border border-border bg-background px-2 py-0.5 text-foreground hover:bg-muted/50 disabled:opacity-50"
            >
              {set.isPending ? "Confirming…" : `Confirm ${held.axis.toUpperCase()} for this file`}
            </button>
          )}
        </div>
      )}
      <form
        className="space-y-1"
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (error) return;
          set.mutate(
            { axis: axis as PullAxis, reason: reason.trim() },
            { onSuccess: () => { setAxis(""); setReason(""); setTouched(false); } },
          );
        }}
      >
        <div className="flex items-center gap-1">
          <label htmlFor={`pull-axis-${itemId}`} className="text-muted-foreground">Fix to</label>
          <select
            id={`pull-axis-${itemId}`}
            value={axis}
            onChange={(e) => { setAxis(e.target.value); }}
            className="rounded border border-border bg-background px-1 py-0.5"
          >
            <option value="">axis…</option>
            {PULL_AXES.filter((a) => a !== current).map((a) => (
              <option key={a} value={a}>{a.toUpperCase()}</option>
            ))}
          </select>
        </div>
        <textarea
          value={reason}
          maxLength={REASON_MAX}
          rows={2}
          placeholder="Why override the automatic choice? (kept in the audit trail)"
          aria-label="Reason for the pull direction"
          onChange={(e) => { setReason(e.target.value); }}
          className="w-full rounded border border-border bg-background px-1 py-0.5"
        />
        {touched && error && <div className="text-red-600" role="alert">{error}</div>}
        {failure && <div className="text-red-600" role="alert">{failure.message ?? "The pull direction could not be changed."}</div>}
        <div className="flex gap-1">
          <button type="submit" disabled={busy} className="rounded border border-border px-2 py-0.5 text-foreground hover:bg-muted/50 disabled:opacity-50">
            {set.isPending ? "Analysing…" : "Apply"}
          </button>
          {declared && (
            <button type="button" disabled={busy} onClick={() => { clear.mutate(); }} className="rounded border border-border px-2 py-0.5 text-foreground hover:bg-muted/50 disabled:opacity-50">
              {clear.isPending ? "Analysing…" : "Return to automatic"}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
