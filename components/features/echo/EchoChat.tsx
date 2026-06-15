'use client';

import { Loader2, Paperclip, Send, Sparkles, ZapOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { useEchoPageContext } from '@/lib/echo/PageContextProvider';
import type { EchoChatMessage } from '@/lib/echo/types';
import { useQueryClient } from '@tanstack/react-query';

import { useEchoConversation, useEchoHint } from '@/lib/echo/useEchoApi';
import { useEchoChat } from '@/lib/echo/useEchoChat';
import { cn } from '@/lib/utils';

import { EchoMessage } from './EchoMessage';
import { useEchoUi } from './EchoProvider';
import { EchoSuggestionBanner } from './EchoSuggestionBanner';

export function EchoChat() {
  const ui = useEchoUi();
  const pageContext = useEchoPageContext();
  const qc = useQueryClient();

  // If a previous conversation is selected, load + hydrate its history.
  const { data: existing } = useEchoConversation(ui.activeConversationId);

  const chat = useEchoChat({
    conversationId: ui.activeConversationId ?? undefined,
    pageContext,
    onComplete: ({ conversationId }) => {
      if (!ui.activeConversationId) ui.setActiveConversation(conversationId);
      qc.invalidateQueries({ queryKey: ['echo', 'conversations'] });
    },
  });

  // When a different conversation is selected, push its history into the hook.
  // `existing.messages` is typed as required but can arrive missing on partial
  // responses — guard with Array.isArray rather than crashing the panel.
  useEffect(() => {
    if (!existing) return;
    const msgs = Array.isArray(existing.messages) ? existing.messages : [];
    const initial: EchoChatMessage[] = msgs
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({
        id: m.id,
        role: m.role as 'user' | 'assistant',
        content: m.content,
        skill: m.skill,
        createdAt: m.createdAt,
      }));
    chat.setInitialMessages(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing?.id]);

  // Pre-fill input from a pending hint topic if the user clicked an EchoHintButton.
  const pendingTopic = ui.pendingTopicId;
  const { data: pendingHint } = useEchoHint(pageContext.route, pendingTopic);
  const [input, setInput] = useState('');
  const [attachDom, setAttachDom] = useState(false);
  const [deep, setDeep] = useState(false);
  useEffect(() => {
    if (pendingHint?.title) {
      setInput(`Tell me about: ${pendingHint.title}`);
      ui.consumePendingTopic();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingHint?.id]);

  const scrollerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [chat.messages]);

  const submit = async () => {
    if (!input.trim() || chat.isStreaming) return;
    const text = input;
    setInput('');
    await chat.send(text, { attachDom, deep });
  };
  const handleFormSubmit = (e: React.SyntheticEvent) => {
    e.preventDefault();
    void submit();
  };

  return (
    <div className="flex flex-col h-full">
      {/* Suggestion banner */}
      <EchoSuggestionBanner route={pageContext.route} onPickPrompt={setInput} />

      {/* Messages */}
      <div ref={scrollerRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {chat.messages.length === 0 && (
          <div className="text-sm text-muted-foreground text-center py-8 px-2 leading-relaxed">
            <Sparkles className="h-5 w-5 mx-auto mb-2 opacity-50" />
            Hi — I'm Echo. Ask me about the part you're looking at, why a cost
            is high, which supplier to pick, or what to do next.
          </div>
        )}
        {chat.messages.map((m) => (
          <EchoMessage key={m.id} message={m} />
        ))}
        {chat.error && (
          <div className="text-xs text-red-500 px-2">{chat.error}</div>
        )}
      </div>

      {/* Composer */}
      <form
        onSubmit={handleFormSubmit}
        className="border-t border-border bg-background/80 backdrop-blur p-3"
      >
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => { setInput(e.target.value); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder={
              chat.isStreaming ? 'Echo is thinking…' : 'Ask Echo anything…'
            }
            rows={1}
            maxLength={4000}
            disabled={chat.isStreaming}
            className="flex-1 resize-none rounded-md border border-border bg-background px-3 py-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-violet-500/40 disabled:opacity-60 max-h-32"
          />
          <button
            type="submit"
            aria-label="Send"
            disabled={!input.trim() || chat.isStreaming}
            className={cn(
              'h-9 w-9 rounded-md flex items-center justify-center text-white',
              'bg-gradient-to-br from-indigo-500 via-fuchsia-500 to-violet-600',
              'disabled:opacity-50 disabled:cursor-not-allowed',
            )}
          >
            {chat.isStreaming ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </button>
        </div>
        <div className="flex items-center gap-3 mt-1.5 text-[11px] text-muted-foreground">
          <button
            type="button"
            onClick={() => { setAttachDom((v) => !v); }}
            className={cn(
              'inline-flex items-center gap-1 hover:text-foreground transition-colors',
              attachDom && 'text-violet-600 dark:text-violet-300',
            )}
            title="Attach a snapshot of what's visible on screen"
          >
            <Paperclip className="h-3 w-3" />
            {attachDom ? 'Attaching what you see' : 'Attach what you see'}
          </button>
          <button
            type="button"
            onClick={() => { setDeep((v) => !v); }}
            className={cn(
              'inline-flex items-center gap-1 hover:text-foreground transition-colors',
              deep && 'text-violet-600 dark:text-violet-300',
            )}
            title="Use the deep model (Sonnet) — slower, more thorough"
          >
            {deep ? (
              <Sparkles className="h-3 w-3" />
            ) : (
              <ZapOff className="h-3 w-3" />
            )}
            {deep ? 'Deep (5 credits)' : 'Fast (1 credit)'}
          </button>
          <span className="ml-auto tabular-nums">{input.length}/4000</span>
        </div>
      </form>
    </div>
  );
}
