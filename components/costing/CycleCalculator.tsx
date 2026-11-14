'use client';

import { Pencil } from 'lucide-react';
import { useState } from 'react';

import type { CalculationTraceStep } from '@/lib/api/hooks/useBOMItems';
import { useClearCalculatorFieldOverride, useSetCalculatorFieldOverride } from '@/lib/api/hooks/useCalculatorFieldOverrides';
import { cycleFields, formatFieldValue } from '@/lib/costing/cycle-fields';

const box = 'w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm tabular-nums focus:outline-hidden focus:ring-1 focus:ring-brand-500';
const label = (s: CalculationTraceStep) => `${s.fieldName}${s.unit ? ` (${s.unit})` : ''}`;

/** One field: its value and why it has it; the pencil opens an editor to set the part's own value (with the reason). */
function Field({ step, bomItemId, calculator }: { step: CalculationTraceStep; bomItemId: string; calculator: string | null }) {
  const shown = formatFieldValue(step.value);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(shown);
  const [reason, setReason] = useState('');
  const set = useSetCalculatorFieldOverride(bomItemId);
  const clear = useClearCalculatorFieldOverride(bomItemId);
  const num = Number(value);
  const valid = Number.isFinite(num) && num > 0 && value.trim() !== shown && reason.trim().length >= 3;
  const busy = set.isPending || clear.isPending;
  const failure = (set.error ?? clear.error) as { message?: string } | null;
  const why = step.override
    ? `Engineer's value for this part: ${step.override.reason}`
    : step.kind === 'calculated' ? `${step.fieldName} = ${step.formula ?? ''}` : step.source ?? '';
  const close = () => { setEditing(false); setValue(shown); setReason(''); };

  return (
    <div className="space-y-1 border-b border-border/30 pb-2 last:border-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{label(step)}</span>
        <span className="flex shrink-0 items-center gap-1.5">
          <span className={`text-sm font-semibold tabular-nums ${step.override ? 'text-amber-600 dark:text-amber-500' : ''}`}>{shown}</span>
          {calculator && !editing && (
            <button type="button" className="text-muted-foreground hover:text-foreground" aria-label={`Edit ${step.fieldName} for this part`} title="Set this part's own value" onClick={() => { setEditing(true); }}>
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
        </span>
      </div>
      <p className={`text-xs leading-snug text-muted-foreground ${step.kind === 'calculated' && !step.override ? 'font-mono' : ''}`}>Why: {why}</p>
      {step.override && (
        <p className="text-xs text-amber-600 dark:text-amber-500">
          The calculator gives {formatFieldValue(step.override.original)}{step.unit ? ` ${step.unit}` : ''}.{' '}
          {calculator && (
            <button type="button" className="underline disabled:opacity-50" disabled={busy} onClick={() => { clear.mutate({ calculator, field: step.fieldName }); }}>
              Back to the calculator&apos;s value
            </button>
          )}
        </p>
      )}
      {calculator && editing && (
        <form
          className="space-y-1.5 rounded-md bg-muted/40 p-2"
          onSubmit={(e) => {
            e.preventDefault();
            set.mutate({ calculator, field: step.fieldName, value: num, reason: reason.trim() }, { onSuccess: close });
          }}
        >
          <input className={box} inputMode="decimal" aria-label={`${label(step)} for this part`} value={value} autoFocus onChange={(e) => { setValue(e.target.value); }} />
          <input className={box} aria-label={`Why ${step.fieldName} differs for this part`} placeholder="Why this part differs (required)" value={reason} onChange={(e) => { setReason(e.target.value); }} />
          <div className="flex gap-2 text-xs">
            <button type="submit" className="rounded-md bg-brand-600 px-3 py-1 font-medium text-white disabled:opacity-50" disabled={busy || !valid}>
              {set.isPending ? 'Saving…' : 'Save and recalculate'}
            </button>
            <button type="button" className="text-muted-foreground hover:underline" onClick={close}>Cancel</button>
          </div>
          {value.trim() !== '' && (!Number.isFinite(num) || num <= 0) && <p className="text-xs text-red-600">Enter a positive number.</p>}
        </form>
      )}
      {failure?.message && <p className="text-xs text-red-600">{failure.message}</p>}
    </div>
  );
}

/**
 * The cycle of a calculator-driven operation in the Cost panel: each phase its Cycle Time formula adds up and, on request, every other field of the
 * calculation, then the Cycle Time itself with its formula, last, as their total. Where the engine applies a part's own values (`calculator` set), each field can be changed for this part with
 * the reason; the cost is recalculated with it. Read-only otherwise.
 */
export function CycleCalculator({ trace, bomItemId, calculator, result, first }: {
  trace: readonly CalculationTraceStep[]; bomItemId: string; calculator: string | null;
  /** The result field, last (default: the Cycle Time or Total Time); `first`: the fields shown first (default: the ones its formula names). */
  result?: string; first?: readonly string[];
}) {
  const [more, setMore] = useState(false);
  const fields = cycleFields(trace, { ...(result ? { result } : {}), ...(first ? { first } : {}) });
  if (!fields) return null;
  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      {fields.phases.map((s) => <Field key={`${s.fieldName}:${String(s.value)}`} step={s} bomItemId={bomItemId} calculator={calculator} />)}
      {fields.others.length > 0 && (
        <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => { setMore((v) => !v); }} aria-expanded={more}>
          {more ? 'Hide the other inputs' : `Show the ${fields.others.length} other inputs and values`}
        </button>
      )}
      {more && fields.others.map((s) => <Field key={`${s.fieldName}:${String(s.value)}`} step={s} bomItemId={bomItemId} calculator={calculator} />)}
      <div className="flex items-start justify-between gap-3 rounded-md bg-muted/40 p-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold">{label(fields.cycle)}</div>
          <p className="mt-0.5 font-mono text-xs text-muted-foreground break-words">Why: {fields.cycle.fieldName} = {fields.cycle.formula}</p>
        </div>
        <div className="shrink-0 text-lg font-bold tabular-nums text-primary">{formatFieldValue(fields.cycle.value)}</div>
      </div>
      {calculator && <p className="text-[11px] text-muted-foreground">A changed value is this part&apos;s own, kept with its reason; press Apply to put the recalculated cost in the quote.</p>}
    </div>
  );
}
