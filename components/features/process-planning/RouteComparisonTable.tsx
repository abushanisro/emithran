'use client';

import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { AlternativeRoute, DraftLine } from '@/lib/api/hooks/useProcessPlanGenerate';

interface Props {
  alternatives: AlternativeRoute[];
  selectedRouteId: string | null;
  onSelectRoute: (routeId: string) => void;
  isSelecting: boolean;
}

function riskColor(score: number): string {
  if (score < 20) return 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30';
  if (score < 40) return 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30';
  if (score < 60) return 'text-orange-400 bg-orange-400/10 border-orange-400/30';
  return 'text-red-400 bg-red-400/10 border-red-400/30';
}

function operationSequence(draftLines: DraftLine[]): string {
  return draftLines
    .filter((l) => l.kind === 'process')
    .sort((a, b) => ((a.data as any).opNbr ?? a.index) - ((b.data as any).opNbr ?? b.index))
    .map((l) => (l.data as any).operation ?? (l.data as any).processRoute ?? '—')
    .join(' → ');
}

export function RouteComparisonTable({ alternatives, selectedRouteId, onSelectRoute, isSelecting }: Props) {
  return (
    <div className="border border-slate-700 rounded-lg overflow-hidden text-xs">
      {alternatives.map((alt, idx) => {
        const isSelected = selectedRouteId
          ? alt.routeId === selectedRouteId
          : alt.isRecommended;
        const seq = operationSequence(alt.draft.draftLines);

        return (
          <div
            key={alt.routeId}
            className={cn(
              'p-3 transition-colors',
              idx > 0 && 'border-t border-slate-700',
              isSelected ? 'bg-blue-900/20' : 'bg-slate-900/30 hover:bg-slate-800/30',
            )}
          >
            <div className="flex items-start justify-between gap-3">
              {/* Left: label + ops + rationale */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-semibold text-slate-200">{alt.routeLabel.split(' (Recommended)')[0]}</span>
                  {alt.isRecommended && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-500/20 text-blue-400 border border-blue-500/30">
                      Recommended
                    </span>
                  )}
                  {isSelected && !alt.isRecommended && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-600/50 text-slate-300 border border-slate-600">
                      Selected
                    </span>
                  )}
                </div>

                {/* Operation sequence */}
                <p className="text-slate-400 truncate mb-1" title={seq}>{seq || '—'}</p>

                {/* Rationale */}
                {alt.rationale && (
                  <p className="text-slate-500 italic">{alt.rationale}</p>
                )}
              </div>

              {/* Right: metrics + action */}
              <div className="flex items-center gap-3 shrink-0">
                {/* Metrics */}
                <div className="text-right space-y-0.5">
                  <div className="text-slate-200 font-semibold">
                    ${alt.costPreview.total.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                  </div>
                  <div className="text-slate-500">{alt.estimatedLeadTimeHours.toFixed(1)} hrs</div>
                  <span className={cn('inline-block px-1.5 py-0.5 rounded border', riskColor(alt.riskScore))}>
                    Risk {alt.riskScore}
                  </span>
                </div>

                {/* Select button */}
                <Button
                  size="sm"
                  variant={isSelected ? 'secondary' : 'outline'}
                  className={cn(
                    'h-7 text-[11px] w-28',
                    isSelected && 'bg-blue-600/20 border-blue-500/50 text-blue-300 hover:bg-blue-600/30',
                  )}
                  disabled={isSelected || isSelecting}
                  onClick={() => onSelectRoute(alt.routeId)}
                >
                  {isSelected ? (
                    <><Check className="h-3 w-3 mr-1" />Selected</>
                  ) : (
                    'Use this route'
                  )}
                </Button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
