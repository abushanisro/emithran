import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Observable, Subject } from 'rxjs';
import type { MessageEvent } from '@nestjs/common';

import { BASE_SYSTEM_PROMPT } from '../prompts/base-system.prompt';
import { SKILL_PROMPTS, type SkillId } from '../prompts/skills';
import { formatTurn } from '../prompts/context-formatter';
import { SKILL_TOOLS, selectSkill } from '../skills/router';
import { ECHO_TOOLS, filterToolsBySkill } from '../tools/schemas';
import {
  ToolDispatcherService,
  type ToolCallContext,
} from '../tools/tool-dispatcher.service';

import { ConversationService } from './conversation.service';
import { EntityHydratorService } from './entity-hydrator.service';

import type { ChatRequestDto } from '../dto/chat-request.dto';
import type {
  ChatEvent,
  ConversationStartedPayload,
  ContextHydratedPayload,
  MessageCompletePayload,
  SkillSelectedPayload,
  ToolCallCompletedPayload,
  ToolCallStartedPayload,
  TokenPayload,
  ErrorPayload,
} from '../dto/chat-event.dto';

/**
 * Echo's chat orchestrator.
 *
 * Flow per turn:
 *   1) Resolve/create the conversation row.
 *   2) Pick a Skill from the route.
 *   3) Hydrate the entity snapshot.
 *   4) Build the user message (page context + snapshot + DOM + question).
 *   5) Persist the user message + the snapshot.
 *   6) Loop: stream Claude → emit tokens; on tool_use, dispatch tool and feed
 *      back tool_result; repeat until stop_reason='end_turn' or budget hit.
 *   7) Persist the assistant message + emit `message_complete`.
 *
 * Streaming protocol: NestJS `Observable<MessageEvent>` produced as SSE.
 */

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const DEEP_MODEL = 'claude-sonnet-4-6';
const MAX_TOOL_CALLS = 4;
const MAX_TOKENS_OUT = 1024;
const WALL_CLOCK_MS = 60_000;
const CR_PER_TURN = 1;
const CR_PER_DEEP = 5;
const ANTHROPIC_VERSION = '2023-06-01';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

export interface ChatTurnArgs {
  body: ChatRequestDto;
  userId: string;
  accessToken: string | null;
}

@Injectable()
export class EchoService {
  private readonly logger = new Logger(EchoService.name);
  private readonly apiKey: string;

  constructor(
    private readonly config: ConfigService,
    private readonly conversations: ConversationService,
    private readonly hydrator: EntityHydratorService,
    private readonly tools: ToolDispatcherService,
  ) {
    this.apiKey =
      this.config.get<string>('ANTHROPIC_API_KEY') ?? process.env.ANTHROPIC_API_KEY ?? '';
    if (!this.apiKey) {
      this.logger.warn('ANTHROPIC_API_KEY is not configured — Echo chat will return an error.');
    }
  }

  /** SSE entrypoint. Returns a hot Observable that pushes one MessageEvent per ChatEvent. */
  chatStream(args: ChatTurnArgs): Observable<MessageEvent> {
    const subject = new Subject<MessageEvent>();
    // Run async; do not await — we need to return the Observable immediately.
    this.run(args, subject).catch((e) => {
      this.logger.error(`chat run failed: ${e?.stack ?? e?.message ?? e}`);
      emit(subject, 'error', { message: 'Internal error', recoverable: false } satisfies ErrorPayload);
      subject.complete();
    });
    return subject.asObservable();
  }

  private async run(args: ChatTurnArgs, subject: Subject<MessageEvent>) {
    const startedAt = Date.now();
    const { body, userId, accessToken } = args;

    if (!this.apiKey) {
      emit(subject, 'error', {
        message: 'ANTHROPIC_API_KEY not configured on the server.',
        recoverable: false,
      } satisfies ErrorPayload);
      subject.complete();
      return;
    }

    // ── 1) Resolve conversation ─────────────────────────────────────────────
    let conversationId = body.conversationId;
    if (!conversationId) {
      const created = await this.conversations.createConversation({
        ownerId: userId,
        accessToken,
        title: deriveTitle(body.message),
      });
      conversationId = created.id;
    }

    // ── 2) Skill router ─────────────────────────────────────────────────────
    const { skill } = selectSkill(body.pageContext.route);
    const model = body.deep ? DEEP_MODEL : DEFAULT_MODEL;
    emit(subject, 'skill_selected', { skill, model } satisfies SkillSelectedPayload);

    // ── 3) Hydrate entity snapshot ──────────────────────────────────────────
    const snapshot = await this.hydrator.hydrate(
      body.pageContext.entityType,
      body.pageContext.entityId,
      accessToken,
    );
    emit(subject, 'context_hydrated', {
      entityType: snapshot?.entityType,
      entityId: snapshot?.entityId,
      summary: snapshot
        ? `${snapshot.entityType} ${snapshot.entityId} hydrated`
        : 'no entity snapshot',
    } satisfies ContextHydratedPayload);

    // ── 4) Build user turn content ──────────────────────────────────────────
    const userContent = formatTurn({
      pageContext: body.pageContext,
      snapshot,
      domSnippet: body.domSnippet,
      userMessage: body.message,
    });

    // ── 5) Persist user message + context snapshot ──────────────────────────
    const userMsg = await this.conversations.createMessage(
      {
        conversationId,
        ownerId: userId,
        role: 'user',
        content: body.message, // store the raw question, not the formatted block
        skill,
        pageRoute: body.pageContext.route,
        entityType: body.pageContext.entityType,
        entityId: body.pageContext.entityId,
      },
      accessToken,
    );

    if (snapshot) {
      await this.conversations.saveContextSnapshot({
        ownerId: userId,
        accessToken,
        conversationId,
        messageId: userMsg.id,
        route: body.pageContext.route,
        entityType: snapshot.entityType,
        entityId: snapshot.entityId,
        contextJson: snapshot.data,
      });
    }

    emit(subject, 'conversation_started', {
      conversationId,
      messageId: userMsg.id,
    } satisfies ConversationStartedPayload);

    // ── 6) Build Anthropic input ────────────────────────────────────────────
    const systemBlocks = [
      { type: 'text', text: BASE_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: SKILL_PROMPTS[skill] },
    ];

    const history = await this.conversations.recentMessages({
      conversationId,
      ownerId: userId,
      accessToken,
      limit: 8,
    });

    // Strip the message we just inserted (last one with role=user) so it does
    // not duplicate. We rebuild the final user turn from formatted content.
    const historyMsgs = history.slice(0, -1).map((m) => ({
      role: m.role === 'tool' ? 'user' : m.role,
      content: m.content,
    }));

    const messages: any[] = [...historyMsgs, { role: 'user', content: userContent }];

    const allowedTools = SKILL_TOOLS[skill as SkillId] ?? [];
    const tools = allowedTools.length > 0 ? filterToolsBySkill(allowedTools) : ECHO_TOOLS;

    // ── 7) Tool-use streaming loop ──────────────────────────────────────────
    const ctx: ToolCallContext = { userId, accessToken };
    const aggregated: {
      text: string;
      tokensIn: number;
      tokensOut: number;
      cacheRead: number;
      cacheCreate: number;
      toolCallLog: Array<Record<string, unknown>>;
    } = { text: '', tokensIn: 0, tokensOut: 0, cacheRead: 0, cacheCreate: 0, toolCallLog: [] };

    let toolCallsUsed = 0;
    let stopReason: string = 'end_turn';

    for (let step = 0; step < MAX_TOOL_CALLS + 1; step += 1) {
      if (Date.now() - startedAt > WALL_CLOCK_MS) {
        emit(subject, 'error', {
          message: `Wall-clock exceeded ${WALL_CLOCK_MS}ms.`,
          recoverable: false,
        } satisfies ErrorPayload);
        break;
      }

      const stream = await this.streamMessage({
        model,
        systemBlocks,
        tools,
        messages,
        emitToken: (delta) => emit(subject, 'token', { delta } satisfies TokenPayload),
      });
      aggregated.text += stream.text;
      aggregated.tokensIn += stream.usage.input_tokens ?? 0;
      aggregated.tokensOut += stream.usage.output_tokens ?? 0;
      aggregated.cacheRead += stream.usage.cache_read_input_tokens ?? 0;
      aggregated.cacheCreate += stream.usage.cache_creation_input_tokens ?? 0;
      stopReason = stream.stopReason;

      if (stream.stopReason !== 'tool_use') break;
      if (toolCallsUsed >= MAX_TOOL_CALLS) {
        emit(subject, 'error', {
          message: `Tool-call cap (${MAX_TOOL_CALLS}) reached.`,
          recoverable: false,
        } satisfies ErrorPayload);
        break;
      }

      // Add assistant turn (full content blocks) to history
      messages.push({ role: 'assistant', content: stream.content });

      const toolResults: any[] = [];
      for (const block of stream.content) {
        if (block.type !== 'tool_use') continue;
        toolCallsUsed += 1;
        const idx = toolCallsUsed;
        emit(subject, 'tool_call_started', {
          index: idx,
          name: block.name,
          input: block.input ?? {},
        } satisfies ToolCallStartedPayload);

        const callStart = Date.now();
        const result = await this.tools.dispatch(block.name, block.input ?? {}, ctx);
        const durationMs = Date.now() - callStart;

        emit(subject, 'tool_call_completed', {
          index: idx,
          name: block.name,
          durationMs,
          resultPreview: result.preview,
          isError: !result.ok,
        } satisfies ToolCallCompletedPayload);

        aggregated.toolCallLog.push({
          index: idx,
          name: block.name,
          input: block.input,
          ok: result.ok,
          durationMs,
          preview: result.preview,
        });

        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          is_error: !result.ok,
          content: JSON.stringify(result.ok ? result.data : { error: result.error }),
        });
      }
      messages.push({ role: 'user', content: toolResults });
    }

    // ── 8) Persist assistant message + emit completion ──────────────────────
    const durationMs = Date.now() - startedAt;
    const creditsCharged = body.deep ? CR_PER_DEEP : CR_PER_TURN;

    const assistantMsg = await this.conversations.createMessage(
      {
        conversationId,
        ownerId: userId,
        role: 'assistant',
        content: aggregated.text.trim() || '[Echo returned no text]',
        toolCalls: aggregated.toolCallLog.length ? aggregated.toolCallLog : null,
        skill,
        pageRoute: body.pageContext.route,
        entityType: body.pageContext.entityType,
        entityId: body.pageContext.entityId,
        model,
        tokensIn: aggregated.tokensIn,
        tokensOut: aggregated.tokensOut,
        cacheReadTokens: aggregated.cacheRead,
        cacheCreationTokens: aggregated.cacheCreate,
        durationMs,
        creditsCharged,
      },
      accessToken,
    );

    emit(subject, 'message_complete', {
      conversationId,
      assistantMessageId: assistantMsg.id,
      tokensIn: aggregated.tokensIn,
      tokensOut: aggregated.tokensOut,
      cacheReadTokens: aggregated.cacheRead,
      durationMs,
      creditsCharged,
    } satisfies MessageCompletePayload);
    this.logger.log(
      `chat: skill=${skill} model=${model} tools=${aggregated.toolCallLog.length} in=${aggregated.tokensIn} out=${aggregated.tokensOut} cache=${aggregated.cacheRead} dur=${durationMs}ms stop=${stopReason}`,
    );
    subject.complete();
  }

  // ── Anthropic streaming wrapper ───────────────────────────────────────────

  private async streamMessage(args: {
    model: string;
    systemBlocks: any[];
    tools: any[];
    messages: any[];
    emitToken: (delta: string) => void;
  }): Promise<{
    text: string;
    content: any[];
    stopReason: string;
    usage: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  }> {
    const resp = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: args.model,
        max_tokens: MAX_TOKENS_OUT,
        temperature: 0.3,
        system: args.systemBlocks,
        tools: args.tools,
        tool_choice: { type: 'auto' },
        messages: args.messages,
        stream: true,
      }),
    });

    if (!resp.ok || !resp.body) {
      const errText = await resp.text();
      throw new Error(`Anthropic API ${resp.status}: ${errText.slice(0, 400)}`);
    }

    // Accumulate streaming events into structured content blocks.
    const blocks: any[] = [];
    let stopReason = 'end_turn';
    const usage: any = {};
    let textOut = '';

    const reader = resp.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let eolIdx: number;
      while ((eolIdx = buffer.indexOf('\n\n')) !== -1) {
        const rawEvent = buffer.slice(0, eolIdx);
        buffer = buffer.slice(eolIdx + 2);
        const dataLine = rawEvent.split('\n').find((l) => l.startsWith('data: '));
        if (!dataLine) continue;
        const dataStr = dataLine.slice(6);
        let parsed: any;
        try {
          parsed = JSON.parse(dataStr);
        } catch {
          continue;
        }
        switch (parsed.type) {
          case 'message_start':
            Object.assign(usage, parsed.message?.usage ?? {});
            break;
          case 'content_block_start':
            blocks[parsed.index] = { ...parsed.content_block };
            if (blocks[parsed.index].type === 'tool_use') {
              blocks[parsed.index].input = blocks[parsed.index].input ?? '';
            }
            break;
          case 'content_block_delta': {
            const cur = blocks[parsed.index] ?? {};
            const delta = parsed.delta ?? {};
            if (delta.type === 'text_delta') {
              cur.text = (cur.text ?? '') + delta.text;
              textOut += delta.text;
              args.emitToken(delta.text);
            } else if (delta.type === 'input_json_delta') {
              cur.input = (typeof cur.input === 'string' ? cur.input : '') + delta.partial_json;
            }
            blocks[parsed.index] = cur;
            break;
          }
          case 'content_block_stop': {
            const cur = blocks[parsed.index];
            if (cur?.type === 'tool_use' && typeof cur.input === 'string') {
              try {
                cur.input = cur.input ? JSON.parse(cur.input) : {};
              } catch {
                cur.input = {};
              }
            }
            break;
          }
          case 'message_delta':
            if (parsed.delta?.stop_reason) stopReason = parsed.delta.stop_reason;
            if (parsed.usage) Object.assign(usage, parsed.usage);
            break;
          case 'message_stop':
            break;
          default:
            break;
        }
      }
    }

    return { text: textOut, content: blocks.filter(Boolean), stopReason, usage };
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────

function emit<T>(subject: Subject<MessageEvent>, type: string, data: T): void {
  const ev: ChatEvent<T> = { type: type as any, data };
  subject.next({ data: JSON.stringify(ev) });
}

function deriveTitle(message: string): string {
  const trimmed = message.replace(/\s+/g, ' ').trim();
  if (trimmed.length <= 60) return trimmed;
  return trimmed.slice(0, 60).replace(/\s+\S*$/, '') + '…';
}
