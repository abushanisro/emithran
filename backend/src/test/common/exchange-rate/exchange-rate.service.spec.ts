import { ForbiddenException, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditService } from '../../../common/audit/audit.service';
import { ExchangeRateService, FX_RATE_CHANGE_NEEDS_CONFIRMATION } from '../../../common/exchange-rate/exchange-rate.service';

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
  // The audit trail is the real AuditService; its database is the record_audit_event() function, captured here.
  const audited: any[] = [];
  const auditDatabase = {
    getPrivilegedClient: () => ({ rpc: async (_fn: string, row: unknown) => { audited.push(row); return { error: null }; } }),
  } as any;
  const config = new ConfigService({ FX_RATE_MAX_CHANGE_PERCENT: 10 });
  return { service: new ExchangeRateService(databaseService, directory, config, new AuditService(auditDatabase)), calls, audited };
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
    await service.setRate('tokenA', ORG_A, 'EUR', 0.84, 'FY27 budget');
    expect(calls.privileged).toBe(0);
    expect(calls.rpc.find((c) => c.fn === 'set_organization_exchange_rate')?.args).toEqual({
      p_organization_id: ORG_A, p_currency: 'EUR', p_rate: 0.84, p_reason: 'FY27 budget',
    });
    expect((await service.getSnapshot('tokenA', ORG_A)).convertStrict('USD', 'EUR')).toBeCloseTo(0.84, 9);
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

  it('refuses a change beyond FX_RATE_MAX_CHANGE_PERCENT of the current rate unless confirmed, and writes nothing', async () => {
    const own: Record<string, Array<{ currency: string; rate: number }>> = {};
    const { service, calls, audited } = makeService(own, { tokenA: [ORG_A] });
    // the global default is 1 USD = 80 INR; 8 is a misplaced decimal point (-90%)
    const refusal = service.setRate('tokenA', ORG_A, 'INR', 8, 'typo');
    await expect(refusal).rejects.toThrow(UnprocessableEntityException);
    await expect(refusal).rejects.toMatchObject({
      response: { code: FX_RATE_CHANGE_NEEDS_CONFIRMATION, details: { currency: 'INR', currentRate: 80, rate: 8, maxChangePercent: 10 } },
    });
    expect(calls.rpc.some((c) => c.fn === 'set_organization_exchange_rate')).toBe(false);
    expect(audited).toEqual([]);

    // within the limit it applies; beyond it with the explicit confirmation it applies too
    await service.setRate('tokenA', ORG_A, 'INR', 84, 'small revision');
    await service.setRate('tokenA', ORG_A, 'INR', 120, 'devaluation', true);
    expect(own[ORG_A]).toEqual([{ currency: 'INR', rate: 120 }]);
  });

  it('records every change in the audit trail with the previous rate', async () => {
    const { service, audited } = makeService({ [ORG_A]: [{ currency: 'EUR', rate: 0.85 }] }, { tokenA: [ORG_A] });
    await service.setRate('tokenA', ORG_A, 'eur', 0.86, 'FY27 budget');
    expect(audited).toEqual([
      expect.objectContaining({
        p_action: 'fx_rate.changed',
        p_org: ORG_A,
        p_target_type: 'exchange_rate',
        p_target_id: 'EUR',
        p_outcome: 'ok',
        p_meta: { currency: 'EUR', rate: 0.86, previousRate: 0.85, reason: 'FY27 budget', confirmed: false },
      }),
    ]);
  });
});
