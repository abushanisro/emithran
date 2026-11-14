'use client';

import { useState, type ReactNode } from 'react';

import { CalculationTracePanel } from '@/components/features/process-planning/CalculationTracePanel';
import type { CalculationTraceStep } from '@/lib/api/hooks/useBOMItems';
import { useClearSandVariableOverride, useSandVariableOverrides, useSetSandVariableOverride } from '@/lib/api/hooks/useSandVariableOverrides';
import type { SandVariableOverride } from '@/lib/api/sand-variable-overrides';
import { calculatorRunEntries, variableOfSource, type CalculatorRun } from '@/lib/costing/sand-calculations';

const fieldClass = 'text-xs border border-border rounded px-2 py-1 bg-background focus:outline-hidden focus:ring-1 focus:ring-brand-500';

/** Set this part's own value for a plant variable (with the reason), or return it to the plant value. */
function VariableEditor({ bomItemId, variable, current }: { bomItemId: string; variable: string; current: SandVariableOverride | undefined }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const set = useSetSandVariableOverride(bomItemId);
  const clear = useClearSandVariableOverride(bomItemId);
  const failure = (set.error ?? clear.error) as { message?: string } | null;
  const busy = set.isPending || clear.isPending;
  return (
    <div className="pt-0.5">
      {current && (
        <div className="text-[10px] text-amber-600 dark:text-amber-500 leading-tight">
          Your value {current.value}{current.unit ? ` (${current.unit})` : ''}; the plant value is {current.plantValue ?? 'none'}. Why: {current.reason}
        </div>
      )}
      {!open ? (
        <div className="flex gap-2 text-[10px]">
          <button type="button" className="text-brand-600 hover:underline" onClick={() => { setValue(current?.value ?? ''); setReason(''); setOpen(true); }}>
            {current ? 'Change this part’s value' : 'Set this part’s value'}
          </button>
          {current && (
            <button type="button" className="text-muted-foreground hover:underline disabled:opacity-50" disabled={busy} onClick={() => { clear.mutate(variable); }}>
              Back to the plant value
            </button>
          )}
        </div>
      ) : (
        <form
          className="space-y-1 pt-1"
          onSubmit={(e) => {
            e.preventDefault();
            set.mutate({ variable, value, reason }, { onSuccess: () => { setOpen(false); } });
          }}
        >
          <input className={`${fieldClass} w-full`} aria-label={`Value for ${variable}`} placeholder="Value" value={value} onChange={(e) => { setValue(e.target.value); }} />
          <input className={`${fieldClass} w-full`} aria-label={`Why ${variable} differs`} placeholder="Why this part differs (required)" value={reason} onChange={(e) => { setReason(e.target.value); }} />
          <div className="flex gap-2">
            <button type="submit" className={`${fieldClass} hover:bg-muted/50 disabled:opacity-50`} disabled={busy || value.trim() === '' || reason.trim().length < 3}>
              {set.isPending ? 'Saving…' : 'Save and recalculate'}
            </button>
            <button type="button" className="text-[10px] text-muted-foreground hover:underline" onClick={() => { setOpen(false); }}>Cancel</button>
          </div>
          {failure?.message && <p className="text-[10px] text-red-600 leading-tight">{failure.message}</p>}
        </form>
      )}
    </div>
  );
}

/**
 * The trace input renderer that lets a plant variable be set for this part: under each input read from a sand-casting plant variable, its
 * editor. Used for the route lines' traces and the calculator runs' traces alike.
 */
export function useSandVariableInput(bomItemId: string): { renderInput: (step: CalculationTraceStep) => ReactNode; ownValues: string[] } {
  const overrides = useSandVariableOverrides(bomItemId);
  const byVariable = new Map((overrides.data?.overrides ?? []).map((o) => [o.variable, o]));
  return {
    renderInput: (step) => {
      const variable = variableOfSource(step.source);
      return variable ? <VariableEditor bomItemId={bomItemId} variable={variable} current={byVariable.get(variable)} /> : null;
    },
    ownValues: [...byVariable.keys()],
  };
}

/** The calculator runs behind the sand-casting cost (metal, risers, gating, core sand, core boxes): the formula, each input and where it came from. */
export function SandCalculatorRuns({ bomItemId, runs }: { bomItemId: string; runs: Record<string, CalculatorRun> | undefined }) {
  const { renderInput, ownValues } = useSandVariableInput(bomItemId);
  const entries = calculatorRunEntries(runs);
  if (entries.length === 0) return null;
  return (
    <div className="space-y-1">
      <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Calculators</div>
      {ownValues.length > 0 && (
        <p className="text-[10px] text-amber-600 dark:text-amber-500 leading-tight">
          Calculated with this part’s own value for {ownValues.join(', ')}.
        </p>
      )}
      {entries.map((e) => (
        <details key={e.key} className="rounded border border-border/50 px-2 py-1">
          <summary className="cursor-pointer text-xs flex items-baseline justify-between gap-2">
            <span className="font-medium truncate min-w-0">{e.title}</span>
            {e.result && <span className="text-[10px] text-muted-foreground shrink-0">{e.result}</span>}
          </summary>
          <div className="pt-1.5 space-y-1.5">
            {e.noTraceReason ? (
              <p className="text-[10px] text-muted-foreground leading-tight">{e.noTraceReason}</p>
            ) : (
              <CalculationTracePanel
                line={{
                  calculationTrace: e.trace,
                  ...(e.calculatorId ? { calculatorId: e.calculatorId } : {}),
                  ...(e.calculatorVersion != null ? { calculatorVersion: e.calculatorVersion } : {}),
                }}
                renderInput={renderInput}
              />
            )}
            {e.missing.length > 0 && (
              <p className="text-[10px] text-amber-600 dark:text-amber-500 leading-tight">Could not resolve: {e.missing.join(', ')}</p>
            )}
          </div>
        </details>
      ))}
    </div>
  );
}

/** A sand route line's trace, with the editor under each input read from a plant variable. */
export function SandLineTrace({ bomItemId, line }: { bomItemId: string; line: Parameters<typeof CalculationTracePanel>[0]['line'] }) {
  const { renderInput } = useSandVariableInput(bomItemId);
  return <CalculationTracePanel line={line} renderInput={renderInput} />;
}
