// Org-scoped tenancy Phase 6 (.claude/plans/delegated-gliding-swan.md):
// proves create() writes organization_id on all 3 inserted rows (the group
// itself, plus its bom_items and processes rows).
import { SupplierEvaluationGroupsService } from '../../../modules/supplier-evaluation-groups/supplier-evaluation-groups.service';
import { type SupabaseService } from '../../../common/supabase/supabase.service';
import { type Logger } from '../../../common/logger/logger.service';

function makeChain(result: { data: any; error: any }) {
  const chain: any = {};
  for (const m of ['select', 'eq', 'insert', 'single']) {
    chain[m] = jest.fn().mockReturnValue(chain);
  }
  chain.single = jest.fn().mockResolvedValue(result);
  chain.then = (resolve: any) => resolve(result);
  return chain;
}

describe('SupplierEvaluationGroupsService.create', () => {
  it('writes organization_id on the group, its bom_items, and its processes', async () => {
    const groupInsert = makeChain({ data: { id: 'group-1' }, error: null });
    const bomItemsInsert = makeChain({ data: null, error: null });
    const processesInsert = makeChain({ data: null, error: null });
    const rpcChain = makeChain({
      data: [{ id: 'group-1', project_id: 'project-1', name: 'Test', bom_items: [], processes: [] }],
      error: null,
    });

    const fromMock = jest.fn().mockImplementation((table: string) => {
      if (table === 'supplier_evaluation_groups') return groupInsert;
      if (table === 'supplier_evaluation_group_bom_items') return bomItemsInsert;
      if (table === 'supplier_evaluation_group_processes') return processesInsert;
      throw new Error(`unexpected table: ${table}`);
    });

    const supabaseService = {
      getClient: jest.fn().mockReturnValue({ from: fromMock, rpc: jest.fn().mockReturnValue(rpcChain) }),
    } as unknown as SupabaseService;

    const service = new SupplierEvaluationGroupsService(
      supabaseService,
      { log: jest.fn(), error: jest.fn() } as unknown as Logger,
    );

    await service.create(
      'user-456',
      {
        projectId: 'project-1',
        name: 'Test',
        bomItems: [{ id: 'item-1', name: 'Part A', partNumber: 'P-1', material: 'Steel', quantity: 1 }],
        processes: [{ id: 'proc-1', name: 'Machining', processGroup: 'CNC', type: 'manufacturing', isPredefined: false }],
      } as any,
      'token-abc',
      'org-789',
    );

    expect(groupInsert.insert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'user-456', organization_id: 'org-789' }),
    );
    expect(bomItemsInsert.insert).toHaveBeenCalledWith([
      expect.objectContaining({ organization_id: 'org-789', bom_item_id: 'item-1' }),
    ]);
    expect(processesInsert.insert).toHaveBeenCalledWith([
      expect.objectContaining({ organization_id: 'org-789', process_id: 'proc-1' }),
    ]);
  });
});
