'use client';

import { useState, type ReactNode } from 'react';
import type { ConfidenceLevel, PhysicsGap, LookupTableRow, CalculationTraceStep } from '@/lib/api/hooks/useBOMItems';

import { buildCalculationTree, type CalculationNode } from '@/lib/costing/calculation-tree';

// Narrower than ProcessLineCost -- lets non-process callers (e.g. a material
// usage trace with no machine/labour rate) feed the same trace renderer
// without fabricating unrelated process fields just to satisfy the type.
export type CalculationTraceLine = {
  calculationTrace?: CalculationTraceStep[];
  calculatorId?: string;
  calculatorVersion?: number;
  physicsGap?: PhysicsGap;
  confidence?: ConfidenceLevel;
};

// Distinct from the numeric 0-1 `ConfidenceBadge` already used elsewhere on
// this page for DFM risk scoring — this one maps the Manufacturing Physics
// Calculator's own 3-state ConfidenceLevel (verified/derived/unsupported),
// a different concept with a different value shape. Same visual convention
// as RiskBadge/ComplexityBadge (bg-x-500/15 text-x-700 span), just a new enum.
function CalculatorConfidenceBadge({ level }: { level: ConfidenceLevel }) {
  const cls =
    level === 'verified' ? 'bg-green-500/15 text-green-700 dark:text-green-400' :
    level === 'derived' ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400' :
    'bg-red-500/15 text-red-700 dark:text-red-400';
  const label = level === 'verified' ? 'Verified' : level === 'derived' ? 'Derived' : 'Unsupported';
  const title =
    level === 'verified' ? 'Every input was real CAD/BOM data or an exact lookup hit — nothing assumed.' :
    level === 'derived' ? 'Real, sourced result, but at least one input came from a disclosed engineering-standard assumption rather than an exact measurement.' :
    'No calculator result — see the gap below.';
  return (
    <span className={`text-[9px] font-semibold px-1.5 py-px rounded shrink-0 ${cls}`} title={title}>
      {label}
    </span>
  );
}

function LookupTableRowChip({ row }: { row: LookupTableRow }) {
  const cols = Object.entries(row.columns).map(([k, v]) => `${k}=${v}`).join(', ');
  const hasMatchInfo = row.matchedDimensions != null && row.totalDimensions != null;
  return (
    <div className="text-[10px] font-mono text-muted-foreground/80 flex items-baseline gap-1.5">
      <span>{cols}</span>
      {hasMatchInfo && (
        <span className="text-[9px] font-sans font-semibold px-1 py-px rounded bg-amber-500/15 text-amber-700 dark:text-amber-400 shrink-0">
          matches {row.matchedDimensions}/{row.totalDimensions}
        </span>
      )}
    </div>
  );
}

// Renders the resolver's structured LookupResolution/inputValidation/
// requiredAction fields directly — no string parsing. Per the architecture:
// Input Validation, Lookup Resolution, and Required Action are three
// distinct sections because they answer three distinct questions (were the
// OTHER inputs fine? what exactly did the lookup query and find? what's the
// one actionable next step?), not one blob of text.
function PhysicsGapPanel({ gap }: { gap: PhysicsGap }) {
  return (
    <div className="rounded border border-red-500/30 bg-red-500/5 p-2.5 space-y-2">
      <div className="text-[11px] font-semibold text-red-700 dark:text-red-400">
        Result Unavailable — {gap.gapType === 'missing_lookup' ? 'Missing Lookup Data' : 'Unsupported Operation'}
      </div>
      {gap.gapType === 'missing_lookup' ? (
        <>
          {gap.inputValidation.length > 0 && (
            <div className="space-y-1">
              <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                Input Validation
              </div>
              {gap.inputValidation.map((v, i) => (
                <div key={i} className="text-[11px] flex items-baseline justify-between gap-2">
                  <span className="text-muted-foreground truncate min-w-0" title={v.source}>{v.fieldName}</span>
                  <span className="tabular-nums text-foreground shrink-0">{v.value}</span>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-1">
            <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
              Lookup Resolution
            </div>
            <div className="text-[11px] text-muted-foreground">
              Table: <span className="font-mono">{gap.lookupResolution.table}</span>
              <span className="ml-1.5 text-[9px] font-semibold px-1 py-px rounded bg-blue-500/15 text-blue-700 dark:text-blue-400">
                {gap.lookupResolution.policy}
              </span>
            </div>
            {gap.lookupResolution.queryParams.length > 0 && (
              <div className="text-[11px] text-muted-foreground">
                Query: <span className="font-mono">
                  {gap.lookupResolution.queryParams.map((p) => `${p.column}=${p.value}${p.unit ?? ''}`).join(', ')}
                </span>
              </div>
            )}
            {gap.lookupResolution.matchedRow ? (
              <LookupTableRowChip row={gap.lookupResolution.matchedRow} />
            ) : gap.lookupResolution.nearestRows.length > 0 ? (
              <div className="space-y-0.5">
                <div className="text-[10px] text-muted-foreground/70">Nearest rows on file:</div>
                {gap.lookupResolution.nearestRows.map((row, i) => (
                  <LookupTableRowChip key={i} row={row} />
                ))}
              </div>
            ) : (
              <div className="text-[10px] text-muted-foreground/70">No rows on file for this table.</div>
            )}
          </div>

          <div className="text-[11px] text-muted-foreground border-t border-red-500/20 pt-1.5">
            <span className="font-semibold text-foreground/80">Required Action: </span>
            {gap.requiredAction}
          </div>
        </>
      ) : (
        <>
          <div className="text-[11px] text-muted-foreground">Reason: {gap.reason}</div>
          <div className="text-[11px] text-muted-foreground border-t border-red-500/20 pt-1.5">
            <span className="font-semibold text-foreground/80">Required Action: </span>
            {gap.requiredAction ?? `this process needs new calculator capability${gap.requiredCapability ? ` (${gap.requiredCapability})` : ''} — an engineering task, not a missing data row.`}
          </div>
        </>
      )}
    </div>
  );
}

const shown = (v: number | string | null) =>
  v == null ? '—' : typeof v === 'number' ? v.toLocaleString('en-US', { maximumSignificantDigits: 4, useGrouping: false }) : v;

/** One row of the dependency tree; a calculated value opens onto the values its formula uses. */
function CalculationRow({ node, depth, open: initiallyOpen }: { node: CalculationNode; depth: number; open: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  const parent = node.children.length > 0;
  return (
    <>
      <tr className="border-t border-border/20 align-top">
        <td className="py-0.5 pr-2 whitespace-nowrap" style={{ paddingLeft: depth * 14 }}>
          {parent ? (
            <button type="button" onClick={() => { setOpen((v) => !v); }} className="font-mono text-muted-foreground hover:text-foreground mr-1" aria-expanded={open} aria-label={`${open ? 'Collapse' : 'Expand'} ${node.name}`}>
              {open ? '⊟' : '⊞'}
            </button>
          ) : <span className="inline-block w-[1.1em] mr-1" />}
          <span className={depth === 0 ? 'font-medium text-foreground' : 'text-foreground/90'}>{node.name}</span>
        </td>
        <td className="py-0.5 pr-1 text-right tabular-nums">{shown(node.value)}</td>
        <td className="py-0.5 pr-2 text-muted-foreground">{node.unit ?? ''}</td>
        <td className="py-0.5 text-muted-foreground/80 max-w-[28rem] truncate" title={node.description ?? undefined}>
          {node.kind === 'calculated' && node.description ? <span className="font-mono text-[10px]">= {node.description}</span> : node.description}
        </td>
      </tr>
      {open && node.children.map((c) => <CalculationRow key={c.name} node={c} depth={depth + 1} open={false} />)}
    </>
  );
}

/** The line's result and, under it, what it is made of, as the stored calculator computed it (Formula Dependencies). */
export function CalculationTree({ trace }: { trace: readonly CalculationTraceStep[] }) {
  const root = buildCalculationTree(trace);
  if (!root) return null;
  return (
    <div className="rounded border border-border/40 overflow-x-auto">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
            <th className="text-left font-semibold px-1 py-1">Name</th>
            <th className="text-right font-semibold pr-1">Value</th>
            <th className="text-left font-semibold pr-2">Unit</th>
            <th className="text-left font-semibold">Formula or source</th>
          </tr>
        </thead>
        <tbody className="[&_td:first-child]:pl-1">
          <CalculationRow node={root} depth={0} open />
        </tbody>
      </table>
    </div>
  );
}

/**
 * On-screen calculation trace — the same real audit trail (inputs with
 * provenance, formulas with their real DB formula string, calculator
 * identity/version, confidence, and structured gaps) that already powers
 * the "Download calculation (PDF)" export, rendered inline instead of only
 * inside a downloaded file. Renders nothing when the line was never
 * migrated onto the Manufacturing Physics Calculator pipeline (no trace, no
 * gap, no confidence at all) — never a fabricated placeholder.
 */
export function CalculationTracePanel({ line, renderInput }: {
  line: CalculationTraceLine;
  /** Extra controls under an input (for example, to set the part's own value); nothing when it returns null. */
  renderInput?: (step: CalculationTraceStep) => ReactNode;
}) {
  const [showSteps, setShowSteps] = useState(false);
  const trace = line.calculationTrace ?? [];
  if (!trace.length && !line.physicsGap && !line.confidence) return null;

  const inputs = trace.filter((s) => s.kind === 'input');
  const formulas = trace.filter((s) => s.kind === 'calculated');

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-medium text-foreground">Calculation Trace</span>
        {line.confidence && <CalculatorConfidenceBadge level={line.confidence} />}
        {line.calculatorId && (
          <span className="text-[10px] text-muted-foreground/60">Calculator v{line.calculatorVersion ?? 1}</span>
        )}
        {trace.length > 0 && (
          <button
            type="button"
            onClick={() => setShowSteps((v) => !v)}
            className="text-[10px] text-muted-foreground hover:text-foreground ml-auto"
          >
            {showSteps ? 'Hide steps' : `Show ${trace.length} step${trace.length === 1 ? '' : 's'}`}
          </button>
        )}
      </div>

      {line.physicsGap && <PhysicsGapPanel gap={line.physicsGap} />}

      <CalculationTree trace={trace} />

      {showSteps && trace.length > 0 && (
        <div className="rounded border border-border/40 divide-y divide-border/20 max-h-[280px] overflow-y-auto">
          {inputs.length > 0 && (
            <div className="p-2 space-y-1.5">
              <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Inputs</div>
              {inputs.map((step, i) => (
                <div key={i} className="text-[11px]">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-muted-foreground truncate min-w-0">
                      {step.displayLabel}
                      {step.stepType === 'lookup' && (
                        <span className="ml-1.5 text-[9px] font-semibold px-1 py-px rounded bg-blue-500/15 text-blue-700 dark:text-blue-400">
                          lookup
                        </span>
                      )}
                    </span>
                    <span className="tabular-nums text-foreground shrink-0">
                      {step.value ?? '—'}{step.unit ? ` ${step.unit}` : ''}
                    </span>
                  </div>
                  {step.source && (
                    <div className="text-[10px] text-muted-foreground/60 truncate" title={step.source}>
                      {step.source}
                    </div>
                  )}
                  {renderInput?.(step)}
                </div>
              ))}
            </div>
          )}
          {formulas.length > 0 && (
            <div className="p-2 space-y-1.5">
              <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Formulas</div>
              {formulas.map((step, i) => (
                <div key={i} className="text-[11px]">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-muted-foreground truncate min-w-0">
                      {step.displayLabel}
                      {step.stepType === 'physics' && (
                        <span className="ml-1.5 text-[9px] font-semibold px-1 py-px rounded bg-brand-500/15 text-brand-700 dark:text-brand-400">
                          physics
                        </span>
                      )}
                    </span>
                    <span className="tabular-nums text-foreground shrink-0">
                      {step.value ?? '—'}{step.unit ? ` ${step.unit}` : ''}
                    </span>
                  </div>
                  {step.formula && (
                    <div className="text-[10px] font-mono text-muted-foreground/70 truncate" title={step.formula}>
                      = {step.formula}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
