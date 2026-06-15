/**
 * SSE event shapes streamed from POST /api/echo/chat.
 *
 * Each `data:` line emitted to the client is a JSON-serialised one of these.
 * The frontend's `useEchoChat` discriminates on `type` to update the UI.
 */

export type ChatEventType =
  | 'conversation_started'
  | 'skill_selected'
  | 'context_hydrated'
  | 'token'
  | 'tool_call_started'
  | 'tool_call_completed'
  | 'message_complete'
  | 'error';

export interface ChatEvent<T = unknown> {
  type: ChatEventType;
  data: T;
}

// ── Discriminated payloads ────────────────────────────────────────────────

export interface ConversationStartedPayload {
  conversationId: string;
  messageId: string;
}

export interface SkillSelectedPayload {
  skill: string;
  model: string;
}

export interface ContextHydratedPayload {
  entityType?: string;
  entityId?: string;
  /** Brief summary of what was injected — never the raw snapshot. */
  summary: string;
}

export interface TokenPayload {
  delta: string;
}

export interface ToolCallStartedPayload {
  index: number;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolCallCompletedPayload {
  index: number;
  name: string;
  durationMs: number;
  /** Trimmed result preview — full result is persisted server-side. */
  resultPreview: string;
  isError?: boolean;
}

export interface MessageCompletePayload {
  conversationId: string;
  assistantMessageId: string;
  tokensIn: number;
  tokensOut: number;
  cacheReadTokens: number;
  durationMs: number;
  creditsCharged: number;
}

export interface ErrorPayload {
  message: string;
  recoverable: boolean;
}
