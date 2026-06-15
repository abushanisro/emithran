'use client';

import { Lightbulb, X } from 'lucide-react';

import { useEchoPageContext } from '@/lib/echo/PageContextProvider';
import { useEchoSuggestions, useDismissEchoSuggestion } from '@/lib/echo/useEchoApi';

export function EchoSuggestionBanner({
  route,
  onPickPrompt,
}: {
  route: string;
  onPickPrompt: (text: string) => void;
}) {
  const ctx = useEchoPageContext();
  const { data: suggestions } = useEchoSuggestions(
    { route, entityType: ctx.entityType, entityId: ctx.entityId },
    !!route,
  );
  const dismiss = useDismissEchoSuggestion();

  const list = Array.isArray(suggestions) ? suggestions : [];
  if (list.length === 0) return null;
  const top = list[0];
  if (!top) return null;

  return (
    <div className="mx-3 mt-3 mb-1 rounded-md border border-violet-500/30 bg-violet-500/5 px-3 py-2 text-xs">
      <div className="flex items-center gap-1.5 mb-1">
        <Lightbulb className="h-3 w-3 text-violet-500" />
        <span className="font-semibold text-violet-600 dark:text-violet-300 uppercase tracking-wide">
          Smart suggestion
        </span>
        <button
          type="button"
          aria-label="Dismiss"
          onClick={() => { dismiss.mutate({ route, suggestionId: top.id }); }}
          className="ml-auto text-muted-foreground hover:text-foreground"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      <div className="text-foreground font-medium leading-snug">{top.title}</div>
      <div className="text-muted-foreground mt-0.5 leading-relaxed">{top.body}</div>
      <button
        type="button"
        className="mt-1.5 text-violet-600 dark:text-violet-300 underline-offset-2 hover:underline font-medium"
        onClick={() => { onPickPrompt(top.title); }}
      >
        {top.ctaLabel ?? 'Ask Echo'}
      </button>
    </div>
  );
}
