'use client';

import { useState } from 'react';

import { splitNote } from '@/lib/text/concise-note';

/** A note shown as its core point; the detail behind it opens in place ("more"). */
export function ConciseNote({ text, className, as: Tag = 'p' }: { text: string; className?: string | undefined; as?: 'p' | 'span' }) {
  const [open, setOpen] = useState(false);
  const { lead, rest } = splitNote(text);
  return (
    <Tag className={className} title={rest && !open ? text : undefined}>
      {open || !rest ? text : lead}
      {rest && (
        <button type="button" className="ml-1 underline underline-offset-2 opacity-70 hover:opacity-100" onClick={() => { setOpen(!open); }}>
          {open ? 'less' : 'more'}
        </button>
      )}
    </Tag>
  );
}
