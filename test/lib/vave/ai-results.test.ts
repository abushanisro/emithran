import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseAiJson, requestAiText, VAVE_AI_MODEL } from '@/lib/server/anthropic';
import {
  AiResultError,
  costAnalysisFromAi,
  ideasFromAi,
  SHOULD_COST_SOURCE,
  shouldCostFromAi,
} from '@/lib/vave/ai-results';

describe('shouldCostFromAi', () => {
  it('uses the AI estimate and derives the delta from the real price', () => {
    const r = shouldCostFromAi({ unitCost: 10 }, { shouldCost: 8, materialCost: 4, processCost: 3 });
    expect(r.shouldCost).toBe(8);
    expect(r.delta).toBe(2);
    expect(r.deltaPct).toBe(20);
    expect(r.materialCost).toBe(4);
    expect(r.processCost).toBe(3);
    // Not returned by the AI: unknown, not a ratio of the price.
    expect(r.overhead).toBeNull();
    expect(r.margin).toBeNull();
    expect(r.benchmarkSource).toBe(SHOULD_COST_SOURCE);
    expect(r.benchmarkSource).not.toMatch(/bottom-up model \(/i);
  });

  it('is independent of the current price (no ratio model)', () => {
    const a = shouldCostFromAi({ unitCost: 10 }, { shouldCost: 8 });
    const b = shouldCostFromAi({ unitCost: 1000 }, { shouldCost: 8 });
    expect(a.shouldCost).toBe(b.shouldCost);
  });

  it('has no delta percentage when there is no current price', () => {
    expect(shouldCostFromAi({ unitCost: 0 }, { shouldCost: 8 }).deltaPct).toBeNull();
  });

  it.each([null, [], {}, { shouldCost: 0 }, { shouldCost: -1 }, { shouldCost: 'abc' }])(
    'throws on an unusable answer: %j',
    (answer) => {
      expect(() => shouldCostFromAi({ unitCost: 10 }, answer)).toThrow(AiResultError);
    },
  );
});

describe('costAnalysisFromAi', () => {
  const spend = new Map([['PN1', 100], ['PN2', 50]]);

  it('keeps the groups and sums their spend from the BOM', () => {
    const r = costAnalysisFromAi(
      { affinityGroups: [{ name: 'Fasteners', parts: ['PN1', 'PN2', 'PNX'], totalCost: 999 }], focusAreas: ['a'] },
      spend,
    );
    expect(r.affinityGroups[0]?.totalCost).toBe(150);
    expect(r.focusAreas).toEqual(['a']);
    expect(r.qfdMatrix).toBeUndefined();
  });

  it.each([null, 'text', {}, { affinityGroups: [] }, { focusAreas: [] }])(
    'throws instead of returning empty groups: %j',
    (answer) => {
      expect(() => costAnalysisFromAi(answer, spend)).toThrow(AiResultError);
    },
  );
});

describe('ideasFromAi', () => {
  it('leaves missing or invalid ratings unset instead of defaulting them', () => {
    const [idea] = ideasFromAi([{ title: 'Swap steel', feasibility: 'Very high', complexity: 'L9' }]);
    expect(idea).toBeDefined();
    expect(idea).not.toHaveProperty('feasibility');
    expect(idea).not.toHaveProperty('complexity');
    expect(idea).not.toHaveProperty('risk');
    expect(idea).not.toHaveProperty('framework');
    expect(idea).not.toHaveProperty('estSavingsUsd');
    expect(idea?.status).toBe('draft');
  });

  it('keeps valid ratings and amounts', () => {
    const [idea] = ideasFromAi([{
      title: 'T', framework: 'TRIZ', feasibility: 'High', complexity: 'L1', risk: 'Low',
      estSavingsUsd: 1200, estInvestmentUsd: 0, timeToImplementMonths: 4,
    }]);
    expect(idea).toMatchObject({
      framework: 'TRIZ', feasibility: 'High', complexity: 'L1', risk: 'Low',
      estSavingsUsd: 1200, estInvestmentUsd: 0, timeToImplementMonths: 4,
    });
  });

  it.each([null, {}, 'ideas'])('throws on a non-array answer: %j', (answer) => {
    expect(() => ideasFromAi(answer)).toThrow(AiResultError);
  });
});

describe('requestAiText', () => {
  beforeEach(() => vi.stubEnv('ANTHROPIC_API_KEY', 'test-key'));
  afterEach(() => vi.unstubAllEnvs());

  it('returns 503 "not configured" without calling the API when the key is unset', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    const fetchImpl = vi.fn<typeof fetch>();
    const r = await requestAiText('hi', fetchImpl);
    expect(r).toMatchObject({ ok: false, status: 503 });
    expect(!r.ok && r.error).toMatch(/ANTHROPIC_API_KEY/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('sends the current model and joins only the text blocks', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({
      stop_reason: 'end_turn',
      content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '{"a":' }, { type: 'text', text: '1}' }],
    }));
    const r = await requestAiText('hi', fetchImpl);
    expect(r).toEqual({ ok: true, text: '{"a":1}' });
    const body = JSON.parse(fetchImpl.mock.calls[0]?.[1]?.body as string) as { model: string };
    expect(body.model).toBe(VAVE_AI_MODEL);
    expect(body.model).not.toMatch(/claude-3/);
  });

  it('reports upstream errors, refusals and empty answers as errors', async () => {
    const upstream = await requestAiText('hi', vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 401 })));
    expect(upstream).toMatchObject({ ok: false, status: 502 });
    const refusal = await requestAiText('hi', vi.fn<typeof fetch>().mockResolvedValue(Response.json({ stop_reason: 'refusal', content: [] })));
    expect(refusal).toMatchObject({ ok: false, status: 502 });
    const empty = await requestAiText('hi', vi.fn<typeof fetch>().mockResolvedValue(Response.json({ content: [] })));
    expect(empty).toMatchObject({ ok: false, status: 502 });
  });
});

describe('parseAiJson', () => {
  it('strips a json fence and throws on non-JSON', () => {
    expect(parseAiJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(() => parseAiJson('sorry, I cannot')).toThrow();
  });
});
