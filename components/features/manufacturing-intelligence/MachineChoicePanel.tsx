'use client';

import { useState } from 'react';
import type { MachineChoiceDto } from '@/lib/api/hooks/useBOMItems';

/**
 * Why a line runs on its machine (backend machine-choice.ts): the rule the
 * engine chose by, the criteria a machine had to meet, and every machine it
 * looked at -- chosen, capable with its cost on the rule's basis, or rejected
 * with the criteria it failed. Everything shown comes from the cost line.
 */
export function MachineChoicePanel({ choice, currencySymbol }: { choice: MachineChoiceDto; currencySymbol: string }) {
  const [showRejected, setShowRejected] = useState(false);
  const capable = choice.candidates.filter((c) => c.status !== 'rejected');
  const rejected = choice.candidates.filter((c) => c.status === 'rejected');
  return (
    <div className="space-y-1.5">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Why this machine</div>
      <p className="text-xs">
        {choice.chosen
          ? <><span className="font-medium">{choice.chosen}</span> — {choice.rule.charAt(0).toLowerCase() + choice.rule.slice(1)}.</>
          : <>No machine qualifies. Rule: {choice.rule}.</>}
      </p>
      <div>
        <div className="text-[10px] text-muted-foreground">Criteria</div>
        <ul className="list-disc pl-4 text-[11px] text-muted-foreground space-y-0.5">
          {choice.criteria.map((c) => <li key={c}>{c}</li>)}
        </ul>
      </div>
      <div>
        <div className="text-[10px] text-muted-foreground">
          {choice.capableCount} capable of {choice.candidates.length} checked
        </div>
        {capable.map((c) => (
          <div key={c.name} className="flex items-baseline justify-between gap-2 text-[11px]">
            <span className={`truncate ${c.status === 'chosen' ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>
              {c.status === 'chosen' ? '✓ ' : ''}{c.name}
              {c.reasons.length > 0 && <span className="text-muted-foreground font-normal"> · {c.reasons.join('; ')}</span>}
            </span>
            {c.perPartCost != null && <span className="tabular-nums shrink-0">{currencySymbol}{c.perPartCost.toFixed(4)}</span>}
          </div>
        ))}
        {rejected.length > 0 && (
          <button type="button" onClick={() => setShowRejected((v) => !v)} className="mt-1 text-[10px] text-violet-400 hover:text-violet-300">
            {showRejected ? 'Hide' : 'Show'} {rejected.length} not capable
          </button>
        )}
        {showRejected && rejected.map((c) => (
          <div key={c.name} className="text-[11px] text-muted-foreground">
            <span className="line-through decoration-muted-foreground/40">{c.name}</span>: {c.reasons.join('; ')}
          </div>
        ))}
      </div>
    </div>
  );
}
