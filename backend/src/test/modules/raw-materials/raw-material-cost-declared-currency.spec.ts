// RawMaterialCostService.update with a declared currency: the unit cost a caller states the currency of (Apply's material record, carrying the
// cost engine's USD price per kg) is recorded with that provenance (migration 708), not left undeclared.
import { RawMaterialCostService } from '../../../modules/raw-materials/services/raw-material-cost.service';

const existing = {
  id: 'r1', material_name: 'Aluminum, ANSI 6061', unit_cost: '0', reclaim_rate: '0', gross_usage: '0.137', net_usage: '0.022', scrap: '84', overhead: '5',
  currency: null, cost_currency_basis: 'legacy_unverified', cost_currency_local: null,
};

function build() {
  const writes: Record<string, unknown>[] = [];
  const table = {
    select: () => table,
    eq: () => table,
    single: () => Promise.resolve({ data: existing, error: null }),
    update: (data: Record<string, unknown>) => {
      writes.push(data);
      const written = { select: () => ({ single: () => Promise.resolve({ data: { ...existing, ...data }, error: null }) }) };
      return { eq: () => written };
    },
  };
  const database = { getClient: () => ({ from: () => table }) };
  const logger = { log: jest.fn(), error: jest.fn(), warn: jest.fn() };
  return { svc: new RawMaterialCostService(database as never, logger as never, {} as never), writes };
}

describe('RawMaterialCostService.update: a declared currency', () => {
  it('records the stated currency as the row\'s own (basis local), with the unit cost', async () => {
    const { svc, writes } = build();
    await svc.update('r1', { unitCost: 2.955 } as never, 'u', 't', 'USD');
    expect(writes[0]).toMatchObject({ unit_cost: 2.955, currency: 'USD', cost_currency_basis: 'local', cost_currency_local: 'USD' });
  });

  it('leaves the provenance as it is when the caller states none (a hand edit of the record)', async () => {
    const { svc, writes } = build();
    await svc.update('r1', { unitCost: 3 } as never, 'u', 't');
    expect(writes[0]).not.toHaveProperty('currency');
    expect(writes[0]).not.toHaveProperty('cost_currency_basis');
  });
});
