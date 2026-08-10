'use client';

import { useState } from 'react';
import type { ProcessLineCost, ConfidenceLevel, PhysicsGap, LookupTableRow } from '@/lib/api/hooks/useBOMItems';

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
            this process needs new calculator capability{gap.requiredCapability ? ` (${gap.requiredCapability})` : ''} — an engineering task, not a missing data row.
          </div>
        </>
      )}
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
export function CalculationTracePanel({ line }: { line: ProcessLineCost }) {
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
                        <span className="ml-1.5 text-[9px] font-semibold px-1 py-px rounded bg-violet-500/15 text-violet-700 dark:text-violet-400">
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
