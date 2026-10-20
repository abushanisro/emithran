'use client';

import { GripHorizontal, GripVertical } from 'lucide-react';
import { PanelResizeHandle } from 'react-resizable-panels';

import type { ReactNode } from 'react';

// The same drag handles and pane header as the manufacturing-intelligence page, so the two workspaces feel alike.

export function HResizeHandle() {
  return (
    <PanelResizeHandle className="group relative flex w-1 items-center justify-center bg-border transition-colors hover:bg-brand-400">
      <GripVertical className="absolute h-4 w-4 text-muted-foreground group-hover:text-brand-600" />
    </PanelResizeHandle>
  );
}

export function VResizeHandle() {
  return (
    <PanelResizeHandle className="group relative flex h-1 items-center justify-center bg-border transition-colors hover:bg-brand-400">
      <GripHorizontal className="absolute h-4 w-4 text-muted-foreground group-hover:text-brand-600" />
    </PanelResizeHandle>
  );
}

/** A titled pane: small caps title bar (optional actions on the right) over a scrolling body. */
export function Pane({ title, actions, children, bodyClassName = '' }: { title: string; actions?: ReactNode; children: ReactNode; bodyClassName?: string }) {
  return (
    <section className="flex h-full min-h-0 flex-col bg-card" aria-label={title}>
      <header className="flex h-9 shrink-0 items-center justify-between border-b px-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h2>
        {actions}
      </header>
      <div className={`min-h-0 flex-1 ${bodyClassName}`}>{children}</div>
    </section>
  );
}
