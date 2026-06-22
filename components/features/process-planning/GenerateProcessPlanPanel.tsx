'use client';

import React, { useMemo, useState, useCallback } from 'react';
import { Loader2, Sparkles, ChevronDown, ChevronRight } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  useApplyGeneration,
  useDiscardGeneration,
  useRecordLineEdit,
  useSelectRoute,
} from '@/lib/api/hooks/useProcessPlanGenerate';
import type {
  ApplyRequest,
  DraftLine,
  DraftLineKind,
  GenerationResponse,
  RouteIssue,
  StreamEvent,
} from '@/lib/api/hooks/useProcessPlanGenerate';

import { RouteComparisonTable } from './RouteComparisonTable';

import { DraftLineCard } from './DraftLineCard';
import { ProposedMasterCard } from './ProposedMasterCard';
import { GenerationStreamView } from './GenerationStreamView';
import { CostPreviewStrip } from './CostPreviewStrip';
import { OutOfScopeNotice } from './OutOfScopeNotice';
import { ProcessPlanFeedbackForm } from './ProcessPlanFeedbackForm';

import type { FeatureGroup } from '@/lib/utils/feature-colors';

interface Props {
  open: boolean;
  onClose: () => void;
  generation: GenerationResponse | null;
  isGenerating: boolean;
  streamEvents: StreamEvent[];
  startedAt: number;
  onFeatureHighlight?: (feature: any | null, group: FeatureGroup | null) => void;
  onFeatureFocus?: (feature: any | null, group: FeatureGroup | null) => void;
}

const KIND_ORDER: DraftLineKind[] = ['raw_material', 'process', 'tooling', 'logistics', 'procured_part'];

const KIND_LABEL: Record<DraftLineKind, string> = {
  raw_material: 'Raw Materials',
  process: 'Manufacturing Processes',
  tooling: 'Tooling & Fixtures',
  logistics: 'Packaging & Logistics',
  procured_part: 'Procured Parts',
};

export function GenerateProcessPlanPanel({ open, onClose, generation, isGenerating, streamEvents, startedAt, onFeatureHighlight, onFeatureFocus }: Props) {
  const apply = useApplyGeneration();
  const discard = useDiscardGeneration();
  const recordEdit = useRecordLineEdit();
  const selectRoute = useSelectRoute();

  // Local overrides — what the user has edited or removed in-place.
  const [overrides, setOverrides] = useState<Map<string, Record<string, any>>>(new Map());
  const [removals, setRemovals] = useState<Set<string>>(new Set());
  const [masterApprovals, setMasterApprovals] = useState<Map<string, boolean>>(new Map());
  const [reasoningOpen, setReasoningOpen] = useState(false);
  const [justApplied, setJustApplied] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  const draft = generation?.draft ?? null;

  const linesByKind = useMemo(() => {
    if (!draft) return {} as Record<DraftLineKind, DraftLine[]>;
    const out: Record<DraftLineKind, DraftLine[]> = {
      raw_material: [], process: [], tooling: [], logistics: [], procured_part: [],
    };
    for (const line of draft.draftLines) out[line.kind].push(line);
    return out;
  }, [draft]);

  const lineKey = (line: DraftLine) => `${line.kind}#${line.index}`;

  const handleFieldChange = (line: DraftLine, fieldPath: string, newValue: unknown) => {
    if (!generation) return;
    const key = lineKey(line);
    const originalValue = line.data[fieldPath];
    setOverrides((prev) => {
      const next = new Map(prev);
      const existing = next.get(key) ?? {};
      next.set(key, { ...existing, [fieldPath]: newValue });
      return next;
    });
    // Capture LineEdit for feedback dataset (fire-and-forget)
    recordEdit.mutate({
      generationId: generation.id,
      edit: { lineKind: line.kind, lineIndex: line.index, fieldPath, originalValue, newValue, editAction: 'field_change' },
    });
  };

  const handleRemove = (line: DraftLine) => {
    if (!generation) return;
    const key = lineKey(line);
    setRemovals((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
    recordEdit.mutate({
      generationId: generation.id,
      edit: { lineKind: line.kind, lineIndex: line.index, fieldPath: '__line__', editAction: 'removed_line' },
    });
  };

  const handleMasterApprove = (proposedMasterId: string, approved: boolean) => {
    setMasterApprovals((prev) => {
      const next = new Map(prev);
      next.set(proposedMasterId, approved);
      return next;
    });
  };

  const handleApply = async () => {
    if (!generation) return;
    const body: ApplyRequest = {
      overrides: Array.from(overrides.entries()).map(([key, data]) => {
        const [kind, index] = key.split('#') as [string, string];
        return { kind: kind as DraftLineKind, index: parseInt(index, 10), data };
      }),
      removals: Array.from(removals).map((key) => {
        const [kind, index] = key.split('#') as [string, string];
        return { kind: kind as DraftLineKind, index: parseInt(index, 10) };
      }),
      proposedMasterApprovals: Array.from(masterApprovals.entries()).map(([proposedMasterId, approved]) => ({ proposedMasterId, approved })),
    };
    await apply.mutateAsync({ generationId: generation.id, body, bomItemId: generation.bomItemId });
    setJustApplied(true);
  };

  const handleDiscard = async () => {
    if (!generation) return;
    await discard.mutateAsync({ generationId: generation.id, bomItemId: generation.bomItemId });
    onClose();
  };

  // ── States ───────────────────────────────────────────────────────────────

  const isOutOfScope = generation?.status === 'out_of_scope';
  const isFailed = generation?.status === 'failed';
  const isDraftReady = generation?.status === 'draft_ready';
  const isApplied = justApplied || generation?.status === 'applied';

  // Reset applied state when a new generation loads or panel closes
  React.useEffect(() => { setJustApplied(false); }, [generation?.id, open]);

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-xl flex flex-col p-0">
        <SheetHeader className="px-4 py-3 border-b bg-muted/40">
          <SheetTitle className="flex items-center gap-2 text-sm">
            <Sparkles className="h-4 w-4 text-primary" />
            <span>AI Process Plan</span>
            {generation?.brief?.bomItem?.partNumber && (
              <span className="text-muted-foreground font-normal">· {generation.brief.bomItem.partNumber}</span>
            )}
          </SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {(isGenerating || !!generation) && (
            <GenerationStreamView
              events={streamEvents}
              generation={generation}
              isGenerating={isGenerating}
              startedAt={startedAt}
            />
          )}

          {isOutOfScope && generation && (
            <OutOfScopeNotice generation={generation} />
          )}

          {isFailed && generation && (
            <div className="rounded border border-destructive/40 bg-destructive/5 p-3 text-sm">
              <p className="font-medium text-destructive">Generation failed</p>
              <p className="text-muted-foreground text-xs mt-1">{generation.errorMessage}</p>
              <p className="text-xs mt-2">You can try again, or fill the sections manually.</p>
            </div>
          )}

          {isApplied && (
            <div className="rounded border border-green-500/40 bg-green-500/10 p-3 text-sm flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-green-600 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
              <div>
                <p className="font-medium text-green-700 dark:text-green-400">Plan applied to BOM</p>
                <p className="text-xs text-muted-foreground mt-0.5">Draft is kept for reference. Generate a new plan to replace it.</p>
              </div>
            </div>
          )}

          {(isDraftReady || isApplied) && draft && generation && (
            <>
              {/* Reasoning trail (collapsible) */}
              <button
                onClick={() => setReasoningOpen((v) => !v)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {reasoningOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                Reasoning trail · {generation.toolCalls.length} tool call{generation.toolCalls.length === 1 ? '' : 's'} ·
                tokens in {generation.tokensIn.toLocaleString('en-IN')} (cache hit {generation.cacheReadTokens.toLocaleString('en-IN')}) ·
                out {generation.tokensOut.toLocaleString('en-IN')}
              </button>
              {reasoningOpen && (
                <div className="border rounded bg-muted/20 p-2 space-y-1 text-[11px] font-mono leading-snug">
                  {generation.toolCalls.map((tc) => (
                    <div key={tc.index} className="border-l-2 border-primary/40 pl-2">
                      <div className="font-semibold">#{tc.index} {tc.toolName} ({tc.durationMs}ms)</div>
                      <pre className="whitespace-pre-wrap text-muted-foreground">{JSON.stringify(tc.input, null, 0).slice(0, 220)}</pre>
                      <pre className="whitespace-pre-wrap text-muted-foreground">→ {JSON.stringify(tc.result, null, 0).slice(0, 220)}</pre>
                    </div>
                  ))}
                </div>
              )}

              {/* Proposed masters */}
              {draft.proposedMasters.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Proposed new master rows ({draft.proposedMasters.length})
                  </h4>
                  {draft.proposedMasters.map((pm) => (
                    <ProposedMasterCard
                      key={pm.proposedMasterId}
                      master={pm}
                      approved={masterApprovals.get(pm.proposedMasterId) ?? false}
                      onChange={(v) => handleMasterApprove(pm.proposedMasterId, v)}
                    />
                  ))}
                </div>
              )}

              {/* Validation issues banner */}
              {isDraftReady && generation?.hasValidationErrors && generation.routeValidationIssues && generation.routeValidationIssues.length > 0 && (
                <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3">
                  <p className="text-xs font-semibold text-red-400 mb-2">Route Validation Issues</p>
                  <ul className="space-y-1">
                    {generation.routeValidationIssues.map((issue: RouteIssue) => (
                      <li key={issue.ruleId} className="text-xs">
                        <span className={issue.severity === 'error' ? 'text-red-400 font-medium' : 'text-amber-400 font-medium'}>
                          [{issue.severity.toUpperCase()}]
                        </span>
                        <span className="text-foreground/80 ml-1">{issue.message}</span>
                        {issue.suggestedFix && (
                          <span className="text-muted-foreground"> · Fix: {issue.suggestedFix}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {isDraftReady && !generation?.hasValidationErrors && generation?.routeValidationIssues !== undefined && (
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2">
                  <p className="text-xs text-emerald-400 font-medium">Route validation passed — no sequencing issues detected</p>
                </div>
              )}

              {/* Alternative routes comparison */}
              {isDraftReady && draft.alternatives && draft.alternatives.length > 1 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Process Routes ({draft.alternatives.length})
                  </h4>
                  <RouteComparisonTable
                    alternatives={draft.alternatives}
                    selectedRouteId={draft.selectedRouteId ?? null}
                    onSelectRoute={(routeId) =>
                      selectRoute.mutate({ generationId: generation.id, routeId })
                    }
                    isSelecting={selectRoute.isPending}
                  />
                </div>
              )}

              {/* Sections */}
              {KIND_ORDER.map((kind) => {
                const lines = linesByKind[kind] ?? [];
                if (lines.length === 0) return null;
                const removedCount = lines.filter((l) => removals.has(lineKey(l))).length;
                return (
                  <div key={kind} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {KIND_LABEL[kind]} ({lines.length - removedCount}{removedCount > 0 ? ` · ${removedCount} removed` : ''})
                      </h4>
                    </div>
                    {lines.map((line) => (
                      <DraftLineCard
                        key={lineKey(line)}
                        line={line}
                        removed={removals.has(lineKey(line))}
                        override={overrides.get(lineKey(line)) ?? null}
                        onFieldChange={(field, value) => handleFieldChange(line, field, value)}
                        onRemove={() => handleRemove(line)}
                        featureGraph={generation?.brief?.featureGraph as any}
                        onFeatureHighlight={onFeatureHighlight}
                        onFeatureFocus={onFeatureFocus}
                      />
                    ))}
                  </div>
                );
              })}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="border-t bg-card px-4 py-3 space-y-3">
          {isDraftReady && draft && (() => {
            const featureGraph = generation?.brief?.featureGraph as any;
            const totalFeatures = featureGraph?.features?.length ?? 0;
            const linkedIds = new Set(
              draft.draftLines
                .filter((l) => l.kind === 'process' && (l.data as any).featureId)
                .map((l) => (l.data as any).featureId)
            );
            const covered = linkedIds.size;
            const pct = totalFeatures > 0 ? Math.round(covered / totalFeatures * 100) : null;
            return (
              <>
                <CostPreviewStrip costPreview={draft.costPreview} removedCount={removals.size} />
                {pct !== null && (
                  <div className="flex items-center justify-between text-xs border-t pt-2">
                    <span className="text-muted-foreground">
                      Feature coverage: <span className="font-medium text-foreground">{covered}/{totalFeatures}</span>
                    </span>
                    <span className={pct >= 80 ? 'text-emerald-400 font-semibold' : pct >= 60 ? 'text-amber-400 font-semibold' : 'text-red-400 font-semibold'}>
                      {pct}%{totalFeatures - covered > 0 ? ` · ${totalFeatures - covered} unlinked` : ''}
                    </span>
                  </div>
                )}
              </>
            );
          })()}
          {isDraftReady && !draft && (
            <CostPreviewStrip costPreview={{ rawMaterial: 0, process: 0, tooling: 0, logistics: 0, procuredPart: 0, total: 0 }} removedCount={0} />
          )}
          <div className="flex items-center justify-between gap-2">
            <div className="text-[10px] text-muted-foreground">
              {generation && (
                <>
                  <Badge variant="outline" className="h-5 text-[10px]">{generation.status}</Badge>
                  {generation.scopeDecision?.family && (
                    <span className="ml-2">Family: {generation.scopeDecision.family.replace('_', ' ')}</span>
                  )}
                </>
              )}
            </div>
            <div className="flex items-center gap-2">
              {!isApplied && generation && generation.status !== 'applied' && (
                <Button variant="ghost" size="sm" onClick={handleDiscard} disabled={discard.isPending}>
                  Discard
                </Button>
              )}
              {(isDraftReady || isApplied) && draft && (
                <Button variant="ghost" size="sm" onClick={() => setFeedbackOpen(true)}>
                  Submit Correction
                </Button>
              )}
              {isDraftReady && !isApplied && (
                <Button size="sm" onClick={handleApply} disabled={apply.isPending}>
                  {apply.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                  Apply All · ₹{draft?.costPreview.total.toFixed(2)}
                </Button>
              )}
              {isApplied && (
                <Button size="sm" variant="outline" onClick={onClose}>
                  Close
                </Button>
              )}
            </div>
          </div>
        </div>
      </SheetContent>

      {generation && draft && (
        <Dialog open={feedbackOpen} onOpenChange={setFeedbackOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="text-sm">Engineer Correction</DialogTitle>
            </DialogHeader>
            <ProcessPlanFeedbackForm
              bomItemId={generation.bomItemId}
              partFamily={generation.partFamily}
              aiProcessSequence={
                draft.draftLines
                  .filter((l) => l.kind === 'process')
                  .sort((a, b) => ((a.data as any).opNbr ?? a.index) - ((b.data as any).opNbr ?? b.index))
                  .map((l) => (l.data as any).processName ?? (l.data as any).process ?? `step ${l.index}`)
              }
              onClose={() => setFeedbackOpen(false)}
            />
          </DialogContent>
        </Dialog>
      )}
    </Sheet>
  );
}
