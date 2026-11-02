import { ForbiddenException, HttpException, HttpStatus, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';

import { DatabaseService } from '../database/database.service';

/**
 * Every feature that calls the model, and the most output one call of it may produce. max_tokens is fixed here per use, never taken
 * from a request: adaptive thinking spends from the same budget, so each value is the expected answer plus room to think.
 */
export const AI_MAX_TOKENS = {
  /** One step of the copilot's tool loop (low effort; a short answer or a few tool calls). */
  copilot: 4_096,
  /** A drawing's structured brief (JSON, no thinking). */
  drawing_extraction: 8_192,
  /** Benchmark VAVE insights: one JSON object with a handful of short lists. */
  vave_bom_analysis: 6_000,
  /** Affinity groups, focus areas and a QFD matrix for the top 30 parts. */
  vave_cost_analysis: 6_000,
  /** Twelve VAVE ideas of a few sentences each. */
  vave_ideation: 8_000,
  /** One part's should-cost: six numbers and a note. */
  vave_should_cost: 2_000,
} as const;

export type AiUseCase = keyof typeof AI_MAX_TOKENS;

/** Who pays for a call: the signed-in user, in the organization the request acts for (OrganizationContextGuard). */
export interface AiCaller {
  userId: string;
  organizationId: string;
  /** The user's database token: usage is read and written through the user's own client (migration 949 functions). */
  accessToken: string;
}

export interface AiLimits {
  disabled: boolean;
  userDailyTokens: number;
  orgDailyTokens: number;
  globalDailyTokens: number;
  maxConcurrentPerUser: number;
}

export function aiLimitsFrom(config: ConfigService): AiLimits {
  // Defaults and documentation live in config/env.validation.ts; ConfigService returns the validated values.
  return {
    disabled: config.get<string>('AI_DISABLED') === 'true',
    userDailyTokens: Number(config.get('AI_USER_DAILY_TOKENS')),
    orgDailyTokens: Number(config.get('AI_ORG_DAILY_TOKENS')),
    globalDailyTokens: Number(config.get('AI_GLOBAL_DAILY_TOKENS')),
    maxConcurrentPerUser: Number(config.get('AI_MAX_CONCURRENT_PER_USER')),
  };
}

export type AiBudgetScope = 'user' | 'organization' | 'global' | 'concurrency';

const RESETS = 'It resets at 00:00 UTC.';
const BUDGET_MESSAGES: Record<AiBudgetScope, string> = {
  user: `You have used your daily AI allowance. ${RESETS}`,
  organization: `Your organization has used its daily AI allowance. ${RESETS}`,
  global: `The platform's daily AI allowance is used up. ${RESETS}`,
  concurrency: 'You already have the maximum number of AI requests running. Wait for one to finish and try again.',
};

/** 429 with a message the UI shows as is, and a code it can branch on. */
export class AiBudgetExceededException extends HttpException {
  constructor(readonly scope: AiBudgetScope) {
    super(
      { message: BUDGET_MESSAGES[scope], code: scope === 'concurrency' ? 'AI_TOO_MANY_REQUESTS' : 'AI_BUDGET_EXHAUSTED', scope },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

type CreateParams = Omit<Anthropic.MessageCreateParamsNonStreaming, 'max_tokens' | 'stream'>;
type StreamParams = Omit<Anthropic.MessageStreamParams, 'max_tokens' | 'stream'>;

interface UsageToday {
  user_tokens: number | string;
  organization_tokens: number | string;
  global_tokens: number | string;
}

/**
 * The single choke point for the Anthropic API. It holds the only API key the backend uses, so a feature cannot call the model
 * without going through it, and it enforces decision D6:
 *   - AI_DISABLED kill switch (503);
 *   - daily token budgets per user, per organization and for the deployment, counted in Postgres from each response's usage, so
 *     every backend instance shares them (429);
 *   - AI_MAX_CONCURRENT_PER_USER requests running at once per user (429). Held in this process: a crashed request frees its slot
 *     with the process, and the backend runs as one instance (docker-compose.prod.yml);
 *   - max_tokens per use (AI_MAX_TOKENS).
 * The budget is checked before every model call and the call's real usage recorded after it. A call that starts under the limit
 * can finish over it, by at most one call per running request; the next call is refused.
 */
@Injectable()
export class AiBudgetService {
  private readonly logger = new Logger(AiBudgetService.name);
  private readonly limits: AiLimits;
  private readonly client: Anthropic | null;
  private readonly running = new Map<string, number>();
  private globalWarnedFor: string | null = null;

  constructor(config: ConfigService, private readonly database: DatabaseService) {
    this.limits = aiLimitsFrom(config);
    const apiKey = config.get<string>('ANTHROPIC_API_KEY');
    // The SDK retries 429/5xx/connection errors itself (honouring retry-after).
    this.client = apiKey ? new Anthropic({ apiKey, timeout: 60_000, maxRetries: 2 }) : null;
    if (this.limits.disabled) this.logger.warn('AI_DISABLED=true: every AI call is refused');
  }

  /**
   * Starts one AI request for `caller`: refuses when AI is off or unconfigured (503), when the user already has the maximum number
   * of requests running, or when a daily budget is spent (429). The session must be closed (finally) to free its slot.
   */
  async open(caller: AiCaller, useCase: AiUseCase): Promise<AiSession> {
    if (this.limits.disabled) {
      throw new ServiceUnavailableException({ message: 'AI features are switched off by the operator.', code: 'AI_DISABLED' });
    }
    if (!this.client) {
      throw new ServiceUnavailableException({ message: 'AI is not configured on this server.', code: 'AI_NOT_CONFIGURED' });
    }
    // Taken before the first await, so two requests arriving together cannot both pass the check.
    const running = this.running.get(caller.userId) ?? 0;
    if (running >= this.limits.maxConcurrentPerUser) throw new AiBudgetExceededException('concurrency');
    this.running.set(caller.userId, running + 1);
    try {
      await this.assertWithinBudget(caller);
    } catch (error) {
      this.release(caller.userId);
      throw error;
    }
    return new AiSession(this, this.client, caller, useCase);
  }

  /** @internal AiSession */
  release(userId: string): void {
    const running = (this.running.get(userId) ?? 1) - 1;
    if (running > 0) this.running.set(userId, running);
    else this.running.delete(userId);
  }

  /** @internal AiSession: refuses with 429 when any of today's totals has reached its limit. */
  async assertWithinBudget(caller: AiCaller): Promise<void> {
    const { data, error } = await this.database
      .getUserClient(caller.accessToken)
      .rpc('ai_usage_today', { p_organization_id: caller.organizationId });
    if (error) {
      if (error.code === '42501') throw new ForbiddenException('You are not a member of this organization.');
      this.logger.error(`AI usage read failed user=${caller.userId}: ${error.message}`);
      throw new ServiceUnavailableException({ message: 'AI usage could not be checked. Try again shortly.', code: 'AI_USAGE_UNAVAILABLE' });
    }
    const row = (Array.isArray(data) ? data[0] : data) as UsageToday | undefined;
    const used = {
      user: Number(row?.user_tokens ?? 0),
      organization: Number(row?.organization_tokens ?? 0),
      global: Number(row?.global_tokens ?? 0),
    };
    this.warnNearGlobalCeiling(used.global);
    if (used.global >= this.limits.globalDailyTokens) throw new AiBudgetExceededException('global');
    if (used.organization >= this.limits.orgDailyTokens) throw new AiBudgetExceededException('organization');
    if (used.user >= this.limits.userDailyTokens) throw new AiBudgetExceededException('user');
  }

  /**
   * @internal AiSession: adds one response's usage to today's counters. A failure fails the request: an unrecorded call would be
   * spend the budget never sees.
   */
  async record(caller: AiCaller, useCase: AiUseCase, usage: Anthropic.Usage): Promise<void> {
    const input = usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
    const output = usage.output_tokens;
    const { error } = await this.database.getUserClient(caller.accessToken).rpc('ai_usage_record', {
      p_organization_id: caller.organizationId,
      p_input_tokens: input,
      p_output_tokens: output,
    });
    this.logger.log(`ai usage user=${caller.userId} org=${caller.organizationId} use=${useCase} in=${input} out=${output}`);
    if (error) {
      this.logger.error(`AI usage write failed user=${caller.userId} use=${useCase} in=${input} out=${output}: ${error.message}`);
      throw new ServiceUnavailableException({ message: 'AI usage could not be recorded. Try again shortly.', code: 'AI_USAGE_UNAVAILABLE' });
    }
  }

  private warnNearGlobalCeiling(globalTokens: number): void {
    const day = new Date().toISOString().slice(0, 10);
    if (globalTokens < this.limits.globalDailyTokens * 0.8 || this.globalWarnedFor === day) return;
    this.globalWarnedFor = day;
    this.logger.warn(`AI spend at ${globalTokens} of ${this.limits.globalDailyTokens} tokens today (AI_GLOBAL_DAILY_TOKENS): 80% reached`);
  }
}

/** One AI request (one HTTP request of a feature), possibly several model calls. Each call is checked before and recorded after. */
export class AiSession {
  private closed = false;
  /** open() has just checked the budget, so the first call does not read it again. */
  private budgetChecked = true;

  constructor(
    private readonly budget: AiBudgetService,
    private readonly client: Anthropic,
    readonly caller: AiCaller,
    readonly useCase: AiUseCase,
  ) {}

  get maxTokens(): number {
    return AI_MAX_TOKENS[this.useCase];
  }

  async create(params: CreateParams, options?: Anthropic.RequestOptions): Promise<Anthropic.Message> {
    await this.beforeCall();
    const message = await this.client.messages.create({ ...params, max_tokens: this.maxTokens }, options);
    await this.budget.record(this.caller, this.useCase, message.usage);
    return message;
  }

  /** Streams one call, handing each text delta to onText. Usage is recorded even when the stream fails or is aborted midway. */
  async stream(params: StreamParams, onText: (delta: string) => void, options?: Anthropic.RequestOptions): Promise<Anthropic.Message> {
    await this.beforeCall();
    const stream = this.client.messages.stream({ ...params, max_tokens: this.maxTokens }, options);
    stream.on('text', onText);
    let message: Anthropic.Message;
    try {
      message = await stream.finalMessage();
    } catch (error) {
      const partial = stream.currentMessage?.usage;
      if (partial) await this.budget.record(this.caller, this.useCase, partial).catch(() => undefined); // already logged; the call's own error wins
      throw error;
    }
    await this.budget.record(this.caller, this.useCase, message.usage);
    return message;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.budget.release(this.caller.userId);
  }

  private async beforeCall(): Promise<void> {
    if (this.closed) throw new Error('AI session already closed');
    if (this.budgetChecked) {
      this.budgetChecked = false;
      return;
    }
    await this.budget.assertWithinBudget(this.caller);
  }
}
