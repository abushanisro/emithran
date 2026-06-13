'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Circle, Loader2, XCircle } from 'lucide-react';
import type { GenerationResponse, StreamEvent } from '@/lib/api/hooks/useProcessPlanGenerate';

interface Props {
  events: StreamEvent[];
  generation: GenerationResponse | null;
  isGenerating: boolean;
  startedAt: number;
}

interface StageState {
  label: string;
  status: 'pending' | 'in_progress' | 'done' | 'failed';
  detail?: string;
}

function useElapsed(startedAt: number, running: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!running || !startedAt) return;
    setElapsed(Date.now() - startedAt);
    const id = setInterval(() => setElapsed(Date.now() - startedAt), 500);
    return () => clearInterval(id);
  }, [startedAt, running]);
  return elapsed;
}

function formatElapsed(ms: number): string {
  if (ms <= 0) return '0s';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

function computeProgress(events: StreamEvent[], generation: GenerationResponse | null): number {
  const has = (t: StreamEvent['type']) => events.some((e) => e.type === t);
  const toolCallCount = events.filter((e) => e.type === 'reasoning.tool_call').length;
  const status = generation?.status;

  if (status === 'draft_ready' || status === 'applied' || status === 'out_of_scope' || status === 'failed') return 100;
  if (has('resolver.done')) return 92;
  if (has('reasoning.tool_call')) return Math.min(75, 35 + toolCallCount * 13);
  if (has('reasoning.started')) return 32;
  if (has('retrieval.done')) return 25;
  if (has('scope_decided')) return 12;
  return 5;
}

function computeStages(events: StreamEvent[], generation: GenerationResponse | null, isGenerating: boolean): StageState[] {
  const has = (t: StreamEvent['type']) => events.find((e) => e.type === t);
  const retrieval = has('retrieval.done');
  const reasoningStarted = has('reasoning.started');
  const resolver = has('resolver.done');
  const draftReady = has('draft_ready');
  const outOfScope = has('out_of_scope');
  const failedEvent = has('failed');
  const toolCalls = events.filter((e) => e.type === 'reasoning.tool_call').length;

  const failedStage: string | null = failedEvent ? (failedEvent as any).data?.stage ?? null : null;
  const status = generation?.status;
  const isTerminal = !!draftReady || !!outOfScope || !!failedEvent ||
    ['draft_ready', 'applied', 'out_of_scope', 'failed'].includes(status ?? '');
  const isFailed = !!failedEvent || status === 'failed';

  const retrievalDetail = retrieval ? (() => {
    const c = (retrieval as any).data.candidateCounts as Record<string, number>;
    return `${c.rawMaterials ?? 0} mat · ${c.machines ?? 0} mch · ${c.labour ?? 0} lab · ${c.processes ?? 0} ops`;
  })() : undefined;

  const reasoningDetail = reasoningStarted
    ? `${toolCalls} tool call${toolCalls === 1 ? '' : 's'}`
    : undefined;

  const resolverDetail = resolver ? (() => {
    const c = (resolver as any).data.lineCounts as Record<string, number>;
    return `${c.raw_material ?? 0} mat · ${c.process ?? 0} ops · ${c.tooling ?? 0} tool · ${c.logistics ?? 0} log`;
  })() : undefined;

  const finalLabel = outOfScope
    ? 'Out of scope — no plan generated'
    : isFailed
    ? `Failed${failedStage ? ` at ${failedStage}` : ''}`
    : isTerminal
    ? 'Draft ready'
    : 'Awaiting result';

  const finalStatus: StageState['status'] = isFailed ? 'failed' : isTerminal ? 'done' : 'pending';

  return [
    {
      label: 'Retrieve candidates',
      status: retrieval ? 'done'
        : failedStage === 'retrieval' ? 'failed'
        : isGenerating ? 'in_progress'
        : 'pending',
      detail: retrievalDetail,
    },
    {
      label: 'Reason (Claude)',
      status: reasoningStarted
        ? (resolver || outOfScope) ? 'done'
          : failedStage === 'reasoning' ? 'failed'
          : 'in_progress'
        : retrieval ? 'in_progress'
        : 'pending',
      detail: reasoningDetail,
    },
    {
      label: 'Resolve + validate',
      status: resolver ? 'done'
        : failedStage === 'resolver' ? 'failed'
        : reasoningStarted ? 'in_progress'
        : 'pending',
      detail: resolverDetail,
    },
    {
      label: finalLabel,
      status: finalStatus,
    },
  ];
}

export function GenerationStreamView({ events, generation, isGenerating, startedAt }: Props) {
  const status = generation?.status;
  const isFailed = status === 'failed' || events.some((e) => e.type === 'failed');
  const isOutOfScope = status === 'out_of_scope' || events.some((e) => e.type === 'out_of_scope');
  const isSuccess = status === 'draft_ready' || status === 'applied';

  const elapsed = useElapsed(startedAt, isGenerating);
  const displayMs = !isGenerating && generation?.completedAt && startedAt
    ? Math.max(0, new Date(generation.completedAt).getTime() - startedAt)
    : elapsed;

  const progress = computeProgress(events, generation);
  const stages = computeStages(events, generation, isGenerating);

  const barColor = isFailed ? 'bg-destructive'
    : isOutOfScope ? 'bg-amber-500'
    : isSuccess ? 'bg-green-500'
    : 'bg-primary';

  const headerLabel = isFailed ? 'Generation failed'
    : isOutOfScope ? 'Out of scope'
    : isSuccess ? 'Draft ready'
    : 'Generating…';

  const headerColor = isFailed ? 'text-destructive'
    : isOutOfScope ? 'text-amber-600 dark:text-amber-400'
    : isSuccess ? 'text-green-600 dark:text-green-400'
    : 'text-foreground';

  return (
    <div className="space-y-2.5">
      {/* Header: status label + percentage + elapsed */}
      <div className="flex items-center justify-between">
        <span className={`text-xs font-semibold ${headerColor}`}>{headerLabel}</span>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
          <span>{progress}%</span>
          <span className="opacity-40">·</span>
          <span>{formatElapsed(displayMs)}</span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ease-out ${barColor}`}
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Stage checklist */}
      <div className="rounded-md border bg-muted/20 px-3 py-2 space-y-1.5">
        {stages.map((s, i) => (
          <div key={i} className="flex items-start gap-2 text-[11px]">
            {s.status === 'done' ? (
              <CheckCircle2 className="h-3 w-3 text-green-500 mt-0.5 shrink-0" />
            ) : s.status === 'failed' ? (
              <XCircle className="h-3 w-3 text-destructive mt-0.5 shrink-0" />
            ) : s.status === 'in_progress' ? (
              <Loader2 className="h-3 w-3 text-primary animate-spin mt-0.5 shrink-0" />
            ) : (
              <Circle className="h-3 w-3 text-muted-foreground/40 mt-0.5 shrink-0" />
            )}
            <div className="flex-1">
              <span className={s.status === 'pending' ? 'text-muted-foreground' : ''}>{s.label}</span>
              {s.detail && <span className="ml-1 text-muted-foreground">— {s.detail}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
