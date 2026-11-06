"use client";

import type { QuoteValidation } from "@/lib/api/hooks/useBOMItems";
import { cn } from "@/lib/utils";

const STATE_LABEL = { VALIDATED: "Validated", ASSUMED: "Assumed", UNSUPPORTED: "Unsupported" } as const;
const STATE_CLASS = {
  VALIDATED: "border-emerald-500/40 text-emerald-600 dark:text-emerald-400",
  ASSUMED: "border-amber-500/40 text-amber-600 dark:text-amber-400",
  UNSUPPORTED: "border-destructive/40 text-destructive",
} as const;

/**
 * How far a plastic quote can be trusted: the weakest validation state among the formulas it used, whether it is complete, and (opened) the
 * assumptions it rests on and what a real quote needs that the model cannot compute yet. Renders nothing for a quote without a validation (other
 * families, or a part that cannot be molded). The numbers above it are unchanged: this only says how much weight they bear.
 */
export function QuoteValidationNote({ validation }: { validation: QuoteValidation | undefined }) {
  if (!validation) return null;
  const { state, complete, formulas, assumptions, unsupported } = validation;
  const assumed = formulas.filter((f) => f.state === "ASSUMED").length;
  return (
    <details className="mt-1 max-w-[260px] text-[10px] text-muted-foreground">
      <summary className="flex cursor-pointer select-none items-center gap-1.5 hover:text-foreground">
        <span className={cn("rounded border px-1 py-0.5 font-semibold uppercase tracking-wide", STATE_CLASS[state])}>{STATE_LABEL[state]}</span>
        <span>{complete ? "complete" : `partial: ${unsupported.length} items not computed`}</span>
      </summary>
      <div className="mt-1 space-y-1.5 rounded border border-border/60 p-2">
        <p>
          {formulas.length} formulas used, {assumed} {assumed === 1 ? "rests" : "rest"} on an assumption.
        </p>
        {assumptions.length > 0 && (
          <div>
            <p className="font-semibold text-foreground">Assumptions</p>
            <ul className="list-disc space-y-0.5 pl-3.5">
              {assumptions.map((a) => <li key={a}>{a}</li>)}
            </ul>
          </div>
        )}
        {unsupported.length > 0 && (
          <div>
            <p className="font-semibold text-foreground">Not computed (no formula in the reference data)</p>
            <ul className="list-disc space-y-0.5 pl-3.5">
              {unsupported.map((u) => <li key={u.id}>{u.name}{u.stagedData ? ` (staged: ${u.stagedData})` : ""}</li>)}
            </ul>
          </div>
        )}
      </div>
    </details>
  );
}
