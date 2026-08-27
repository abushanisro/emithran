// Focused regression test for the removeAll() user-scoping bug fix: it
// previously deleted every user's lhr_records (admin client, no user_id
// filter) despite being documented and routed as "delete current user's
// records only". Mocked-dependency pattern matches
// bom-items.currency.spec.ts's established convention.
import { LHRService } from './lhr.service';
import { type Logger } from '../../common/logger/logger.service';
import { type SupabaseService } from '../../common/supabase/supabase.service';
import { type ExchangeRateService } from '../../common/exchange-rate/exchange-rate.service';

describe('LHRService.removeAll', () => {
  it('scopes the delete to the calling user_id, not every user', async () => {
    const eqMock = jest.fn().mockReturnThis();
    const selectMock = jest.fn().mockResolvedValue({ data: [{ id: 'a' }, { id: 'b' }], error: null });
    const deleteMock = jest.fn().mockReturnValue({ eq: eqMock, select: selectMock });
    const fromMock = jest.fn().mockReturnValue({ delete: deleteMock });
    const adminClient = { from: fromMock };

    const supabaseService = {
      getAdminClient: jest.fn().mockReturnValue(adminClient),
    } as unknown as SupabaseService;

    const service = new LHRService(
      supabaseService,
      { log: jest.fn(), error: jest.fn() } as unknown as Logger,
      {} as unknown as ExchangeRateService,
    );

    const result = await service.removeAll('user-123', 'token');

    expect(fromMock).toHaveBeenCalledWith('lhr_records');
    expect(eqMock).toHaveBeenCalledWith('user_id', 'user-123');
    expect(result).toEqual({ deleted: 2 });
  });
});

// getEffectiveRate() backs the MHR form's live "Skill Rate" preview and
// mhr.service.ts's own snapshot-on-save — it must mirror the same
// shop-average-then-benchmark precedence bom-items.service.ts's
// resolveLHRRates()/pickLHR() already use for real quote costing, and must
// never default to 0 (a preview that lies about "no data" is worse than one
// that says so plainly).
describe('LHRService.getEffectiveRate', () => {
  function makeShopQuery(shopRows: any[] | null) {
    const eq2 = jest.fn().mockResolvedValue({ data: shopRows, error: null });
    const eq1 = jest.fn().mockReturnValue({ eq: eq2 });
    const select = jest.fn().mockReturnValue({ eq: eq1 });
    return { select };
  }

  function makeBenchmarkQuery(benchmarkRows: any[] | null) {
    const limit = jest.fn().mockResolvedValue({ data: benchmarkRows, error: null });
    const eq2 = jest.fn().mockReturnValue({ limit });
    const eq1 = jest.fn().mockReturnValue({ eq: eq2 });
    const select = jest.fn().mockReturnValue({ eq: eq1 });
    return { select };
  }

  function makeService(shopRows: any[] | null, benchmarkRows: any[] | null) {
    const shopQuery = makeShopQuery(shopRows);
    const benchmarkQuery = makeBenchmarkQuery(benchmarkRows);

    const supabaseService = {
      getClient: jest.fn().mockReturnValue({ from: jest.fn().mockReturnValue(shopQuery) }),
      getAdminClient: jest.fn().mockReturnValue({ from: jest.fn().mockReturnValue(benchmarkQuery) }),
    } as unknown as SupabaseService;

    return new LHRService(
      supabaseService,
      { log: jest.fn(), error: jest.fn() } as unknown as Logger,
      {} as unknown as ExchangeRateService,
    );
  }

  it('falls back to lhr_benchmark_rates when no shop lhr_records exist', async () => {
    const service = makeService([], [{ lhr_usd_effective: 42 }]);

    const result = await service.getEffectiveRate('USA', 'Sheet Metal', 'token');

    expect(result).toEqual({ rateUsdPerHr: 42, source: 'benchmark', sampleSize: 0 });
  });

  it('averages the shop\'s own lhr_records over the benchmark when both exist', async () => {
    const service = makeService(
      [{ lhr: null, lhr_usd_effective: 30 }, { lhr: null, lhr_usd_effective: 50 }],
      [{ lhr_usd_effective: 999 }],
    );

    const result = await service.getEffectiveRate('USA', 'Sheet Metal', 'token');

    expect(result).toEqual({ rateUsdPerHr: 40, source: 'shop_average', sampleSize: 2 });
  });

  it('returns null with source "none" when nothing is on file', async () => {
    const service = makeService([], []);

    const result = await service.getEffectiveRate('USA', 'Sheet Metal', 'token');

    expect(result).toEqual({ rateUsdPerHr: null, source: 'none', sampleSize: 0 });
  });
});
