"use client";

import { useState } from "react";

import type { CastingDrawDirection, DrawAxis } from "@/lib/api/casting-analyses";
import {
  useClearDrawDirection,
  useSetDrawDirection,
} from "@/lib/api/hooks/useCastingAnalyses";
import {
  DRAW_AXES,
  REASON_MAX,
  describeDrawDirection,
  drawDirectionError,
} from "@/lib/casting/draw-direction";

/**
 * The part's draw direction: what it is now, and the engineer's way to fix it to an axis (with the reason, which is kept in the audit trail)
 * or to return to the automatic choice. Changing it asks for the analysis along the new axis; the other analyses of the part are kept.
 */
export function DrawDirectionControl({
  itemId,
  direction,
  autoAxis,
}: {
  itemId: string;
  direction: CastingDrawDirection | undefined;
  /** The axis the worker chose, when the analysis shown is an automatic one. */
  autoAxis: DrawAxis | null;
}) {
  const set = useSetDrawDirection(itemId);
  const clear = useClearDrawDirection(itemId);
  const [axis, setAxis] = useState<string>("");
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const current = direction?.axis ?? null;
  const error = drawDirectionError({ axis, reason }, current);
  const busy = set.isPending || clear.isPending;
  const failure = (set.error ?? clear.error) as { message?: string } | null;

  return (
    <div className="space-y-1 rounded border border-border/60 bg-muted/20 p-1.5">
      <div className="font-medium text-foreground">Draw direction</div>
      <div className="text-muted-foreground">
        {describeDrawDirection(direction, autoAxis)}
      </div>
      {current && direction?.reason && (
        <div className="text-muted-foreground">Reason: {direction.reason}</div>
      )}
      <form
        className="space-y-1"
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (error) return;
          set.mutate(
            { axis: axis as DrawAxis, reason: reason.trim() },
            {
              onSuccess: () => {
                setAxis("");
                setReason("");
                setTouched(false);
              },
            },
          );
        }}
      >
        <div className="flex items-center gap-1">
          <label htmlFor={`draw-axis-${itemId}`} className="text-muted-foreground">
            Fix to
          </label>
          <select
            id={`draw-axis-${itemId}`}
            value={axis}
            onChange={(e) => {
              setAxis(e.target.value);
            }}
            className="rounded border border-border bg-background px-1 py-0.5"
          >
            <option value="">axis…</option>
            {DRAW_AXES.filter((a) => a !== current).map((a) => (
              <option key={a} value={a}>
                {a.toUpperCase()}
              </option>
            ))}
          </select>
        </div>
        <textarea
          value={reason}
          maxLength={REASON_MAX}
          rows={2}
          placeholder="Why override the automatic choice? (kept in the audit trail)"
          aria-label="Reason for the draw direction"
          onChange={(e) => {
            setReason(e.target.value);
          }}
          className="w-full rounded border border-border bg-background px-1 py-0.5"
        />
        {touched && error && (
          <div className="text-red-600" role="alert">
            {error}
          </div>
        )}
        {failure && (
          <div className="text-red-600" role="alert">
            {failure.message ?? "The draw direction could not be changed."}
          </div>
        )}
        <div className="flex gap-1">
          <button
            type="submit"
            disabled={busy}
            className="rounded border border-border px-2 py-0.5 text-foreground hover:bg-muted/50 disabled:opacity-50"
          >
            {set.isPending ? "Applying…" : "Apply"}
          </button>
          {current && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                clear.mutate();
              }}
              className="rounded border border-border px-2 py-0.5 text-foreground hover:bg-muted/50 disabled:opacity-50"
            >
              {clear.isPending ? "Returning…" : "Return to automatic"}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
