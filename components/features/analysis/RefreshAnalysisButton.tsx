'use client';

import { Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

import { analysisRunMessage } from '@/lib/analysis/analysis-status';
import { useRefreshAnalysisCue } from '@/lib/analysis/refresh-analysis-cue';
import { useAnalysisRun } from '@/lib/api/hooks/useAnalysisRun';
import { useAnalysisStatus } from '@/lib/api/hooks/useAnalysisStatus';
import { cn } from '@/lib/utils';

/**
 * Makes the part's analysis current (POST /bom-items/:id/analysis-runs): the CAD features, the drawing and, for a sand casting, the casting analysis,
 * whatever the status says is missing. The only place an analysis is started; Apply refuses an unanalysed part and points here (the cue).
 */
export function RefreshAnalysisButton({ itemId, hasFile }: { itemId: string; hasFile: boolean }) {
  const status = useAnalysisStatus(itemId);
  const run = useAnalysisRun(itemId);
  const cued = useRefreshAnalysisCue();
  const running = run.isPending || status.data?.casting === 'running';
  const needed = status.data != null && !status.data.ready && !running;
  const title = !hasFile
    ? 'Upload a 3D file to analyse the part'
    : running
      ? 'The analysis is running'
      : needed
        ? 'This part is not analysed: Apply is blocked until it is'
        : 'Make the CAD, drawing and casting analysis current (nothing is redone when they already are)';

  return (
    <button
      type="button"
      data-testid="refresh-analysis"
      onClick={() => {
        run.mutateAsync()
          .then((r) => { const m = analysisRunMessage(r); if (m.ok) toast.success(m.text); else toast.error(m.text); })
          .catch((e: unknown) => { toast.error(`Analysis failed: ${e instanceof Error ? e.message : 'unknown error'}`); });
      }}
      disabled={!hasFile || running}
      title={title}
      className={cn(
        'flex items-center gap-1.5 text-[11px] px-2 py-1 rounded border transition-colors disabled:opacity-50 disabled:cursor-not-allowed shrink-0',
        needed ? 'border-amber-500 text-amber-700 dark:text-amber-400 bg-amber-500/10 hover:bg-amber-500/20' : 'border-border hover:bg-muted',
        cued && 'ring-2 ring-amber-500 ring-offset-1 animate-pulse',
      )}
    >
      {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
      {running ? 'Analysing…' : 'Refresh analysis'}
      {needed && <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-label="analysis needed" />}
    </button>
  );
}
