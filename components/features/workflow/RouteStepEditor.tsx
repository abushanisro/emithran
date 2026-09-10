'use client';

import { AlertTriangle, ChevronDown, ChevronUp, Info, Lock, Plus, X } from 'lucide-react';
import { Fragment } from 'react';

import { AddOperationPicker, type AddOperationOption } from '@/components/features/workflow/AddOperationPicker';
import { fmtMinutes, fmtMoney, fmtRate, fmtSignedMoney } from '@/lib/routing/route-format';
import { chainCostDelta, computeChainTotals, type WorkflowRouteStep } from '@/lib/routing/route-step';
import type { RouteNode } from '@/lib/routing/route-tree';
import { cn } from '@/lib/utils';

// The Workflow Builder's DETAIL pane — the selected route's real step chain,
// editable in place, held beside the comparison list rather than nested inside
// it (see RouteCompareList's header comment for why the accordion had to go).
//
// One list, not two. The previous build rendered the route's read-only
// process-line chain AND the editable step list back to back, so every shared
// operation appeared twice, in two different row shapes, showing two different
// pairs of numbers ("Press Brake $0.16 / 0.2 min" above "Press Brake — Heller
// hydraulic $19.83/hr"). Here each operation is exactly one row carrying all
// of it: machine, rate, cycle time, and line cost.
//
// Presentational only: every value is passed in, already resolved from real
// engine output by the host dialog.

export interface RouteStepEditorProps {
  route: RouteNode | null;
  /**
   * The route-defining first operation. Not editable here on purpose — it IS
   * the route selection, changed by picking a different row in the comparison
   * list, so offering a delete button on it would contradict the left pane.
   */
  cuttingStep: WorkflowRouteStep | null;
  steps: WorkflowRouteStep[];
  onMoveStep: (index: number, direction: -1 | 1) => void;
  onRemoveStep: (key: string) => void;
  onAddOperation: (option: AddOperationOption) => void;
  addOperationOptions: AddOperationOption[];
  /** process → "Typically performed before X", from the real ordering model. */
  stepOrderWarnings: Record<string, string>;
  /** Real, geometry-triggered operations this part needs that are not in the chain. */
  missingSteps: { process: string; machineClass: string }[];
  onAddMissingStep: (missing: { process: string; machineClass: string }) => void;
  /** Route-level material cost — unchanged by step edits. */
  materialCost: number | null;
  currencySymbol: string;
  /** Honest provenance for the current selection, e.g. "CAD-optimal" / "Custom". */
  provenanceLabel: string | null;
  previouslyAppliedLabel: string | null;
}

function StepRow({
  index, step, currencySymbol, warning, pinned, canMoveUp, canMoveDown, onMoveUp, onMoveDown, onRemove,
}: {
  index: number;
  step: WorkflowRouteStep;
  currencySymbol: string;
  warning?: string;
  pinned?: boolean;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onRemove?: () => void;
}) {
  return (
    <li
      className={cn(
        'relative flex items-start gap-3 rounded-md border px-3 py-2.5',
        pinned ? 'border-violet-500/40 bg-violet-500/[0.07]' : 'border-border/60 bg-muted/20',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold tabular-nums',
          pinned ? 'bg-violet-500 text-white' : 'bg-muted text-muted-foreground',
        )}
      >
        {index}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[13px] font-medium leading-tight">{step.process}</span>
          {pinned && (
            <span className="inline-flex items-center gap-1 rounded-full border border-violet-500/30 bg-violet-500/15 px-1.5 py-px text-[10px] font-medium leading-4 text-violet-200">
              <Lock className="h-2.5 w-2.5" /> Set by route
            </span>
          )}
          {!step.isReal && (
            <span className="inline-flex items-center rounded-full border border-amber-500/30 bg-amber-500/15 px-1.5 py-px text-[10px] font-medium leading-4 text-amber-300">
              Not priced for this part
            </span>
          )}
        </div>

        <p className="mt-0.5 truncate text-[11px] leading-tight text-muted-foreground" title={step.machineName ?? undefined}>
          {step.machineName
            ? <>{step.machineName} · <span className="tabular-nums">{fmtRate(step.hourlyRate, currencySymbol)}</span></>
            : <span className="italic">No machine on file</span>}
        </p>

        {warning && (
          <p className="mt-1 flex items-start gap-1 text-[11px] leading-snug text-amber-300/90">
            <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
            <span>{warning}</span>
          </p>
        )}
        {!step.isReal && (
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
            This part&apos;s geometry does not trigger this operation, so the engine has no cycle time for it. The machine rate above is real; the line cost is not estimated here.
          </p>
        )}
      </div>

      <div className="w-[70px] shrink-0 text-right">
        <div className="text-[13px] font-medium leading-tight tabular-nums">
          {step.totalCost === null ? <span className="text-muted-foreground">—</span> : fmtMoney(step.totalCost, currencySymbol)}
        </div>
        <div className="text-[11px] leading-tight tabular-nums text-muted-foreground">
          {step.isReal ? fmtMinutes(step.cycleTimeMin) : '—'}
        </div>
      </div>

      {/* Reorder + remove. WCAG 2.2 SC 2.5.8 wants a 24x24 CSS-pixel target;
          the previous ▲▼ glyphs were 10px text with no padding. SC 2.5.7 is
          also satisfied by construction — reordering never required dragging. */}
      <div className="flex shrink-0 items-center gap-0.5">
        {pinned ? (
          <span className="block h-6 w-[74px]" aria-hidden />
        ) : (
          <>
            <button
              type="button"
              onClick={onMoveUp}
              disabled={!canMoveUp}
              aria-label={`Move ${step.process} earlier`}
              className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:pointer-events-none disabled:opacity-25"
            >
              <ChevronUp className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={onMoveDown}
              disabled={!canMoveDown}
              aria-label={`Move ${step.process} later`}
              className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:pointer-events-none disabled:opacity-25"
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={onRemove}
              aria-label={`Remove ${step.process} from this route`}
              className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-red-500/15 hover:text-red-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>
    </li>
  );
}

export function RouteStepEditor({
  route, cuttingStep, steps, onMoveStep, onRemoveStep, onAddOperation, addOperationOptions,
  stepOrderWarnings, missingSteps, onAddMissingStep, materialCost, currencySymbol,
  provenanceLabel, previouslyAppliedLabel,
}: RouteStepEditorProps) {
  if (!route) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <p className="max-w-[28ch] text-center text-xs text-muted-foreground">
          Select a route on the left to see and edit its operations.
        </p>
      </div>
    );
  }

  const chain: WorkflowRouteStep[] = cuttingStep ? [cuttingStep, ...steps] : steps;
  const totals = computeChainTotals(chain, materialCost);
  const delta = chainCostDelta(totals, route.cost);
  const deltaLabel = fmtSignedMoney(delta, currencySymbol);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Route identity */}
      <div className="shrink-0 border-b border-border/60 px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h3 className="text-sm font-semibold leading-tight">{route.label}</h3>
          {provenanceLabel && (
            <span className="inline-flex items-center rounded-full border border-border bg-muted/50 px-1.5 py-px text-[10px] font-medium leading-4 text-muted-foreground">
              {provenanceLabel}
            </span>
          )}
        </div>
        {previouslyAppliedLabel && (
          <p className="mt-0.5 text-[11px] leading-tight text-muted-foreground">
            Previously applied: {previouslyAppliedLabel}
          </p>
        )}
      </div>

      {/* Process flow — the chain as a single glanceable line. Earns its place
          here (rather than duplicating the list) by being the overview of the
          numbered rows directly below it, in the same order and numbering. */}
      <div className="shrink-0 border-b border-border/60 bg-muted/20 px-4 py-2">
        <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
          <FlowChip label="Raw blank" muted />
          {chain.map((step, i) => (
            <Fragment key={step.key}>
              <FlowArrow />
              <FlowChip label={step.process} index={i + 1} machine={step.machineName} />
            </Fragment>
          ))}
          <FlowArrow />
          <FlowChip label="Finished part" muted />
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {!route.feasible && route.infeasibleReason && (
          <Callout tone="red" icon={<AlertTriangle className="h-3.5 w-3.5" />}>
            {route.infeasibleReason}
          </Callout>
        )}
        {route.selectionNote && (
          <Callout tone="amber" icon={<Info className="h-3.5 w-3.5" />}>{route.selectionNote}</Callout>
        )}
        {route.toolingVolumeNote && (
          <Callout
            tone={route.toolingVolumeNote.startsWith('Economical') ? 'emerald' : 'amber'}
            icon={<Info className="h-3.5 w-3.5" />}
          >
            {route.toolingVolumeNote}
          </Callout>
        )}

        {missingSteps.length > 0 && (
          <Callout tone="amber" icon={<AlertTriangle className="h-3.5 w-3.5" />}>
            <span className="block">
              This part&apos;s geometry also triggers {missingSteps.length === 1 ? 'an operation' : 'operations'} that this route is missing:
            </span>
            <span className="mt-1.5 flex flex-wrap gap-1.5">
              {missingSteps.map((m) => (
                <button
                  key={m.machineClass + m.process}
                  type="button"
                  onClick={() => { onAddMissingStep(m); }}
                  className="inline-flex min-h-6 items-center gap-1 rounded border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-200 transition-colors hover:bg-amber-500/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                >
                  <Plus className="h-3 w-3" /> {m.process}
                </button>
              ))}
            </span>
          </Callout>
        )}

        <div>
          <div className="mb-1.5 flex items-baseline justify-between">
            <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Operations
            </h4>
            <span className="text-[11px] text-muted-foreground">
              {chain.length} {chain.length === 1 ? 'step' : 'steps'}
            </span>
          </div>

          <ol className="space-y-1.5">
            {cuttingStep && (
              <StepRow index={1} step={cuttingStep} currencySymbol={currencySymbol} pinned />
            )}
            {steps.map((step, idx) => (
              <StepRow
                key={step.key}
                index={idx + (cuttingStep ? 2 : 1)}
                step={step}
                currencySymbol={currencySymbol}
                {...(stepOrderWarnings[step.process] ? { warning: stepOrderWarnings[step.process] } : {})}
                canMoveUp={idx > 0}
                canMoveDown={idx < steps.length - 1}
                onMoveUp={() => { onMoveStep(idx, -1); }}
                onMoveDown={() => { onMoveStep(idx, 1); }}
                onRemove={() => { onRemoveStep(step.key); }}
              />
            ))}
          </ol>

          <div className="mt-2">
            <AddOperationPicker
              options={addOperationOptions}
              onAdd={onAddOperation}
              emptyLabel="Every active catalog operation is already in this route"
            />
          </div>
        </div>
      </div>

      {/* Live totals for the chain AS EDITED — see computeChainTotals' own doc
          comment for why the route's headline cost alone was not enough. */}
      <div className="shrink-0 border-t border-border/60 bg-muted/25 px-4 py-2.5">
        <dl className="space-y-1 text-[11px]">
          <div className="flex items-baseline justify-between">
            <dt className="text-muted-foreground">Material</dt>
            <dd className="tabular-nums">{fmtMoney(totals.materialCost, currencySymbol)}</dd>
          </div>
          <div className="flex items-baseline justify-between">
            <dt className="text-muted-foreground">
              Process ({chain.length} {chain.length === 1 ? 'step' : 'steps'}, {fmtMinutes(totals.cycleTimeMin)})
            </dt>
            <dd className="tabular-nums">{fmtMoney(totals.processCost, currencySymbol)}</dd>
          </div>
          <div className="flex items-baseline justify-between border-t border-border/60 pt-1.5">
            <dt className="text-[12px] font-semibold">
              {totals.isPartial ? 'Total so far' : 'Total'}
            </dt>
            <dd className="flex items-baseline gap-2">
              {delta !== null && delta !== 0 && deltaLabel && (
                <span className={cn('text-[11px] tabular-nums', delta > 0 ? 'text-amber-300' : 'text-emerald-300')}>
                  {deltaLabel} vs. route
                </span>
              )}
              <span className="text-[14px] font-semibold tabular-nums">{fmtMoney(totals.total, currencySymbol)}</span>
            </dd>
          </div>
        </dl>
        {totals.isPartial && (
          <p className="mt-1.5 text-[11px] leading-snug text-amber-300/90">
            Excludes {totals.unpricedStepCount} step{totals.unpricedStepCount === 1 ? '' : 's'} the engine has not priced for this part — the real cost will be higher.
          </p>
        )}
      </div>
    </div>
  );
}

function FlowChip({ label, machine, index, muted }: { label: string; machine?: string | null; index?: number; muted?: boolean }) {
  return (
    <div
      className={cn(
        'shrink-0 rounded border px-2 py-1',
        muted ? 'border-border/60 bg-muted/40 text-muted-foreground' : 'border-violet-500/40 bg-violet-500/10',
      )}
    >
      <div className="flex items-center gap-1 text-[10px] font-medium leading-tight">
        {index !== undefined && <span className="tabular-nums text-violet-300">{index}</span>}
        <span className="whitespace-nowrap">{label}</span>
      </div>
      {machine && (
        <div className="max-w-[120px] truncate text-[9px] leading-tight text-muted-foreground" title={machine}>
          {machine}
        </div>
      )}
    </div>
  );
}

function FlowArrow() {
  return <span aria-hidden className="shrink-0 px-0.5 text-[10px] text-muted-foreground/50">→</span>;
}

function Callout({ tone, icon, children }: { tone: 'red' | 'amber' | 'emerald'; icon: React.ReactNode; children: React.ReactNode }) {
  const tones = {
    red: 'border-red-500/40 bg-red-500/10 text-red-200',
    amber: 'border-amber-500/40 bg-amber-500/10 text-amber-200',
    emerald: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200',
  } as const;
  return (
    <div className={cn('flex items-start gap-2 rounded-md border px-3 py-2 text-[11px] leading-snug', tones[tone])}>
      <span className="mt-px shrink-0">{icon}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
