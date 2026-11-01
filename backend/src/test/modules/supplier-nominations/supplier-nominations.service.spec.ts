import { BadRequestException, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { SupplierNominationsService } from '../../../modules/supplier-nominations/supplier-nominations.service';
import { NominationType } from '../../../modules/supplier-nominations/dto/supplier-nomination.dto';
import { fakeClient } from '../../support/fake-db-client';

jest.mock('../../../common/database/database.service', () => ({ DatabaseService: class {} }));
jest.mock('../../../common/logger/logger.service', () => ({ Logger: class {} }));

const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
const service = (client: unknown) =>
  new SupplierNominationsService({ getClient: () => client } as any, logger as any, {} as any, {} as any);

const NOMINATION = { id: 'n1', user_id: 'u1', nomination_name: 'N', nomination_type: 'manufacturer', status: 'draft', project_id: 'p1' };

describe('SupplierNominationsService.findOne', () => {
  it('throws NotFound for a missing nomination and never lists other nominations', async () => {
    const { client, calls } = fakeClient(() => ({ data: null, error: null }));
    await expect(service(client).findOne('u1', 'missing', 'token')).rejects.toThrow(NotFoundException);
    expect(calls).toHaveLength(1);
    expect(calls[0].filters).toEqual([['id', 'missing'], ['user_id', 'u1']]);
  });

  it('surfaces a query failure instead of returning a placeholder nomination', async () => {
    const { client, calls } = fakeClient(() => ({ data: null, error: { message: 'boom' } }));
    await expect(service(client).findOne('u1', 'n1', 'token')).rejects.toThrow(InternalServerErrorException);
    expect(calls).toHaveLength(1);
  });
});

describe('SupplierNominationsService.create', () => {
  const dto = {
    nominationName: 'N', nominationType: NominationType.MANUFACTURER, projectId: 'p1',
    bomParts: [{ bomItemId: 'b1', bomItemName: 'B', partNumber: 'P', quantity: 1 }],
  } as any;

  it('removes the nomination and fails when its BOM parts cannot be created', async () => {
    const { client, calls } = fakeClient(call => {
      if (call.table === 'supplier_nomination_evaluations' && call.op === 'insert') return { data: NOMINATION, error: null };
      if (call.table === 'supplier_nomination_bom_parts') return { data: null, error: { message: 'bad part' } };
      return { data: null, error: null };
    });
    await expect(service(client).create('u1', dto, 'token')).rejects.toThrow(/bad part/);
    expect(calls.some(c => c.table === 'supplier_nomination_evaluations' && c.op === 'delete' && c.filters[0][1] === 'n1')).toBe(true);
  });

  it('reports when the half-created nomination cannot be removed either', async () => {
    const { client } = fakeClient(call => {
      if (call.table === 'supplier_nomination_evaluations' && call.op === 'insert') return { data: NOMINATION, error: null };
      if (call.table === 'supplier_nomination_evaluations' && call.op === 'delete') return { data: null, error: { message: 'denied' } };
      if (call.table === 'supplier_nomination_bom_parts') return { data: null, error: { message: 'bad part' } };
      return { data: null, error: null };
    });
    await expect(service(client).create('u1', dto, 'token')).rejects.toThrow(/could not be removed/);
  });
});

describe('SupplierNominationsService.getFactorWeights', () => {
  it('keeps a weight of zero instead of replacing it with the default', async () => {
    const { client } = fakeClient(
      () => ({ data: { id: 'n1' }, error: null }),
      () => ({ data: { costFactor: 0, developmentCostFactor: 50, leadTimeFactor: 50 }, error: null }),
    );
    await expect(service(client).getFactorWeights('u1', 'n1', 'token'))
      .resolves.toEqual({ costFactor: 0, developmentCostFactor: 50, leadTimeFactor: 50 });
  });
});

describe('SupplierNominationsService.updateCostAnalysis', () => {
  const components = [{ costComponent: 'Net Price/unit', baseValue: 1, vendorValues: [{ vendorId: 'v1', numericValue: 2 }] }];

  it('sends the whole batch to the database in one atomic call', async () => {
    const { client, calls, rpcCalls } = fakeClient(call =>
      call.table === 'cost_competency_analysis' ? { data: [], error: null } : { data: { id: 'n1' }, error: null });
    await service(client).batchUpdateCostAnalysis('u1', 'n1', { components } as any, 'token');
    expect(rpcCalls).toEqual([{ fn: 'update_cost_competency_analysis', args: { p_nomination_evaluation_id: 'n1', p_components: components } }]);
    expect(calls.filter(c => c.op === 'update')).toEqual([]);
  });

  it('fails as a whole when the database rejects the batch', async () => {
    const { client } = fakeClient(
      () => ({ data: { id: 'n1' }, error: null }),
      () => ({ data: null, error: { message: 'vendor v1 has no value for cost component "Net Price/unit"' } }),
    );
    await expect(service(client).updateCostAnalysis('u1', 'n1', { components } as any, 'token')).rejects.toThrow(BadRequestException);
  });
});
