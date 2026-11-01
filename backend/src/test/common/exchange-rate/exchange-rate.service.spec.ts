import { ForbiddenException } from '@nestjs/common';
import { ExchangeRateService } from '../../../common/exchange-rate/exchange-rate.service';

// Budget rates are per organization (migration 940): an organization's own rate overrides the global default for that
// organization only; the global table is never written by the service.
const ORG_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const ORG_B = 'bbbbbbbb-0000-4000-8000-000000000002';

const GLOBAL = [
  { to_currency: 'EUR', rate: 0.8, currency_name: 'Euro', effective_date: '2026-01-06', source_active: true, source_modified_by: 'ref', source_modified_at: null, updated_at: 't0' },
  { to_currency: 'INR', rate: 80, currency_name: 'Indian Rupee', effective_date: '2017-12-11', source_active: false, source_modified_by: 'ref', source_modified_at: null, updated_at: 't0' },
];

/** org id → that organization's own active rates; a token not in `members` is refused like the 940 function refuses non-members. */
function makeService(own: Record<string, Array<{ currency: string; rate: number }>>, members: Record<string, string[]>) {
  const calls = { rpc: [] as Array<{ fn: string; args: any; token: string }>, privileged: 0 };
  const client = (token: string) => {
    const query: any = {
      select: () => query,
      eq: () => query,
      order: () => query,
      then: (resolve: (v: unknown) => unknown) => resolve({ data: GLOBAL, error: null }),
    };
    return {
      from: () => query,
      rpc: async (fn: string, args: any) => {
        calls.rpc.push({ fn, args, token });
        if (!(members[token] ?? []).includes(args.p_organization_id)) {
          return { data: null, error: { code: '42501', message: 'not a member' } };
        }
        if (fn === 'set_organization_exchange_rate') {
          own[args.p_organization_id] = [...(own[args.p_organization_id] ?? []).filter((r) => r.currency !== args.p_currency), { currency: args.p_currency, rate: args.p_rate }];
          return { data: null, error: null };
        }
        return {
          data: (own[args.p_organization_id] ?? []).map((r) => ({ ...r, set_by: 'user-a', reason: 'budget', effective_date: '2026-11-01', updated_at: 't1' })),
          error: null,
        };
      },
    };
  };
  const databaseService = {
    getUserClient: (token: string) => client(token),
    getPrivilegedClient: () => {
      calls.privileged++;
      throw new Error('the privileged client must not be used');
    },
  } as any;
  const directory = { findByIds: async (ids: string[]) => new Map(ids.map((id) => [id, { email: `${id}@example.com` }])) } as any;
  return { service: new ExchangeRateService(databaseService, directory), calls };
}

describe('ExchangeRateService — budget rates per organization', () => {
  it("uses the organization's own rate for that organization only; others keep the global default", async () => {
    const { service } = makeService({ [ORG_A]: [{ currency: 'EUR', rate: 1000 }] }, { tokenA: [ORG_A], tokenB: [ORG_B] });
    const a = await service.getSnapshot('tokenA', ORG_A);
    const b = await service.getSnapshot('tokenB', ORG_B);
    expect(a.convertStrict('USD', 'EUR')).toBeCloseTo(1000, 9);
    expect(b.convertStrict('USD', 'EUR')).toBeCloseTo(0.8, 9);
    expect(a.convertStrict('USD', 'INR')).toBeCloseTo(80, 9); // no own INR rate: the default
    expect(a.organizationId).toBe(ORG_A);
  });

  it('without an organization the snapshot holds the global defaults and says so', async () => {
    const { service, calls } = makeService({ [ORG_A]: [{ currency: 'EUR', rate: 1000 }] }, { tokenA: [ORG_A] });
    const snapshot = await service.getSnapshot('tokenA', null);
    expect(snapshot.organizationId).toBeNull();
    expect(snapshot.convertStrict('USD', 'EUR')).toBeCloseTo(0.8, 9);
    expect(calls.rpc).toHaveLength(0);
  });

  it("refuses a caller who is not a member, even when that organization's rates are cached", async () => {
    const { service } = makeService({ [ORG_A]: [{ currency: 'EUR', rate: 1000 }] }, { tokenA: [ORG_A], tokenB: [ORG_B] });
    await service.getSnapshot('tokenA', ORG_A); // cached for A's member
    await expect(service.getSnapshot('tokenB', ORG_A)).rejects.toThrow(ForbiddenException);
  });

  it("writes the caller's organization's rate through the user client, never the privileged one, and reads it back at once", async () => {
    const own: Record<string, Array<{ currency: string; rate: number }>> = {};
    const { service, calls } = makeService(own, { tokenA: [ORG_A], tokenB: [ORG_B] });
    expect((await service.getSnapshot('tokenA', ORG_A)).convertStrict('USD', 'EUR')).toBeCloseTo(0.8, 9);
    await service.setRate('tokenA', ORG_A, 'EUR', 0.9, 'FY27 budget');
    expect(calls.privileged).toBe(0);
    expect(calls.rpc.find((c) => c.fn === 'set_organization_exchange_rate')?.args).toEqual({
      p_organization_id: ORG_A, p_currency: 'EUR', p_rate: 0.9, p_reason: 'FY27 budget',
    });
    expect((await service.getSnapshot('tokenA', ORG_A)).convertStrict('USD', 'EUR')).toBeCloseTo(0.9, 9);
    expect((await service.getSnapshot('tokenB', ORG_B)).convertStrict('USD', 'EUR')).toBeCloseTo(0.8, 9);
    await expect(service.setRate('tokenB', ORG_A, 'EUR', 5, 'cross-tenant')).rejects.toThrow(ForbiddenException);
  });

  it('lists every default currency with the organization rate and its provenance where one is set', async () => {
    const { service } = makeService({ [ORG_A]: [{ currency: 'EUR', rate: 1000 }] }, { tokenA: [ORG_A] });
    const rows = await service.listRates('tokenA', ORG_A);
    expect(rows.find((r) => r.currency === 'EUR')).toMatchObject({
      rate: 1000, source: 'organization', defaultRate: 0.8, editedBy: 'user-a@example.com', editReason: 'budget',
    });
    expect(rows.find((r) => r.currency === 'INR')).toMatchObject({ rate: 80, source: 'default', defaultRate: 80, editedBy: null });
  });
});
