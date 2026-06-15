import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';

import type {
  ConversationDetailDto,
  ConversationMessageDto,
  ConversationSummaryDto,
} from '../dto/conversation.dto';

interface CreateMessageArgs {
  conversationId: string;
  ownerId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCalls?: unknown;
  skill?: string;
  pageRoute?: string;
  entityType?: string;
  entityId?: string;
  model?: string;
  tokensIn?: number;
  tokensOut?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  durationMs?: number;
  creditsCharged?: number;
}

/**
 * Thin persistence layer for echo_conversations + echo_messages + snapshots.
 * Every write goes through the user-token Supabase client so RLS is enforced.
 */
@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async createConversation(args: {
    ownerId: string;
    accessToken: string | null;
    title?: string;
    skill?: string;
  }): Promise<{ id: string }> {
    const client = this.supabase.getClient(args.accessToken ?? undefined);
    const { data, error } = await client
      .from('echo_conversations')
      .insert({
        owner_id: args.ownerId,
        title: args.title?.slice(0, 280) ?? null,
        skill: args.skill ?? null,
      })
      .select('id')
      .single();
    if (error) throw new Error(`createConversation: ${error.message}`);
    return { id: data.id };
  }

  async listConversations(args: {
    ownerId: string;
    accessToken: string | null;
    limit?: number;
  }): Promise<ConversationSummaryDto[]> {
    const client = this.supabase.getClient(args.accessToken ?? undefined);
    const { data, error } = await client
      .from('echo_conversations')
      .select('id, title, skill, pinned, created_at, updated_at')
      .is('archived_at', null)
      .eq('owner_id', args.ownerId)
      .order('updated_at', { ascending: false })
      .limit(Math.min(50, args.limit ?? 25));
    if (error) throw new Error(`listConversations: ${error.message}`);
    return (data ?? []).map(this.toSummary);
  }

  async getConversation(args: {
    conversationId: string;
    ownerId: string;
    accessToken: string | null;
  }): Promise<ConversationDetailDto> {
    const client = this.supabase.getClient(args.accessToken ?? undefined);
    const { data: conv, error: convErr } = await client
      .from('echo_conversations')
      .select('id, title, skill, pinned, created_at, updated_at')
      .eq('id', args.conversationId)
      .eq('owner_id', args.ownerId)
      .maybeSingle();
    if (convErr) throw new Error(`getConversation: ${convErr.message}`);
    if (!conv) throw new NotFoundException(`Conversation ${args.conversationId} not found`);

    const { data: msgs, error: msgsErr } = await client
      .from('echo_messages')
      .select('id, role, content, tool_calls, skill, page_route, tokens_in, tokens_out, created_at')
      .eq('conversation_id', args.conversationId)
      .order('created_at', { ascending: true });
    if (msgsErr) throw new Error(`getConversation messages: ${msgsErr.message}`);

    return {
      ...this.toSummary(conv),
      messages: (msgs ?? []).map(this.toMessage),
    };
  }

  async archiveConversation(args: {
    conversationId: string;
    ownerId: string;
    accessToken: string | null;
  }): Promise<void> {
    const client = this.supabase.getClient(args.accessToken ?? undefined);
    const { error } = await client
      .from('echo_conversations')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', args.conversationId)
      .eq('owner_id', args.ownerId);
    if (error) throw new Error(`archiveConversation: ${error.message}`);
  }

  async recentMessages(args: {
    conversationId: string;
    ownerId: string;
    accessToken: string | null;
    limit?: number;
  }): Promise<Array<{ role: 'user' | 'assistant' | 'tool' | 'system'; content: string; toolCalls?: unknown }>> {
    const client = this.supabase.getClient(args.accessToken ?? undefined);
    const { data, error } = await client
      .from('echo_messages')
      .select('role, content, tool_calls')
      .eq('conversation_id', args.conversationId)
      .eq('owner_id', args.ownerId)
      .order('created_at', { ascending: true })
      .limit(Math.min(40, args.limit ?? 12));
    if (error) throw new Error(`recentMessages: ${error.message}`);
    return (data ?? []).map((r: any) => ({ role: r.role, content: r.content, toolCalls: r.tool_calls }));
  }

  async createMessage(args: CreateMessageArgs, accessToken: string | null): Promise<{ id: string }> {
    const client = this.supabase.getClient(accessToken ?? undefined);
    const { data, error } = await client
      .from('echo_messages')
      .insert({
        conversation_id: args.conversationId,
        owner_id: args.ownerId,
        role: args.role,
        content: args.content,
        tool_calls: args.toolCalls ?? null,
        skill: args.skill ?? null,
        page_route: args.pageRoute ?? null,
        entity_type: args.entityType ?? null,
        entity_id: args.entityId ?? null,
        model: args.model ?? null,
        tokens_in: args.tokensIn ?? 0,
        tokens_out: args.tokensOut ?? 0,
        cache_read_tokens: args.cacheReadTokens ?? 0,
        cache_creation_tokens: args.cacheCreationTokens ?? 0,
        duration_ms: args.durationMs ?? null,
        credits_charged: args.creditsCharged ?? 0,
      })
      .select('id')
      .single();
    if (error) throw new Error(`createMessage: ${error.message}`);

    // Bump the conversation's updated_at so listings reorder
    await client
      .from('echo_conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', args.conversationId)
      .eq('owner_id', args.ownerId);

    return { id: data.id };
  }

  async saveContextSnapshot(args: {
    ownerId: string;
    accessToken: string | null;
    conversationId: string;
    messageId: string;
    route: string;
    entityType?: string;
    entityId?: string;
    contextJson: Record<string, unknown>;
  }): Promise<void> {
    const client = this.supabase.getClient(args.accessToken ?? undefined);
    const { error } = await client.from('echo_context_snapshots').insert({
      owner_id: args.ownerId,
      conversation_id: args.conversationId,
      message_id: args.messageId,
      route: args.route,
      entity_type: args.entityType ?? null,
      entity_id: args.entityId ?? null,
      context_json: args.contextJson,
    });
    if (error) {
      // Non-fatal: log and continue. Snapshot is a nice-to-have, not the chat.
      this.logger.warn(`saveContextSnapshot failed: ${error.message}`);
    }
  }

  // ── shape mappers ─────────────────────────────────────────────────────────

  private toSummary = (r: any): ConversationSummaryDto => ({
    id: r.id,
    title: r.title ?? undefined,
    skill: r.skill ?? undefined,
    pinned: !!r.pinned,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  });

  private toMessage = (r: any): ConversationMessageDto => ({
    id: r.id,
    role: r.role,
    content: r.content,
    toolCalls: r.tool_calls ?? undefined,
    skill: r.skill ?? undefined,
    pageRoute: r.page_route ?? undefined,
    tokensIn: r.tokens_in ?? 0,
    tokensOut: r.tokens_out ?? 0,
    createdAt: r.created_at,
  });
}
