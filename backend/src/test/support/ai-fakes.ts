import type { ConfigService } from '@nestjs/config';
import type Anthropic from '@anthropic-ai/sdk';

import { AiBudgetService } from '../../common/ai/ai-budget.service';
import type { DatabaseService } from '../../common/database/database.service';
import { fakeClient, type Handler, type Result } from './fake-db-client';

/**
 * Stand-ins for the two external boundaries the AI code talks to: the database client and the Anthropic API. The services under
 * test (AiBudgetService, CopilotService, CopilotMemoryService, VaveAiService) are the real ones.
 */

export interface UsageToday {
  user_tokens: number;
  organization_tokens: number;
  global_tokens: number;
}

/** A database whose ai_usage_today answers `today` (mutable) and whose other rpcs succeed; tables are answered by `tables`. */
export function fakeAiDatabase(tables: Handler = () => ({ data: null, error: null }), today: UsageToday = { user_tokens: 0, organization_tokens: 0, global_tokens: 0 }) {
  const rpc = (fn: string): Result => (fn === 'ai_usage_today' ? { data: [today], error: null } : { data: null, error: null });
  const fake = fakeClient(tables, rpc);
  const database = { getUserClient: () => fake.client, getClient: () => fake.client, getPrivilegedClient: () => fake.client } as unknown as DatabaseService;
  return { database, today, ...fake };
}

export const AI_TEST_LIMITS = {
  AI_DISABLED: 'false',
  AI_USER_DAILY_TOKENS: 1_000,
  AI_ORG_DAILY_TOKENS: 5_000,
  AI_GLOBAL_DAILY_TOKENS: 10_000,
  AI_MAX_CONCURRENT_PER_USER: 2,
  ANTHROPIC_API_KEY: 'test-key',
};

export function configOf(values: Record<string, unknown>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

export type ScriptedTurn = { stop_reason: string; content: unknown[]; usage?: Partial<Anthropic.Usage> };

/** An Anthropic client that answers each call with the next scripted turn (the last one repeats) and records what it was sent. */
export function fakeAnthropic(turns: ScriptedTurn[]) {
  const requests: Array<Record<string, any>> = [];
  let i = 0;
  const next = (params: Record<string, any>) => {
    requests.push(params);
    const turn = turns[Math.min(i++, turns.length - 1)];
    return { role: 'assistant', ...turn, usage: { input_tokens: 10, output_tokens: 5, ...turn.usage } };
  };
  const client = {
    messages: {
      create: async (params: Record<string, any>) => next(params),
      stream: (params: Record<string, any>) => {
        const message = next(params);
        const texts = (message.content as Array<{ type: string; text?: string }>).filter((b) => b.type === 'text');
        return {
          currentMessage: undefined,
          on: (event: string, cb: (delta: string) => void) => {
            if (event === 'text') for (const b of texts) cb(b.text ?? '');
          },
          finalMessage: async () => message,
        };
      },
    },
  };
  return { client, requests };
}

/** A real AiBudgetService over the given database, calling the given (fake) Anthropic client. */
export function aiBudget(database: DatabaseService, anthropic: unknown, limits: Record<string, unknown> = AI_TEST_LIMITS): AiBudgetService {
  const service = new AiBudgetService(configOf(limits), database);
  (service as unknown as { client: unknown }).client = anthropic;
  return service;
}
