import { InternalServerErrorException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ProductionPlanningService } from '../../../modules/production-planning/production-planning.service';
import { fakeClient, type Call, type Result } from '../../support/fake-db-client';

// The service imports through the '@/' path alias, which this Jest setup does not map: point each at the real file.
jest.mock('@/common/database/database.service', () => ({ DatabaseService: class {} }), { virtual: true });
jest.mock('@/common/validators/uuid.validator', () => jest.requireActual('../../../common/validators/uuid.validator'), { virtual: true });
jest.mock('@/common/decorators/validate-input.decorator',
  () => jest.requireActual('../../../common/decorators/validate-input.decorator'), { virtual: true });

const OWNER = 'owner-1';
const service = (client: unknown) => new ProductionPlanningService({ getUserClient: () => client } as any);

/** A database with one process in one lot whose BOM belongs to OWNER. */
const ownedProcess = (call: Call): Result => {
  if (call.table === 'production_processes' && call.op === 'select') return { data: { id: 'proc-1', production_lot_id: 'lot-1' }, error: null };
  if (call.table === 'production_lots' && call.op === 'select') {
    const owner = call.filters.find(([column]) => column === 'boms.user_id')?.[1];
    return { data: owner === OWNER ? { id: 'lot-1' } : null, error: null };
  }
  if (call.table === 'production_processes' && call.op === 'update') return { data: { id: 'proc-1' }, error: null };
  return { data: null, error: null };
};

describe('ProductionPlanningService process ownership', () => {
  it('lets the BOM owner update a process', async () => {
    const { client, calls } = fakeClient(ownedProcess);
    await service(client).updateProductionProcess('proc-1', { status: 'in_progress' } as any, OWNER);
    expect(calls.some(c => c.table === 'production_processes' && c.op === 'update')).toBe(true);
  });

  it('refuses another user and changes nothing', async () => {
    const { client, calls } = fakeClient(ownedProcess);
    await expect(service(client).updateProductionProcess('proc-1', { status: 'done' } as any, 'someone-else')).rejects.toThrow(NotFoundException);
    await expect(service(client).deleteProductionProcess('proc-1', 'someone-else')).rejects.toThrow(NotFoundException);
    expect(calls.filter(c => c.op === 'update' || c.op === 'delete')).toEqual([]);
  });

  it('fails closed without a user', async () => {
    const { client, calls } = fakeClient(ownedProcess);
    await expect(service(client).deleteProductionProcess('proc-1', '')).rejects.toThrow(UnauthorizedException);
    expect(calls.filter(c => c.op === 'delete')).toEqual([]);
  });

  it('refuses a process whose lot has no BOM owned by the user', async () => {
    const { client } = fakeClient(call =>
      call.table === 'production_lots' ? { data: null, error: null } : ownedProcess(call));
    await expect(service(client).updateProductionProcess('proc-1', {} as any, OWNER)).rejects.toThrow(NotFoundException);
  });

  it('surfaces a failed ownership query instead of allowing the change', async () => {
    const { client, calls } = fakeClient(call =>
      call.table === 'production_lots' ? { data: null, error: { message: 'boom' } } : ownedProcess(call));
    await expect(service(client).deleteProductionProcess('proc-1', OWNER)).rejects.toThrow(InternalServerErrorException);
    expect(calls.filter(c => c.op === 'delete')).toEqual([]);
  });
});

describe('ProductionPlanningService.createProductionLot', () => {
  const dto = {
    bomId: 'bom-1', lotNumber: 'L1', productionQuantity: 1, plannedStartDate: '2026-01-01', plannedEndDate: '2026-02-01',
    selectedBomItemIds: ['item-1'],
  } as any;

  it('removes the lot and fails when the selected BOM items cannot be stored (missing table)', async () => {
    const { client, calls } = fakeClient(call => {
      if (call.table === 'boms') return { data: { id: 'bom-1', user_id: OWNER }, error: null };
      if (call.table === 'production_lots' && call.op === 'select') return { data: null, error: null };
      if (call.table === 'production_lots' && call.op === 'insert') return { data: { id: 'lot-1' }, error: null };
      if (call.table === 'production_lot_bom_items') {
        return { data: null, error: { message: "Could not find the table 'public.production_lot_bom_items' in the schema cache" } };
      }
      return { data: null, error: null };
    }, () => ({ data: 0, error: null }));
    await expect(service(client).createProductionLot(dto, OWNER)).rejects.toThrow(InternalServerErrorException);
    expect(calls.some(c => c.table === 'production_lots' && c.op === 'delete' && c.filters[0][1] === 'lot-1')).toBe(true);
    expect(calls.some(c => c.table === 'production_processes')).toBe(false);
  });
});

describe('ProductionPlanningService.getSubtasksDirectByLot', () => {
  it('returns the stored BOM requirements of each subtask', async () => {
    const { client } = fakeClient(call => {
      if (call.table === 'production_lots') return { data: { id: 'lot-1' }, error: null };
      if (call.table === 'production_processes') return { data: [{ id: 'proc-1' }], error: null };
      if (call.table === 'process_subtasks') {
        return { data: [{
          id: 'st-1', production_process_id: 'proc-1', task_name: 'Cut', task_sequence: 1, status: 'pending',
          bom_requirements: [{
            id: 'req-1', bom_item_id: 'item-1', required_quantity: 4, unit: 'pcs', requirement_status: 'pending',
            bom_item: { id: 'item-1', part_number: 'P-1', name: 'Bracket', description: 'd' },
          }],
        }], error: null };
      }
      return { data: null, error: null };
    });
    const [subtask] = await service(client).getSubtasksDirectByLot('lot-1', OWNER);
    expect(subtask.bomRequirements).toEqual([{
      id: 'req-1', bomItemId: 'item-1', partNumber: 'P-1', partName: 'Bracket', description: 'd',
      requiredQuantity: 4, unit: 'pcs', status: 'pending',
    }]);
  });

  it('returns nothing for a lot without processes instead of subtasks from other lots', async () => {
    const { client, calls } = fakeClient(call => {
      if (call.table === 'production_lots') return { data: { id: 'lot-1' }, error: null };
      if (call.table === 'production_processes') return { data: [], error: null };
      return { data: [{ id: 'someone-elses-subtask' }], error: null };
    });
    await expect(service(client).getSubtasksDirectByLot('lot-1', OWNER)).resolves.toEqual([]);
    expect(calls.some(c => c.table === 'process_subtasks')).toBe(false);
  });
});
