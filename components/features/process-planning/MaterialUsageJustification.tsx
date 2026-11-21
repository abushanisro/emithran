'use client';

import { Button } from '@/components/ui/button';
import { Loader2 } from '@/components/ui/icons';
import type { MaterialUsageExplanation, UsageJustification } from '@/lib/api/hooks/useMaterialUsage';
import { formatKg, USAGE_SOURCE_LABEL, usageDrift } from '@/lib/costing/material-usage-view';

function Working({ label, justification }: { label: string; justification: UsageJustification }) {
  const inputs = justification.trace.filter((s) => s.kind === 'input');
  const results = justification.trace.filter((s) => s.kind === 'calculated');
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline gap-2">
        <span className="text-[11px] font-semibold text-foreground">{label}</span>
        <span className="text-[11px] text-muted-foreground min-w-0 truncate" title={justification.title}>{justification.title}</span>
        {justification.calculatorId && <span className="text-[10px] text-muted-foreground/70 shrink-0">Calculator v{justification.calculatorVersion ?? 1}</span>}
        {justification.estimate && <span className="text-[9px] font-semibold px-1.5 py-px rounded shrink-0 bg-warning/15 text-warning">Estimate</span>}
      </div>
      {inputs.map((step, i) => (
        <div key={`i${i}`} className="text-[11px] pl-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-muted-foreground min-w-0 truncate">{step.displayLabel}</span>
            <span className="tabular-nums text-foreground shrink-0">{step.value ?? '—'}{step.unit ? ` ${step.unit}` : ''}</span>
          </div>
          {step.source && <div className="text-[10px] text-muted-foreground/70">{step.source}</div>}
        </div>
      ))}
      {results.map((step, i) => (
        <div key={`r${i}`} className="text-[11px] pl-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-foreground min-w-0 truncate">{step.displayLabel}</span>
            <span className="tabular-nums font-semibold text-foreground shrink-0">{step.value ?? '—'}{step.unit ? ` ${step.unit}` : ''}</span>
          </div>
          {step.formula && <div className="text-[10px] font-mono text-muted-foreground/80">= {step.formula}</div>}
        </div>
      ))}
    </div>
  );
}

/**
 * Under the Net and Gross Usage fields of the material dialog: what the cost engine calculates for this part, the working behind each figure, and one
 * button that puts those figures in the fields. Shows the difference when the record holds other values than the engine now calculates.
 */
export function MaterialUsageJustification({ usage, loading, fields, onUse }: {
  usage: MaterialUsageExplanation | undefined;
  loading: boolean;
  /** The dialog's current Net and Gross Usage, to say when they differ from the calculated ones. */
  fields: { net: number | ''; gross: number | '' };
  /** Fill Net Usage, Gross Usage and Scrap % from the calculation. */
  onUse: (usage: MaterialUsageExplanation) => void;
}) {
  if (loading) {
    return (
      <div className="rounded-lg border border-border/60 px-3 py-2.5 text-[11px] text-muted-foreground flex items-center gap-2">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Calculating the usage from the part costing…
      </div>
    );
  }
  if (!usage) return null;
  const drift = usageDrift(usage, fields);
  const derived = usage.source !== 'none';
  return (
    <div className="rounded-lg border border-border/60 px-3 py-2.5 space-y-3" data-testid="material-usage-justification">
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">How the usage is calculated</span>
        <span className="text-[10px] text-muted-foreground/80">{USAGE_SOURCE_LABEL[usage.source]}</span>
        {derived && (
          <Button type="button" size="sm" variant="outline" className="ml-auto h-7 text-xs" onClick={() => onUse(usage)}>
            Use calculated values
          </Button>
        )}
      </div>
      {drift.length > 0 && (
        <div className="rounded border border-warning/40 bg-warning/10 px-2.5 py-1.5 text-[11px] text-warning">
          {drift.map((d) => `${d.field} here is ${formatKg(d.recorded)} kg; the costing now calculates ${formatKg(d.calculated)} kg.`).join(' ')}
        </div>
      )}
      {derived ? (
        <>
          <Working label="Net usage" justification={usage.net} />
          <Working label="Gross usage" justification={usage.gross} />
          <Working label="Scrap" justification={usage.scrap} />
        </>
      ) : (
        <p className="text-[11px] text-muted-foreground">{usage.net.title}. Enter the usage by hand.</p>
      )}
    </div>
  );
}
