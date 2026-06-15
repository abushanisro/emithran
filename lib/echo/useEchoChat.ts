'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { supabase } from '@/lib/supabase/client';

import { getEchoBaseUrl } from './config';
import { extractEchoDomSnippet } from './domSnippet';

import type {
  EchoChatEvent,
  EchoChatMessage,
  EchoPageContext,
  EchoToolCall,
} from './types';

/**
 * Streaming chat hook.
 *
 * Sends a POST to /api/echo/chat with the user's question + page context. The
 * server responds with `text/event-stream`; we parse SSE frames manually
 * because EventSource doesn't support POST.
 *
 * The hook keeps an in-memory transcript that mirrors what's persisted on
 * the backend, so the panel UI can render immediately without an extra read.
 */
export interface UseEchoChatOptions {
  conversationId?: string | undefined;
  pageContext: EchoPageContext;
  onComplete?: ((data: { conversationId: string; assistantMessageId: string }) => void) | undefined;
}

export interface UseEchoChat {
  conversationId: string | undefined;
  messages: EchoChatMessage[];
  isStreaming: boolean;
  error: string | null;
  send: (text: string, opts?: { attachDom?: boolean; deep?: boolean }) => Promise<void>;
  reset: () => void;
  setInitialMessages: (msgs: EchoChatMessage[]) => void;
}

export function useEchoChat(opts: UseEchoChatOptions): UseEchoChat {
  const [conversationId, setConversationId] = useState<string | undefined>(opts.conversationId);
  const [messages, setMessages] = useState<EchoChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  // Track the streaming assistant message so we can append tokens efficiently.
  const streamingIdRef = useRef<string | null>(null);

  // Sync external conversationId changes (loading a different conversation).
  useEffect(() => {
    setConversationId(opts.conversationId);
  }, [opts.conversationId]);

  const setInitialMessages = useCallback((msgs: EchoChatMessage[]) => {
    setMessages(msgs);
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    streamingIdRef.current = null;
    setMessages([]);
    setError(null);
    setIsStreaming(false);
    setConversationId(undefined);
  }, []);

  const send = useCallback(
    async (text: string, sendOpts?: { attachDom?: boolean; deep?: boolean }) => {
      const trimmed = text.trim();
      if (!trimmed || isStreaming) return;

      setError(null);
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const now = Date.now();
      const optimisticUser: EchoChatMessage = {
        id: `pending-user-${String(now)}`,
        role: 'user',
        content: trimmed,
        createdAt: new Date().toISOString(),
      };
      const placeholderAssistantId = `pending-assistant-${String(now)}`;
      streamingIdRef.current = placeholderAssistantId;
      const placeholderAssistant: EchoChatMessage = {
        id: placeholderAssistantId,
        role: 'assistant',
        content: '',
        toolCalls: [],
        createdAt: new Date().toISOString(),
        streaming: true,
      };
      setMessages((prev) => [...prev, optimisticUser, placeholderAssistant]);
      setIsStreaming(true);

      // Auth header — Supabase JWT
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token ?? '';

      const body = {
        conversationId,
        message: trimmed,
        pageContext: opts.pageContext,
        domSnippet: sendOpts?.attachDom
          ? extractEchoDomSnippet()
            ? { text: extractEchoDomSnippet() ?? '' }
            : undefined
          : undefined,
        deep: sendOpts?.deep ?? false,
      };

      let resp: Response;
      try {
        resp = await fetch(`${getEchoBaseUrl()}/chat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: token ? `Bearer ${token}` : '',
            Accept: 'text/event-stream',
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (e: unknown) {
        finalizeError(errorMessage(e, 'Network error'));
        return;
      }

      if (!resp.ok || !resp.body) {
        const text = await resp.text().catch(() => '');
        finalizeError(`Echo ${String(resp.status)}: ${text.slice(0, 200) || resp.statusText}`);
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let split: number;
          while ((split = buffer.indexOf('\n\n')) !== -1) {
            const frame = buffer.slice(0, split);
            buffer = buffer.slice(split + 2);
            const dataLine = frame
              .split('\n')
              .find((l) => l.startsWith('data: '));
            if (!dataLine) continue;
            const raw = dataLine.slice(6);
            if (raw.startsWith(':')) continue;
            let parsed: EchoChatEvent | null = null;
            try { parsed = JSON.parse(raw) as EchoChatEvent; } catch { continue; }
            handleEvent(parsed);
          }
        }
      } catch (e: unknown) {
        if (controller.signal.aborted) {
          finalizeDone();
          return;
        }
        finalizeError(errorMessage(e, 'Stream read failed'));
        return;
      }
      finalizeDone();

      function handleEvent(ev: EchoChatEvent) {
        switch (ev.type) {
          case 'conversation_started':
            setConversationId(ev.data.conversationId);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === optimisticUser.id ? { ...m, id: ev.data.messageId } : m,
              ),
            );
            break;
          case 'skill_selected':
            setMessages((prev) =>
              prev.map((m) =>
                m.id === streamingIdRef.current ? { ...m, skill: ev.data.skill } : m,
              ),
            );
            break;
          case 'token':
            setMessages((prev) =>
              prev.map((m) =>
                m.id === streamingIdRef.current
                  ? { ...m, content: m.content + ev.data.delta }
                  : m,
              ),
            );
            break;
          case 'tool_call_started': {
            const call: EchoToolCall = {
              index: ev.data.index,
              name: ev.data.name,
              input: ev.data.input,
              pending: true,
            };
            setMessages((prev) =>
              prev.map((m) =>
                m.id === streamingIdRef.current
                  ? { ...m, toolCalls: [...(m.toolCalls ?? []), call] }
                  : m,
              ),
            );
            break;
          }
          case 'tool_call_completed':
            setMessages((prev) =>
              prev.map((m) =>
                m.id === streamingIdRef.current
                  ? {
                      ...m,
                      toolCalls: (m.toolCalls ?? []).map((c) =>
                        c.index === ev.data.index
                          ? {
                              ...c,
                              pending: false,
                              durationMs: ev.data.durationMs,
                              resultPreview: ev.data.resultPreview,
                              isError: ev.data.isError,
                            }
                          : c,
                      ),
                    }
                  : m,
              ),
            );
            break;
          case 'message_complete':
            setMessages((prev) =>
              prev.map((m) =>
                m.id === streamingIdRef.current
                  ? { ...m, id: ev.data.assistantMessageId, streaming: false }
                  : m,
              ),
            );
            opts.onComplete?.({
              conversationId: ev.data.conversationId,
              assistantMessageId: ev.data.assistantMessageId,
            });
            break;
          case 'error':
            finalizeError(ev.data.message);
            break;
          default:
            break;
        }
      }

      function finalizeError(msg: string) {
        setError(msg);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === streamingIdRef.current
              ? { ...m, streaming: false, content: m.content || `[error: ${msg}]` }
              : m,
          ),
        );
        setIsStreaming(false);
        streamingIdRef.current = null;
        abortRef.current = null;
      }

      function finalizeDone() {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === streamingIdRef.current ? { ...m, streaming: false } : m,
          ),
        );
        setIsStreaming(false);
        streamingIdRef.current = null;
        abortRef.current = null;
      }
    },
    [conversationId, isStreaming, opts],
  );

  // Tear down on unmount.
  useEffect(() => () => { abortRef.current?.abort(); }, []);

  return {
    conversationId,
    messages,
    isStreaming,
    error,
    send,
    reset,
    setInitialMessages,
  };
}

function errorMessage(e: unknown, fallback: string): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  return fallback;
}
