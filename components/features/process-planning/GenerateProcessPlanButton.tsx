'use client';

import { useRef, useState } from 'react';
import { Loader2, Sparkles, Zap, RefreshCw, FileText } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  useGenerateProcessPlan,
  useGenerationStream,
  useLatestDraftGeneration,
} from '@/lib/api/hooks/useProcessPlanGenerate';
import type { GenerationResponse } from '@/lib/api/hooks/useProcessPlanGenerate';
import { GenerateProcessPlanPanel } from './GenerateProcessPlanPanel';

interface Props {
  bomItemId: string | null;
  hasGeometry: boolean;
  className?: string;
}

const ESTIMATED_CREDITS = 50;

export function GenerateProcessPlanButton({ bomItemId, hasGeometry, className }: Props) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [generation, setGeneration] = useState<GenerationResponse | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  // Use ref so handleConfirm always reads the latest value without stale closure
  const forceRefreshRef = useRef(false);

  const queryClient = useQueryClient();
  const generate = useGenerateProcessPlan();
  const { data: existingDraft, isLoading: isDraftLoading, refetch: refetchDraft } = useLatestDraftGeneration(bomItemId);

  const streamEnabled = panelOpen && !!bomItemId && generate.isPending;
  const events = useGenerationStream(bomItemId ?? '', streamEnabled);

  const isGenerating = generate.isPending;

  // Show "View Draft" if: (1) server query found a draft_ready generation, OR
  // (2) we just generated one this session (local state fallback for when
  //     the /draft endpoint is unavailable or returns stale null).
  const localDraft = generation?.status === 'draft_ready' ? generation : null;
  const effectiveDraft = existingDraft ?? localDraft;
  const hasDraft = !!effectiveDraft && !isGenerating;

  const openWithExisting = () => {
    setConfirmOpen(false);
    setGeneration(effectiveDraft!);
    setStartedAt(effectiveDraft?.startedAt ? new Date(effectiveDraft.startedAt).getTime() : Date.now());
    setPanelOpen(true);
  };

  const handleConfirm = async () => {
    if (!bomItemId) return;
    const fr = forceRefreshRef.current;
    setConfirmOpen(false);
    setGeneration(null);
    setStartedAt(Date.now());
    setPanelOpen(true);
    try {
      const result = await generate.mutateAsync({ bomItemId, forceRefresh: fr });
      setGeneration(result);
      // Push result into the query cache so "View Draft" appears without a round-trip
      if (result.status === 'draft_ready') {
        queryClient.setQueryData(['process-plan-draft', bomItemId], result);
      }
    } catch {
      // Toast already shown by the hook; panel stays open showing failure state
    }
  };

  const handlePanelClose = () => {
    setPanelOpen(false);
    refetchDraft();
  };

  // While the draft query is loading we can't know yet if a draft exists —
  // show a neutral disabled state instead of flashing "Generate" then "View Draft"
  if (isDraftLoading && !isGenerating) {
    return (
      <Button size="sm" variant="outline" disabled className={`h-7 px-2.5 text-xs gap-1.5 ${className ?? ''}`}>
        <Loader2 className="h-3 w-3 animate-spin" />
        <span>Loading…</span>
      </Button>
    );
  }

  return (
    <>
      {hasDraft ? (
        <div className={`flex items-center gap-1 ${className ?? ''}`}>
          <Button
            size="sm"
            variant="outline"
            onClick={openWithExisting}
            className="h-7 px-2.5 text-xs gap-1.5"
          >
            <FileText className="h-3 w-3" />
            View Draft
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              forceRefreshRef.current = true;
              setConfirmOpen(true);
            }}
            disabled={isGenerating}
            className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
            title="Generate a fresh plan (replaces existing draft)"
          >
            <RefreshCw className="h-3 w-3" />
          </Button>
        </div>
      ) : (
        <Button
          size="sm"
          variant="default"
          onClick={() => {
            forceRefreshRef.current = false;
            setConfirmOpen(true);
          }}
          disabled={!bomItemId || isGenerating}
          className={`h-7 px-2.5 text-xs gap-1.5 ${className ?? ''}`}
          title={!hasGeometry ? 'Upload a 3D file first for accurate generation' : undefined}
        >
          {isGenerating ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Sparkles className="h-3 w-3" />
          )}
          <span>{isGenerating ? 'Generating…' : 'Generate Process Plan'}</span>
          {!isGenerating && <span className="opacity-70 text-[10px]">~{ESTIMATED_CREDITS} cr</span>}
        </Button>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={(open) => { if (!open) forceRefreshRef.current = false; setConfirmOpen(open); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-yellow-500" />
              {forceRefreshRef.current ? 'Regenerate Process Plan?' : 'Generate AI Process Plan?'}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                {forceRefreshRef.current && (
                  <p className="text-sm text-amber-600 dark:text-amber-400 font-medium">
                    This will replace your existing draft with a new generation.
                  </p>
                )}
                <p>This will use AI to generate a full process plan for the selected part.</p>
                <div className="rounded-lg border bg-muted/50 px-4 py-3 flex items-center justify-between">
                  <span className="text-sm font-medium text-foreground">Estimated credit cost</span>
                  <span className="text-lg font-bold text-foreground">~{ESTIMATED_CREDITS} credits</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Credits are deducted once generation completes. You can review the draft before applying it.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm}>
              {forceRefreshRef.current ? 'Yes, regenerate' : 'Yes, generate'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <GenerateProcessPlanPanel
        open={panelOpen}
        onClose={handlePanelClose}
        generation={generation}
        isGenerating={isGenerating}
        streamEvents={events}
        startedAt={startedAt}
      />
    </>
  );
}
