// Org-scoped tenancy Phase 5 (the internal plan):
// proves the org-scoping fix on process_plan_generations — organization_id
// is written on insert, and the read/discard paths no longer manually
// filter/check user_id (that would wrongly exclude an org-mate's
// generations once RLS enforces the org boundary instead).
import { OrchestratorService } from '../../../../modules/process-plan-generator/services/orchestrator.service';
import { type SupabaseService } from '../../../../common/supabase/supabase.service';
import { InProcessEventBus } from '../../../../common/events/event-bus';

function makeChain(result: { data: any; error: any }) {
  const chain: any = {};
  for (const m of ['select', 'eq', 'in', 'order', 'limit', 'insert', 'update', 'delete']) {
    chain[m] = jest.fn().mockReturnValue(chain);
  }
  chain.single = jest.fn().mockResolvedValue(result);
  chain.maybeSingle = jest.fn().mockResolvedValue(result);
  chain.then = (resolve: any) => resolve(result);
  return chain;
}

function makeService(fromMock: jest.Mock) {
  const supabaseService = {
    getUserClient: jest.fn().mockReturnValue({ from: fromMock }),
  } as unknown as SupabaseService;

  return new OrchestratorService(
    supabaseService,
    {} as any, // retrieval
    {} as any, // reasoning
    {} as any, // resolver
    {} as any, // deterministicPlanner
    {} as any, // alternativeRoutePlanner
    {} as any, // kb
    {} as any, // processValidation
    new InProcessEventBus(),
  );
}

describe('OrchestratorService (private) insertGenerationRow', () => {
  it('writes organization_id on the inserted row', async () => {
    const insertChain = makeChain({ data: { id: 'gen-1' }, error: null });
    const fromMock = jest.fn().mockReturnValue(insertChain);
    const service = makeService(fromMock);

    await (service as any).insertGenerationRow({ from: fromMock }, {
      bomItemId: 'item-1',
      userId: 'user-456',
      organizationId: 'org-789',
      idempotencyKey: 'key-1',
      status: 'running',
      model: 'deterministic',
      scopeDecision: {},
      brief: {},
      candidates: {},
      toolCalls: [],
      abstractPlan: null,
      draftLines: null,
      proposedMasters: null,
      tokensIn: 0,
      tokensOut: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      errorMessage: null,
      errorStage: null,
      completed: false,
    });

    expect(insertChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'user-456', organization_id: 'org-789' }),
    );
  });
});

describe('OrchestratorService.discard', () => {
  it('does not manually filter/check user_id (RLS enforces org scope)', async () => {
    const selectChain = makeChain({ data: { id: 'gen-1', status: 'draft_ready' }, error: null });
    const updateChain = makeChain({ data: null, error: null });
    const fromMock = jest.fn()
      .mockReturnValueOnce(selectChain)
      .mockReturnValueOnce(updateChain);
    const service = makeService(fromMock);

    await service.discard('gen-1', 'user-456', 'token-abc');

    expect(selectChain.eq).not.toHaveBeenCalledWith('user_id', expect.anything());
  });
});

describe('OrchestratorService.getLatestDraft', () => {
  it('does not manually filter by user_id (RLS enforces org scope)', async () => {
    const chain = makeChain({ data: null, error: null });
    const fromMock = jest.fn().mockReturnValue(chain);
    const service = makeService(fromMock);

    await service.getLatestDraft('item-1', 'user-456', 'token-abc');

    expect(chain.eq).not.toHaveBeenCalledWith('user_id', expect.anything());
  });
});

describe('OrchestratorService SSE through the event bus', () => {
  it('a stream receives events published for its (user, item) channel and completes when the generation ends', async () => {
    const bus = new InProcessEventBus();
    const service = new OrchestratorService({} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, bus);
    const seen: string[] = [];
    const done = new Promise<void>((resolve) => {
      service.streamFor('item-1', 'user-1').subscribe({ next: (e) => seen.push(String(e.type)), complete: () => resolve() });
    });
    const key = (service as any).streamKey('item-1', 'user-1');
    (service as any).emit((service as any).streamKey('item-2', 'user-1'), { type: 'scope_decided', data: {} }); // another item
    (service as any).emit(key, { type: 'draft_ready', data: { generationId: 'g1' } });
    (service as any).closeStream(key);
    await done;
    expect(seen).toEqual(['draft_ready']);
  });
});
