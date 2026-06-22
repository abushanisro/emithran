import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { EngineeringBrief } from '../dto/engineering-brief.dto';
import type { CandidateSet } from '../dto/candidate-set.dto';
import type { AbstractPlan } from '../dto/abstract-plan.dto';
import type { ToolCallLogEntry } from '../dto/generation-response.dto';

import { STATIC_SYSTEM_PROMPT, formatBriefAndCandidates } from '../prompts/system.prompt';
import { TOOLS } from '../prompts/tool-schemas';
import { validateAbstractPlan } from './abstract-plan.validator';
import { ExpandCandidatesTool } from './tools/expand-candidates.tool';

export const REASONING_MODEL = 'claude-sonnet-4-6';
const MAX_TOOL_CALLS = 8;
const MAX_TOKENS_OUT = 8192;
const WALL_CLOCK_MS = 180_000;
const VALIDATION_RETRIES = 1;

export interface ReasoningInput {
  brief: EngineeringBrief;
  candidates: CandidateSet;
  userId: string;
  accessToken: string | null;
  emitToolCall?: (entry: ToolCallLogEntry) => void;
  kbContext?: string; // manufacturing knowledge base context injected before user message
}

export interface ReasoningOutput {
  plan: AbstractPlan | null;
  candidatesAfterExpansion: CandidateSet;
  toolCalls: ToolCallLogEntry[];
  tokensIn: number;
  tokensOut: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  error?: string;
}

/**
 * Stage 2 — runs the Claude tool-use loop. The model has access to two
 * tools (expand_candidates, save_draft). The session ends when `save_draft`
 * is called (success) or when caps are hit (failure).
 *
 * Caps:
 *   - 4 tool calls total
 *   - 45 s wall clock
 *   - 1 validation-retry per save_draft attempt
 *
 * Cache: STATIC_SYSTEM_PROMPT is marked ephemeral so retries inside the
 * 5-min cache window pay ~10% of the first call's input cost.
 */
@Injectable()
export class ReasoningService {
  private readonly logger = new Logger(ReasoningService.name);
  private readonly apiKey: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly expandTool: ExpandCandidatesTool,
  ) {
    this.apiKey = this.configService.get<string>('ANTHROPIC_API_KEY') ?? process.env.ANTHROPIC_API_KEY ?? '';
    if (!this.apiKey) {
      this.logger.warn('ANTHROPIC_API_KEY not configured — reasoning will fall back to deterministic path');
    }
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  async reason(input: ReasoningInput): Promise<ReasoningOutput> {
    const startTime = Date.now();
    const out: ReasoningOutput = {
      plan: null,
      candidatesAfterExpansion: input.candidates,
      toolCalls: [],
      tokensIn: 0,
      tokensOut: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    };

    if (!this.apiKey) {
      out.error = 'ANTHROPIC_API_KEY not set';
      return out;
    }

    // System blocks — first block (static) is the largest and is cached.
    const systemBlocks: any[] = [
      {
        type: 'text',
        text: STATIC_SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ];

    // Inject KB context as a second cached system block (routing rules, templates, feature→process mappings)
    if (input.kbContext) {
      systemBlocks.push({
        type: 'text',
        text: input.kbContext,
        cache_control: { type: 'ephemeral' },
      });
    }

    // First user message — the brief + candidates
    const initialUserContent = formatBriefAndCandidates(input.brief, out.candidatesAfterExpansion);
    const messages: any[] = [{ role: 'user', content: initialUserContent }];

    let toolCallCount = 0;
    let validationRetries = 0;

    while (toolCallCount < MAX_TOOL_CALLS) {
      // Wall-clock check
      if (Date.now() - startTime > WALL_CLOCK_MS) {
        out.error = `wall-clock exceeded ${WALL_CLOCK_MS}ms after ${toolCallCount} tool calls`;
        this.logger.warn(out.error);
        return out;
      }

      let resp: any;
      try {
        resp = await this.callClaude(systemBlocks, messages);
      } catch (e: any) {
        out.error = `Claude API call failed: ${e.message ?? e}`;
        this.logger.error(out.error);
        return out;
      }

      // Accumulate usage
      const usage = resp.usage ?? {};
      out.tokensIn += usage.input_tokens ?? 0;
      out.tokensOut += usage.output_tokens ?? 0;
      out.cacheReadTokens += usage.cache_read_input_tokens ?? 0;
      out.cacheCreationTokens += usage.cache_creation_input_tokens ?? 0;

      const stopReason: string = resp.stop_reason;
      const content: any[] = resp.content ?? [];

      // No tool use → model gave up or returned text; bail.
      // With tool_choice:'any' this should only occur on max_tokens (output truncated).
      if (stopReason !== 'tool_use') {
        const text = content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').slice(0, 600);
        out.error = stopReason === 'max_tokens'
          ? `Model hit output token limit (${MAX_TOKENS_OUT}) before calling save_draft. Partial text: ${text.slice(0, 200)}`
          : `Model stopped without calling save_draft (reason=${stopReason}). Text: ${text.slice(0, 400)}`;
        this.logger.warn(out.error);
        return out;
      }

      // Append the assistant turn (required for the next turn)
      messages.push({ role: 'assistant', content });

      // Find tool_use blocks in this turn
      const toolUses = content.filter((b) => b.type === 'tool_use');
      const toolResults: any[] = [];

      for (const tu of toolUses) {
        toolCallCount += 1;
        if (toolCallCount > MAX_TOOL_CALLS) {
          out.error = `tool-call cap (${MAX_TOOL_CALLS}) exceeded`;
          this.logger.warn(out.error);
          return out;
        }

        const callStart = Date.now();
        const toolName = tu.name as 'expand_candidates' | 'save_draft';
        const toolInput = tu.input as Record<string, any>;

        if (toolName === 'expand_candidates') {
          const result = await this.expandTool.execute({
            kind: toolInput.kind,
            query: toolInput.query,
            userId: input.userId,
            accessToken: input.accessToken,
            family: input.brief.scope.family as Exclude<typeof input.brief.scope.family, 'out_of_scope'>,
            orgLocation: input.brief.context.organizationLocation,
            currentCandidates: out.candidatesAfterExpansion,
            dfm: input.brief.dfm,
          });

          // Merge added candidates into the in-memory set so save_draft validation accepts them
          const kindToField: Record<string, keyof CandidateSet> = {
            rawMaterial: 'rawMaterials',
            machine: 'machines',
            labour: 'labour',
            process: 'processes',
            calculator: 'calculators',
          };
          const field = kindToField[result.kind];
          if (field) {
            out.candidatesAfterExpansion = {
              ...out.candidatesAfterExpansion,
              [field]: [...(out.candidatesAfterExpansion[field] as any[]), ...result.added],
            };
          }

          const entry: ToolCallLogEntry = {
            index: toolCallCount,
            toolName: 'expand_candidates',
            input: toolInput,
            result: { addedCount: result.added.length, added: result.added },
            durationMs: Date.now() - callStart,
          };
          out.toolCalls.push(entry);
          input.emitToolCall?.(entry);

          toolResults.push({
            type: 'tool_result',
            tool_use_id: tu.id,
            content: JSON.stringify({ added: result.added, kind: result.kind }),
          });
        } else if (toolName === 'save_draft') {
          const validation = validateAbstractPlan(toolInput, out.candidatesAfterExpansion);
          if (validation.ok) {
            out.plan = validation.plan;
            const entry: ToolCallLogEntry = {
              index: toolCallCount,
              toolName: 'save_draft',
              input: { ok: true, lineCounts: this.lineCounts(validation.plan) },
              result: { accepted: true },
              durationMs: Date.now() - callStart,
            };
            out.toolCalls.push(entry);
            input.emitToolCall?.(entry);
            return out; // success, end session
          }

          // Validation failed — return errors to model so it can retry
          const entry: ToolCallLogEntry = {
            index: toolCallCount,
            toolName: 'save_draft',
            input: { ok: false },
            result: { accepted: false, errors: validation.errors.slice(0, 20) },
            durationMs: Date.now() - callStart,
          };
          out.toolCalls.push(entry);
          input.emitToolCall?.(entry);

          if (validationRetries >= VALIDATION_RETRIES) {
            out.error = `save_draft validation failed after ${validationRetries + 1} attempts: ${validation.errors.slice(0, 3).join('; ')}`;
            return out;
          }
          validationRetries += 1;

          toolResults.push({
            type: 'tool_result',
            tool_use_id: tu.id,
            is_error: true,
            content: `Your save_draft input failed validation. Fix these errors and try again:\n\n${validation.errors.slice(0, 15).map((e) => `  - ${e}`).join('\n')}\n\nCall save_draft again with corrections.`,
          });
        } else {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tu.id,
            is_error: true,
            content: `Unknown tool: ${toolName}. Available tools: expand_candidates, save_draft.`,
          });
        }
      }

      // Append the user turn with tool_results so the model can continue
      messages.push({ role: 'user', content: toolResults });
    }

    out.error = `tool-call cap (${MAX_TOOL_CALLS}) reached without save_draft success`;
    return out;
  }

  // ── HTTP call ─────────────────────────────────────────────────────────────

  private async callClaude(systemBlocks: any[], messages: any[]): Promise<any> {
    const body = {
      model: REASONING_MODEL,
      max_tokens: MAX_TOKENS_OUT,
      temperature: 0,
      system: systemBlocks,
      tools: TOOLS,
      tool_choice: { type: 'any' },  // 'any' forces the model to call a tool on every turn; prevents text-only "sorry I can't" responses
      messages,
    };

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Anthropic API ${resp.status}: ${errText.slice(0, 400)}`);
    }
    return resp.json();
  }

  private lineCounts(plan: AbstractPlan) {
    return {
      rawMaterials: plan.rawMaterials.length,
      processes: plan.processes.length,
      tooling: plan.tooling.length,
      logistics: plan.logistics.length,
      procuredParts: plan.procuredParts.length,
      proposedMasters: plan.proposedMasters.length,
    };
  }
}
