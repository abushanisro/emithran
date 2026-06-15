'use client';

import { formatDistanceToNow } from 'date-fns';
import { MessageSquare, Plus, Trash2 } from 'lucide-react';

import { useArchiveEchoConversation, useEchoConversations } from '@/lib/echo/useEchoApi';
import { cn } from '@/lib/utils';

import { useEchoUi } from './EchoProvider';

export function EchoConversationList() {
  const { data, isLoading } = useEchoConversations();
  const archive = useArchiveEchoConversation();
  const ui = useEchoUi();

  const list = Array.isArray(data) ? data : [];

  return (
    <div className="p-3 space-y-2">
      <button
        type="button"
        onClick={() => { ui.startNewConversation(); }}
        className="w-full flex items-center gap-2 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50"
      >
        <Plus className="h-3.5 w-3.5" /> New conversation
      </button>

      {isLoading && (
        <div className="text-sm text-muted-foreground py-2">Loading…</div>
      )}
      {!isLoading && list.length === 0 && (
        <div className="text-sm text-muted-foreground py-2">
          No conversations yet. Ask Echo a question.
        </div>
      )}
      {list.map((c) => (
        <div
          key={c.id}
          className={cn(
            'group rounded-md border px-3 py-2 hover:bg-muted/40 cursor-pointer',
            ui.activeConversationId === c.id && 'bg-muted/60 border-violet-500/40',
          )}
          onClick={() => { ui.setActiveConversation(c.id); }}
        >
          <div className="flex items-center gap-2">
            <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
            <div className="text-sm truncate flex-1">{c.title ?? 'Untitled'}</div>
            <button
              type="button"
              aria-label="Archive"
              className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-500 transition-opacity"
              onClick={(e) => {
                e.stopPropagation();
                archive.mutate(c.id);
                if (ui.activeConversationId === c.id) ui.setActiveConversation(null);
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-2">
            {c.skill && <span className="uppercase tracking-wide">{c.skill}</span>}
            <span>{formatDistanceToNow(new Date(c.updatedAt), { addSuffix: true })}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
