'use client';

import { useState } from 'react';

import { useCreateSandSnapshot, useReviewSandSnapshot, useSandSnapshots } from '@/lib/api/hooks/useSandSnapshots';
import type { SandSnapshot } from '@/lib/api/sand-snapshots';

const fieldClass = 'text-xs border border-border rounded px-2 py-1 bg-background focus:outline-hidden focus:ring-1 focus:ring-brand-500';
const BADGE: Record<SandSnapshot['status'], string> = {
  submitted: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  approved: 'bg-green-500/15 text-green-700 dark:text-green-400',
  rejected: 'bg-red-500/15 text-red-700 dark:text-red-400',
};

/** Approve or reject a submitted snapshot, with a note. The server refuses the one who froze it. */
function ReviewForm({ bomItemId, snapshot }: { bomItemId: string; snapshot: SandSnapshot }) {
  const [note, setNote] = useState('');
  const review = useReviewSandSnapshot(bomItemId);
  const failure = review.error as { message?: string } | null;
  const send = (decision: 'approved' | 'rejected') => { review.mutate({ snapshotId: snapshot.id, decision, note }); };
  return (
    <div className="space-y-1 pt-1">
      <input className={`${fieldClass} w-full`} aria-label="Review note" placeholder="Why (required)" value={note} onChange={(e) => { setNote(e.target.value); }} />
      <div className="flex gap-2">
        <button type="button" className={`${fieldClass} hover:bg-muted/50 disabled:opacity-50`} disabled={review.isPending || note.trim().length < 3} onClick={() => { send('approved'); }}>Approve</button>
        <button type="button" className={`${fieldClass} hover:bg-muted/50 disabled:opacity-50`} disabled={review.isPending || note.trim().length < 3} onClick={() => { send('rejected'); }}>Reject</button>
      </div>
      {failure?.message && <p className="text-[10px] text-red-600 leading-tight">{failure.message}</p>}
    </div>
  );
}

/** Frozen cost results of the part: freeze the cost as the server computes it now, and have a different member approve or reject it. */
export function SandSnapshotsPanel({ bomItemId, location, batchSize, productionLifeYears }: {
  bomItemId: string;
  location: string;
  batchSize: number | undefined;
  productionLifeYears: number | undefined;
}) {
  const list = useSandSnapshots(bomItemId);
  const create = useCreateSandSnapshot(bomItemId);
  const [label, setLabel] = useState('');
  const failure = create.error as { message?: string } | null;
  return (
    <div className="space-y-2">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate(
            { label, location, ...(batchSize != null ? { batchSize } : {}), ...(productionLifeYears != null ? { productionLifeYears } : {}) },
            { onSuccess: () => { setLabel(''); } },
          );
        }}
      >
        <input className={`${fieldClass} flex-1 min-w-0`} aria-label="Label for this frozen cost" placeholder="What this freeze supports (for example a quote)" value={label} onChange={(e) => { setLabel(e.target.value); }} />
        <button type="submit" className={`${fieldClass} hover:bg-muted/50 disabled:opacity-50`} disabled={create.isPending || label.trim().length < 3}>
          {create.isPending ? 'Freezing…' : 'Freeze this cost'}
        </button>
      </form>
      {failure?.message && <p className="text-[10px] text-red-600 leading-tight">{failure.message}</p>}
      {(list.data?.snapshots ?? []).length === 0 && <p className="text-[10px] text-muted-foreground leading-tight">Nothing frozen yet. A frozen cost is the summary as computed now, with the location, batch size and this part’s own plant values; it is never edited, and a different member approves or rejects it.</p>}
      {(list.data?.snapshots ?? []).map((s) => (
        <div key={s.id} className="rounded border border-border/50 px-2 py-1 text-[11px] space-y-0.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-medium truncate min-w-0">{s.label}</span>
            <span className={`text-[9px] font-semibold px-1.5 py-px rounded shrink-0 ${BADGE[s.status]}`}>{s.status}</span>
          </div>
          <div className="text-[10px] text-muted-foreground leading-tight">
            {s.figures.pieceCost != null ? `${s.figures.pieceCost.toFixed(2)} per good casting` : 'no total'}
            {s.figures.mouldingMachine ? ` · ${s.figures.mouldingMachine}` : ''}
            {s.figures.cavities != null ? ` · ${s.figures.cavities} cav` : ''}
            {` · ${s.context.location}${s.context.batchSize != null ? `, batch ${s.context.batchSize}` : ''}`}
            {s.context.plantOverrides.length > 0 ? ` · own values: ${s.context.plantOverrides.map((o) => o.variable).join(', ')}` : ''}
            {` · ${new Date(s.createdAt).toLocaleString()}`}
          </div>
          {s.reviewNote && <div className="text-[10px] leading-tight">{s.status === 'approved' ? 'Approved' : 'Rejected'}: {s.reviewNote}</div>}
          {s.status === 'submitted' && <ReviewForm bomItemId={bomItemId} snapshot={s} />}
        </div>
      ))}
    </div>
  );
}
