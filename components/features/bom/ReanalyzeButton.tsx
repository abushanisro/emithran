'use client';

import { Loader2, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useReanalyzeBOMItem } from '@/lib/api/hooks/useBOMItems';

/**
 * Re-runs the CAD analysis of one BOM item, for the places that tell the user a result comes from the last analysis
 * (no flat-pattern outline, so no true nest) and that a fresh one may change it.
 */
export function ReanalyzeButton({ bomItemId, className }: { bomItemId: string; className?: string }) {
  const reanalyze = useReanalyzeBOMItem(bomItemId);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={className}
      disabled={reanalyze.isPending}
      onClick={() => { reanalyze.mutate(); }}
    >
      {reanalyze.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
      {reanalyze.isPending ? 'Re-running analysis…' : 'Reanalyze'}
    </Button>
  );
}
