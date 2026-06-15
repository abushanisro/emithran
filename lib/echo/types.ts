/**
 * Shared types for the Echo frontend layer. Mirrors backend DTOs in
 * `backend/src/modules/echo/dto/`.
 *
 * Keep this file framework-free — no React imports — so it can be consumed
 * from hooks, components, and server actions alike.
 */

export type EchoEntityType =
  | 'project'
  | 'bom'
  | 'bom_item'
  | 'rfq'
  | 'lot'
  | 'vendor'
  | 'process_plan';

export interface EchoPageContext {
  route: string;
  entityType?: EchoEntityType | undefined;
  entityId?: string | undefined;
  breadcrumbs?: string[] | undefined;
}

export interface EchoSuggestion {
  id: string;
  title: string;
  body: string;
  ctaRoute?: string | undefined;
  ctaLabel?: string | undefined;
  source: 'static' | 'dynamic';
}

export type EchoAlertSeverity = 'info' | 'warn' | 'urgent';

export type EchoAlertKind =
  | 'rfq_pending'
  | 'cost_spike'
  | 'stale_lot'
  | 'missing_plan'
  | 'cost_outlier'
  | 'missing_drawing';

export interface EchoAlert {
  id: string;
  kind: EchoAlertKind;
  severity: EchoAlertSeverity;
  title: string;
  body?: string | undefined;
  linkRoute?: string | undefined;
  nextAction?: string | undefined;
  sourceEntityType?: string | undefined;
  sourceEntityId?: string | undefined;
  createdAt: string;
}

export interface EchoConversationSummary {
  id: string;
  title?: string | undefined;
  skill?: string | undefined;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface EchoConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCalls?: unknown;
  skill?: string | undefined;
  pageRoute?: string | undefined;
  tokensIn: number;
  tokensOut: number;
  createdAt: string;
}

export interface EchoHint {
  id: string;
  routeGlob: string;
  topicId: string;
  title: string;
  contentMd: string;
  tags: string[];
}

// ── Streaming event union (mirrors backend chat-event.dto.ts) ──────────────

export type EchoChatEvent =
  | { type: 'conversation_started'; data: { conversationId: string; messageId: string } }
  | { type: 'skill_selected'; data: { skill: string; model: string } }
  | { type: 'context_hydrated'; data: { entityType?: string; entityId?: string; summary: string } }
  | { type: 'token'; data: { delta: string } }
  | {
      type: 'tool_call_started';
      data: { index: number; name: string; input: Record<string, unknown> };
    }
  | {
      type: 'tool_call_completed';
      data: {
        index: number;
        name: string;
        durationMs: number;
        resultPreview: string;
        isError?: boolean;
      };
    }
  | {
      type: 'message_complete';
      data: {
        conversationId: string;
        assistantMessageId: string;
        tokensIn: number;
        tokensOut: number;
        cacheReadTokens: number;
        durationMs: number;
        creditsCharged: number;
      };
    }
  | { type: 'error'; data: { message: string; recoverable: boolean } };

// ── In-memory render shape for the chat UI ────────────────────────────────

export interface EchoToolCall {
  index: number;
  name: string;
  input: Record<string, unknown>;
  durationMs?: number | undefined;
  resultPreview?: string | undefined;
  isError?: boolean | undefined;
  pending: boolean;
}

export interface EchoChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: EchoToolCall[] | undefined;
  skill?: string | undefined;
  createdAt: string;
  streaming?: boolean | undefined;
}
