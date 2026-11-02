import { ForbiddenException, HttpStatus, ServiceUnavailableException } from '@nestjs/common';

import { AI_MAX_TOKENS, AiBudgetExceededException, AiBudgetService, type AiCaller } from './ai-budget.service';
import { AI_TEST_LIMITS, aiBudget, configOf, fakeAiDatabase, fakeAnthropic } from '../../test/support/ai-fakes';
import { fakeClient } from '../../test/support/fake-db-client';
import type { DatabaseService } from '../database/database.service';

const caller: AiCaller = { userId: 'user-1', organizationId: 'org-1', accessToken: 'token' };
const answer = { stop_reason: 'end_turn', content: [{ type: 'text', text: 'ok' }] };
const ask = { model: 'm', messages: [{ role: 'user' as const, content: 'hi' }] };

async function refusal(promise: Promise<unknown>): Promise<AiBudgetExceededException> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AiBudgetExceededException) return error;
    throw error;
  }
  throw new Error('expected a 429');
}

describe('AiBudgetService', () => {
  it('refuses every call with 503 when the kill switch is on, without calling the model', async () => {
    const db = fakeAiDatabase();
    const model = fakeAnthropic([answer]);
    const ai = aiBudget(db.database, model.client, { ...AI_TEST_LIMITS, AI_DISABLED: 'true' });
    await expect(ai.open(caller, 'copilot')).rejects.toThrow(ServiceUnavailableException);
    expect(model.requests).toHaveLength(0);
    expect(db.rpcCalls).toHaveLength(0);
  });

  it('refuses with 503 when no API key is configured', async () => {
    const ai = new AiBudgetService(configOf({ ...AI_TEST_LIMITS, ANTHROPIC_API_KEY: '' }), fakeAiDatabase().database);
    await expect(ai.open(caller, 'copilot')).rejects.toThrow(ServiceUnavailableException);
  });

  it.each([
    ['user', { user_tokens: 1_000, organization_tokens: 1_000, global_tokens: 1_000 }],
    ['organization', { user_tokens: 0, organization_tokens: 5_000, global_tokens: 5_000 }],
    ['global', { user_tokens: 0, organization_tokens: 0, global_tokens: 10_000 }],
  ] as const)('refuses with 429 once the %s budget is spent', async (scope, today) => {
    const model = fakeAnthropic([answer]);
    const ai = aiBudget(fakeAiDatabase(undefined, { ...today }).database, model.client);
    const error = await refusal(ai.open(caller, 'vave_ideation'));
    expect(error.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect(error.getResponse()).toMatchObject({ code: 'AI_BUDGET_EXHAUSTED', scope, message: expect.stringMatching(/00:00 UTC/) });
    expect(model.requests).toHaveLength(0);
  });

  it('allows a user only AI_MAX_CONCURRENT_PER_USER requests at once, and frees a slot on close or refusal', async () => {
    const db = fakeAiDatabase();
    const ai = aiBudget(db.database, fakeAnthropic([answer]).client);
    const first = await ai.open(caller, 'copilot');
    await ai.open(caller, 'copilot');
    expect((await refusal(ai.open(caller, 'copilot'))).getResponse()).toMatchObject({ code: 'AI_TOO_MANY_REQUESTS' });
    await ai.open({ ...caller, userId: 'user-2' }, 'copilot'); // another user is unaffected
    first.close();
    first.close(); // closing twice frees one slot, not two
    const third = await ai.open(caller, 'copilot');
    expect(third).toBeDefined();
    await expect(ai.open(caller, 'copilot')).rejects.toThrow(AiBudgetExceededException);

    // a request refused for budget does not keep its slot
    db.today.user_tokens = 1_000;
    const ai2 = aiBudget(db.database, fakeAnthropic([answer]).client);
    for (let i = 0; i < 3; i++) await expect(ai2.open(caller, 'copilot')).rejects.toMatchObject({ scope: 'user' });
    db.today.user_tokens = 0;
    await ai2.open(caller, 'copilot');
    await ai2.open(caller, 'copilot');
  });

  it('sets max_tokens per use, records real usage (cached input included) and re-checks before every further call', async () => {
    const db = fakeAiDatabase();
    const model = fakeAnthropic([{ ...answer, usage: { input_tokens: 100, output_tokens: 40, cache_read_input_tokens: 7, cache_creation_input_tokens: 3 } }]);
    const ai = aiBudget(db.database, model.client);
    const session = await ai.open(caller, 'vave_should_cost');
    await session.create({ ...ask, max_tokens: 64_000 } as never);
    expect(model.requests[0].max_tokens).toBe(AI_MAX_TOKENS.vave_should_cost);
    expect(db.rpcCalls).toEqual([
      { fn: 'ai_usage_today', args: { p_organization_id: 'org-1' } },
      { fn: 'ai_usage_record', args: { p_organization_id: 'org-1', p_input_tokens: 110, p_output_tokens: 40 } },
    ]);

    // spent mid-request: the next call is refused before it reaches the model
    db.today.user_tokens = 1_000;
    await expect(session.create(ask)).rejects.toMatchObject({ scope: 'user' });
    expect(model.requests).toHaveLength(1);
    session.close();
  });

  it('records the usage of a stream that fails midway', async () => {
    const db = fakeAiDatabase();
    const failing = {
      messages: {
        stream: () => ({
          on: () => undefined,
          currentMessage: { usage: { input_tokens: 50, output_tokens: 20, cache_read_input_tokens: null, cache_creation_input_tokens: null } },
          finalMessage: async () => {
            throw new Error('connection reset');
          },
        }),
      },
    };
    const session = await aiBudget(db.database, failing).open(caller, 'copilot');
    await expect(session.stream(ask, () => undefined)).rejects.toThrow('connection reset');
    expect(db.rpcCalls.at(-1)).toEqual({ fn: 'ai_usage_record', args: { p_organization_id: 'org-1', p_input_tokens: 50, p_output_tokens: 20 } });
  });

  it('fails the request when usage cannot be recorded, and maps "not a member" to 403', async () => {
    const recordFails = fakeClient(() => ({ data: null, error: null }), (fn) =>
      fn === 'ai_usage_record' ? { data: null, error: { message: 'down' } } : { data: [{ user_tokens: 0, organization_tokens: 0, global_tokens: 0 }], error: null });
    const ai = aiBudget({ getUserClient: () => recordFails.client } as unknown as DatabaseService, fakeAnthropic([answer]).client);
    const session = await ai.open(caller, 'copilot');
    await expect(session.create(ask)).rejects.toThrow(ServiceUnavailableException);

    const notMember = fakeClient(() => ({ data: null, error: null }), () => ({ data: null, error: { message: 'not a member', code: '42501' } }));
    const ai2 = aiBudget({ getUserClient: () => notMember.client } as unknown as DatabaseService, fakeAnthropic([answer]).client);
    await expect(ai2.open(caller, 'copilot')).rejects.toThrow(ForbiddenException);
  });
});
