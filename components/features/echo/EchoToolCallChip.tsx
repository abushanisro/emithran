'use client';

import { ChevronDown, ChevronRight, Loader2, Wrench, XCircle } from 'lucide-react';
import { useState } from 'react';

import type { EchoToolCall } from '@/lib/echo/types';
import { cn } from '@/lib/utils';

const PRETTY_NAMES: Record<string, string> = {
  get_part_cost_breakdown: 'Cost breakdown',
  get_dfm_review: 'DFM review',
  run_dfm_deep_analysis: 'Deep DFM analysis',
  get_process_candidates: 'Process candidates',
  rank_suppliers_for_part: 'Supplier ranking',
  find_suppliers_with_capability: 'Vendor capability search',
  compare_cost_to_benchmark: 'Benchmark comparison',
  get_rfq_status: 'RFQ status',
  get_production_lot_status: 'Lot status',
  get_vave_ideas: 'VAVE ideas',
};

export function EchoToolCallChip({ call }: { call: EchoToolCall }) {
  const [open, setOpen] = useState(false);
  const label = PRETTY_NAMES[call.name] ?? call.name;

  return (
    <div
      className={cn(
        'rounded-md border text-xs my-1.5 overflow-hidden',
        call.isError
          ? 'border-red-500/40 bg-red-500/5'
          : 'border-violet-500/30 bg-violet-500/5',
      )}
    >
      <button
        type="button"
        onClick={() => { setOpen((o) => !o); }}
        className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-violet-500/10 text-left"
      >
        {call.pending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-500" />
        ) : call.isError ? (
          <XCircle className="h-3.5 w-3.5 text-red-500" />
        ) : (
          <Wrench className="h-3.5 w-3.5 text-violet-500" />
        )}
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground truncate flex-1">
          {call.pending ? 'Running…' : call.resultPreview}
        </span>
        {call.durationMs !== undefined && (
          <span className="text-muted-foreground tabular-nums">
            {String(Math.round(call.durationMs))}ms
          </span>
        )}
        {open ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
      </button>
      {open && (
        <div className="px-2 py-1.5 border-t border-violet-500/20 bg-background/40">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-0.5">
            Input
          </div>
          <pre className="text-[11px] overflow-x-auto whitespace-pre-wrap break-all">
            {JSON.stringify(call.input, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
