'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { MaterialUsageExplanation, UsageJustification } from '@/lib/api/hooks/useMaterialUsage';
import { formatKg, USAGE_SOURCE_LABEL } from '@/lib/costing/material-usage-view';

const shown = (value: number | string | null | undefined) => (value == null || value === '' ? '' : String(value));

/** One calculator as a form: its inputs as fields holding the values the cost engine read, then its results with their formulas. */
function CalculatorForm({ justification, use }: {
  justification: UsageJustification;
  /** Shown beside the last result (the usage figure itself) when given. */
  use?: { label: string; onClick: () => void };
}) {
  const inputs = justification.trace.filter((s) => s.kind === 'input');
  const results = justification.trace.filter((s) => s.kind === 'calculated');
  return (
    <>
      <div className="space-y-2">
        <Label>Calculator</Label>
        <div className="flex items-center gap-2 rounded-md border border-input bg-muted/30 px-3 py-2 text-sm">
          <span className="min-w-0 truncate" title={justification.title}>{justification.title}</span>
          {justification.calculatorId
            ? <span className="ml-auto shrink-0 text-xs text-muted-foreground">v{justification.calculatorVersion ?? 1}</span>
            : <span className="ml-auto shrink-0 text-xs text-muted-foreground">{justification.estimate ? 'Estimate' : 'Engine rule'}</span>}
        </div>
      </div>

      {inputs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Input Values</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {inputs.map((step, i) => (
              <div key={`${step.fieldName}-${i}`} className="space-y-2">
                <Label htmlFor={`usage-input-${i}`}>
                  {step.displayLabel}
                  {step.unit && <span className="text-muted-foreground ml-1">({step.unit})</span>}
                </Label>
                {/* The value the engine read for this part: changing it here would not change the costing, so the field is read-only. */}
                <Input id={`usage-input-${i}`} value={shown(step.value)} readOnly className="bg-muted/30" />
                {step.source && <p className="text-xs text-muted-foreground">{step.source}</p>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {results.length > 0 && (
        <Card className="border-primary">
          <CardHeader>
            <CardTitle className="text-lg">Results</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {results.map((step, i) => (
              <div key={`${step.fieldName}-${i}`} className="p-3 bg-secondary/50 rounded-lg space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{step.displayLabel}</div>
                    {step.unit && <div className="text-xs text-muted-foreground">{step.unit}</div>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="text-lg font-bold text-primary tabular-nums">{shown(step.value) || 'N/A'}</div>
                    {use && i === results.length - 1 && (
                      <Button type="button" size="sm" variant="outline" onClick={use.onClick}>{use.label}</Button>
                    )}
                  </div>
                </div>
                {step.formula && <p className="text-[10px] font-mono text-muted-foreground/80 break-all">= {step.formula}</p>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </>
  );
}

/**
 * The calculator panel of the material dialog for a part whose usage the cost engine calculates (every process family): the calculator behind
 * the Net or Gross Usage as a form, like the reference calculators of the other dialogs, filled with the values the engine used. "Use" puts the
 * calculated Net, Gross and Scrap in the dialog's fields.
 */
export function UsageCalculatorForm({ usage, target, onUse }: {
  usage: MaterialUsageExplanation;
  target: 'netUsage' | 'grossUsage';
  onUse: (usage: MaterialUsageExplanation) => void;
}) {
  const net = target === 'netUsage';
  return (
    <div className="mt-6 space-y-6" data-testid="usage-calculator-form">
      <p className="text-xs text-muted-foreground">
        {USAGE_SOURCE_LABEL[usage.source]}: the values the cost engine used for this part.
      </p>
      <CalculatorForm justification={net ? usage.net : usage.gross} use={{ label: 'Use', onClick: () => onUse(usage) }} />
      {!net && usage.scrap.trace.length > 0 && (
        <div className="rounded-lg border border-border/60 px-3 py-2 text-sm flex items-baseline justify-between gap-2">
          <span className="text-muted-foreground">Scrap: {usage.scrap.title.toLowerCase()}</span>
          <span className="font-semibold tabular-nums">{usage.scrapPct} %</span>
        </div>
      )}
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm">
          {net ? 'Net usage' : 'Gross usage'}: <span className="font-semibold tabular-nums">{formatKg(net ? usage.netUsage : usage.grossUsage)} kg</span>
        </span>
        <Button type="button" onClick={() => onUse(usage)}>Use calculated values</Button>
      </div>
    </div>
  );
}
