'use client';

/**
 * Thin react-query hooks for Echo REST endpoints that aren't part of the
 * SSE chat stream: alerts, suggestions, conversation history, hints.
 *
 * Auth flows through the user's Supabase session — same pattern as the rest
 * of the platform. Errors propagate as react-query errors so the panel can
 * render `error.message` directly.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { supabase } from '@/lib/supabase/client';

import { getEchoBaseUrl } from './config';

import type {
  EchoAlert,
  EchoConversationMessage,
  EchoConversationSummary,
  EchoHint,
  EchoSuggestion,
} from './types';

// ── HTTP plumbing ─────────────────────────────────────────────────────────

async function authFetch(path: string, init?: RequestInit): Promise<Response> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? '';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: token ? `Bearer ${token}` : '',
  };
  if (init?.headers) {
    Object.assign(headers, init.headers as Record<string, string>);
  }
  return fetch(`${getEchoBaseUrl()}${path}`, { ...init, headers });
}

/**
 * Backend wraps every response in `{ success, data, metadata }` via
 * `TransformInterceptor` (backend/src/common/interceptors/transform.interceptor.ts).
 * We unwrap `data` here so callers see the actual payload shape.
 */
interface WrappedResponse<T> {
  success?: boolean;
  data?: T;
  message?: string;
  metadata?: unknown;
}

async function authJson<T>(path: string, init?: RequestInit): Promise<T> {
  const resp = await authFetch(path, init);
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Echo API ${String(resp.status)}: ${text.slice(0, 200) || resp.statusText}`);
  }
  if (resp.status === 204) return undefined as unknown as T;
  const body = (await resp.json()) as WrappedResponse<T> | T;
  // Heuristic: if the body looks like a wrapper, return its `.data`.
  if (
    body &&
    typeof body === 'object' &&
    !Array.isArray(body) &&
    'success' in (body as Record<string, unknown>) &&
    'data' in (body as Record<string, unknown>)
  ) {
    return (body as WrappedResponse<T>).data as T;
  }
  return body as T;
}

// ── Alerts ────────────────────────────────────────────────────────────────

export function useEchoAlerts(args?: { refreshIntervalMs?: number; enabled?: boolean }) {
  const enabled = args?.enabled !== false;
  const query = useQuery({
    queryKey: ['echo', 'alerts'],
    enabled,
    refetchInterval: args?.refreshIntervalMs ?? 60_000,
    queryFn: () => authJson<EchoAlert[]>(`/alerts?refresh=1`),
  });
  return query;
}

export function useDismissEchoAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (alertId: string) =>
      authJson<undefined>(`/alerts/${alertId}/dismiss`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['echo', 'alerts'] }),
  });
}

// ── Suggestions ───────────────────────────────────────────────────────────

export function useEchoSuggestions(
  args: { route: string; entityType?: string | undefined; entityId?: string | undefined } | string,
  enabled = true,
) {
  // Accept either a string (legacy) or { route, entityType, entityId } so callers
  // can drive entity-specific nudges without a breaking API change.
  const route = typeof args === 'string' ? args : args.route;
  const entityType = typeof args === 'string' ? undefined : args.entityType;
  const entityId = typeof args === 'string' ? undefined : args.entityId;

  const qs = new URLSearchParams({ route });
  if (entityType) qs.set('entityType', entityType);
  if (entityId) qs.set('entityId', entityId);

  return useQuery({
    queryKey: ['echo', 'suggestions', route, entityType ?? '', entityId ?? ''],
    enabled: enabled && !!route,
    queryFn: () => authJson<EchoSuggestion[]>(`/suggestions?${qs.toString()}`),
    staleTime: 30_000,
  });
}

export function useDismissEchoSuggestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { route: string; suggestionId: string }) =>
      authJson<undefined>(`/suggestions/dismiss`, {
        method: 'POST',
        body: JSON.stringify(vars),
      }),
    onSuccess: (_void, vars) =>
      qc.invalidateQueries({ queryKey: ['echo', 'suggestions', vars.route] }),
  });
}

// ── Conversations ─────────────────────────────────────────────────────────

export function useEchoConversations(enabled = true) {
  return useQuery({
    queryKey: ['echo', 'conversations'],
    enabled,
    queryFn: () => authJson<EchoConversationSummary[]>(`/conversations`),
    staleTime: 15_000,
  });
}

export interface EchoConversationDetail extends EchoConversationSummary {
  messages: EchoConversationMessage[];
}

export function useEchoConversation(id: string | null) {
  return useQuery({
    queryKey: ['echo', 'conversation', id],
    enabled: !!id,
    queryFn: () => authJson<EchoConversationDetail>(`/conversations/${id ?? ''}`),
  });
}

export function useArchiveEchoConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      authJson<undefined>(`/conversations/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['echo', 'conversations'] }),
  });
}

// ── Hints ─────────────────────────────────────────────────────────────────

export function useEchoHint(route: string, topicId: string | null) {
  return useQuery({
    queryKey: ['echo', 'hint', route, topicId],
    enabled: !!route && !!topicId,
    queryFn: () =>
      authJson<EchoHint>(
        `/hints?route=${encodeURIComponent(route)}&topic=${encodeURIComponent(topicId ?? '')}`,
      ),
  });
}
