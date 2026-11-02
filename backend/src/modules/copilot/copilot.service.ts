import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { BOMItemsService } from '../bom-items/bom-items.service';
import { CopilotMemoryService, type MemoryProposal } from './copilot-memory.service';
import type { BOMItemResponseDto } from '../bom-items/dto/bom-item-response.dto';
import { COPILOT_SYSTEM_PROMPT } from './copilot.prompt';
import { CostAggregationService } from '../costing/cost-aggregation.service';
import { CopilotToolRunner, ResultCache, copilotTools, type ToolContext } from './copilot.tools';
import { asksToChangeMemory, latestUserText } from './copilot-intent';
import { COPILOT_MAX_USER_CHARS, type CopilotChatDto } from './dto/chat.dto';
import { AiBudgetExceededException, AiBudgetService, type AiCaller, type AiSession } from '../../common/ai/ai-budget.service';
import { copilotPartCard } from './copilot-context';

const DEFAULT_MODEL = 'claude-sonnet-5-5';
const MAX_TOOL_ITERATIONS = 5;
const REQUEST_TIMEOUT_MS = 90_000;

export type CopilotEvent =
  | { type: 'text'; delta: string }
  | ({ type: 'memory_proposal' } & MemoryProposal)
  | { type: 'done'; usage: CopilotUsage }
  | { type: 'error'; code: CopilotErrorCode };

export type CopilotErrorCode = 'rate_limited' | 'budget_exhausted' | 'upstream_unavailable' | 'refused' | 'tool_limit' | 'internal';

export interface CopilotUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  iterations: number;
}

export interface PreparedChat {
  item: BOMItemResponseDto;
  /** What this user asked the copilot to remember; empty when none or when the memory table cannot be read. */
  preferences: string[];
  /** The AI request this chat runs in (budget, concurrency); stream() closes it. */
  session: AiSession;
}

@Injectable()
export class CopilotService {
  private readonly logger = new Logger(CopilotService.name);
  /** Shared across requests: follow-up questions in one conversation reuse the slow cost computations. */
  private readonly results = new ResultCache();
  private readonly model: string;

  constructor(
    config: ConfigService,
    private readonly bomItems: BOMItemsService,
    private readonly memory: CopilotMemoryService,
    private readonly costAggregation: CostAggregationService,
    private readonly ai: AiBudgetService,
  ) {
    this.model = config.get<string>('COPILOT_MODEL') || DEFAULT_MODEL;
  }

  /**
   * Everything that can fail with a normal HTTP error runs before the stream
   * opens: the body is valid, the part is visible to this user (RLS hides other
   * organizations' rows, so a foreign id is a 404 here), and AI is on and within
   * this user's and organization's budget (503 / 429). The AI session is opened
   * last, so nothing after it can fail and leave its slot taken.
   */
  async prepare(dto: CopilotChatDto, caller: AiCaller): Promise<PreparedChat> {
    this.conversation(dto);
    const [item, preferences] = await Promise.all([
      this.bomItems.findOne(dto.bomItemId, caller.userId, caller.accessToken),
      // Saved preferences are a convenience: if they cannot be read (already logged by the memory service) the chat still answers.
      this.memory.load(caller.userId, caller.accessToken).catch((): string[] => []),
    ]);
    const session = await this.ai.open(caller, 'copilot');
    return { item, preferences, session };
  }

  async stream(
    dto: CopilotChatDto,
    prepared: PreparedChat,
    emit: (event: CopilotEvent) => void,
    signal: AbortSignal,
  ): Promise<void> {
    const { session } = prepared;
    const { userId, accessToken } = session.caller;
    const startedAt = Date.now();
    // Decided once, from the user's own latest turn as sent: tool results appended
    // below as user-role messages, assistant turns and the part card never count.
    const memoryWritesAllowed = asksToChangeMemory(latestUserText(dto.messages));
    const toolCtx: ToolContext = {
      memoryWritesAllowed,
      item: prepared.item,
      bomItemId: dto.bomItemId,
      userId,
      accessToken,
      location: dto.location,
      batchSize: dto.batchSize,
      productionLifeYears: dto.productionLifeYears,
      conversationId: dto.conversationId,
      turn: dto.turn,
    };
    const tools = new CopilotToolRunner(toolCtx, this.bomItems, this.memory, this.costAggregation, this.results);
    const messages = this.conversation(dto);
    const usage: CopilotUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, iterations: 0 };
    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]);

    try {
      for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
        usage.iterations++;
        const message = await session.stream(
          {
            model: this.model,
            output_config: { effort: 'low' },
            // Tools + this first block form the cached prefix; the part card below it varies per request.
            system: [
              { type: 'text', text: COPILOT_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
              { type: 'text', text: copilotPartCard(prepared.item, dto, prepared.preferences) },
            ],
            tools: copilotTools(memoryWritesAllowed),
            messages,
          },
          (delta) => emit({ type: 'text', delta }),
          { signal: requestSignal },
        );

        usage.inputTokens += message.usage.input_tokens;
        usage.outputTokens += message.usage.output_tokens;
        usage.cacheReadTokens += message.usage.cache_read_input_tokens ?? 0;
        usage.cacheWriteTokens += message.usage.cache_creation_input_tokens ?? 0;

        if (message.stop_reason === 'refusal') return this.finish(emit, usage, userId, dto, startedAt, 'refused');
        if (message.stop_reason !== 'tool_use') return this.finish(emit, usage, userId, dto, startedAt);

        // Thinking blocks must go back unchanged, so the whole content array is appended.
        messages.push({ role: 'assistant', content: message.content });
        const calls = message.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
        const results = await Promise.all(
          calls.map(async (call) => {
            const toolStart = Date.now();
            const outcome = await tools.run(call.name, call.input);
            this.logger.log(`copilot tool user=${userId} item=${dto.bomItemId} name=${call.name} ms=${Date.now() - toolStart}${outcome.isError ? ' error=true' : ''}`);
            if (outcome.memoryProposal) {
              this.logger.log(`copilot memory proposed user=${userId} add=${outcome.memoryProposal.add.length} remove=${outcome.memoryProposal.remove.length}`);
              emit({ type: 'memory_proposal', ...outcome.memoryProposal });
            }
            return {
              type: 'tool_result' as const,
              tool_use_id: call.id,
              content: outcome.content,
              ...(outcome.isError ? { is_error: true } : {}),
            };
          }),
        );
        messages.push({ role: 'user', content: results });
      }
      return this.finish(emit, usage, userId, dto, startedAt, 'tool_limit');
    } catch (err) {
      if (signal.aborted) return; // client went away: nothing to tell it
      const code = this.errorCode(err);
      this.logger.error(`copilot failed user=${userId} item=${dto.bomItemId} code=${code} cause=${(err as Error)?.name}: ${(err as Error)?.message}`);
      emit({ type: 'error', code });
    } finally {
      session.close();
    }
  }

  private finish(
    emit: (event: CopilotEvent) => void,
    usage: CopilotUsage,
    userId: string,
    dto: CopilotChatDto,
    startedAt: number,
    errorCode?: CopilotErrorCode,
  ): void {
    this.logger.log(
      `copilot usage user=${userId} item=${dto.bomItemId} model=${this.model} in=${usage.inputTokens} out=${usage.outputTokens} cacheRead=${usage.cacheReadTokens} cacheWrite=${usage.cacheWriteTokens} iters=${usage.iterations} ms=${Date.now() - startedAt}${errorCode ? ` error=${errorCode}` : ''}`,
    );
    if (errorCode) emit({ type: 'error', code: errorCode });
    else emit({ type: 'done', usage });
  }

  private errorCode(err: unknown): CopilotErrorCode {
    if (err instanceof AiBudgetExceededException) return 'budget_exhausted';
    if (err instanceof Anthropic.RateLimitError) return 'rate_limited';
    if (err instanceof Anthropic.APIConnectionError || err instanceof Anthropic.InternalServerError) return 'upstream_unavailable';
    return 'internal';
  }

  /** The request's messages as the API expects them: starts with a user turn and ends with one. */
  private conversation(dto: CopilotChatDto): Anthropic.MessageParam[] {
    const turns = dto.messages.map((m) => ({ role: m.role, content: m.content }));
    while (turns.length && turns[0].role !== 'user') turns.shift();
    if (!turns.length || turns[turns.length - 1].role !== 'user') {
      throw new BadRequestException('messages must end with a user message');
    }
    if (turns.some((t) => t.role === 'user' && t.content.length > COPILOT_MAX_USER_CHARS)) {
      throw new BadRequestException(`a question can be at most ${COPILOT_MAX_USER_CHARS} characters`);
    }
    return turns;
  }
}
