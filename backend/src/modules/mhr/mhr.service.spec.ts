// Focused regression test for the removeAll() user-scoping bug fix: it
// previously deleted every user's mhr_records (admin client, no user_id
// filter) despite the log message already claiming "for user ${userId}" —
// and unlike the sibling LHR bug, this one was reachable live via the
// "Clear All" button on /hr-rates. Mocked-dependency pattern matches
// bom-items.currency.spec.ts's established convention.
import { MHRService } from './mhr.service';
import { type Logger } from '../../common/logger/logger.service';
import { type SupabaseService } from '../../common/supabase/supabase.service';
import { type ExchangeRateService } from '../../common/exchange-rate/exchange-rate.service';
import { type LHRService } from '../lhr/lhr.service';

function makeLhrService(
  getEffectiveRate: LHRService['getEffectiveRate'] = jest.fn().mockResolvedValue({ rateUsdPerHr: null, source: 'none', sampleSize: 0 }),
): LHRService {
  return { getEffectiveRate } as unknown as LHRService;
}

// ── Canonical MHR (2026-08-27): MHR = Total OH = Direct OH + Indirect OH ──
// A chainable Supabase mock covering the three query shapes create()/update()
// issue against mhr_records: insert().select().single(), select('*').eq().
// single() (findOne), and update().eq().select().single(). `mode` latches on
// whichever of insert/update fires first per .from() call so a fresh chain
// (one per .from() invocation) always resolves .single() with the right
// canned response, and two chains within the same update() (findOne's read,
// then the write) never interfere with each other.
function makeChainableSupabase(responses: { onSelect?: any; onInsert?: any; onUpdate?: any; onLookup?: any }) {
  let mode: 'select' | 'insert' | 'update' | null = null;
  const chain: any = {};
  chain.select = jest.fn(() => { if (mode === null) mode = 'select'; return chain; });
  chain.eq = jest.fn(() => chain);
  chain.insert = jest.fn((obj: any) => { mode = 'insert'; chain.__insertArg = obj; return chain; });
  chain.update = jest.fn((obj: any) => { mode = 'update'; chain.__updateArg = obj; return chain; });
  chain.single = jest.fn(() => {
    if (mode === 'insert') return Promise.resolve(responses.onInsert);
    if (mode === 'update') return Promise.resolve(responses.onUpdate);
    return Promise.resolve(responses.onSelect);
  });
  // Supports `await chain.select(...).eq(...)` with no terminal .single() —
  // the shape lookupMachineLibraryBenchmark()'s sm_reference_data query uses.
  // Only relevant when the chain's last real call was .eq() (not .single()),
  // since .single() already returns a real Promise independent of this.
  chain.then = (resolve: any) => resolve(responses.onLookup ?? { data: null, error: null });
  return chain;
}

function makeSupabaseService(responses: { onSelect?: any; onInsert?: any; onUpdate?: any; onLookup?: any }) {
  const chains: any[] = [];
  const fromMock = jest.fn(() => {
    const c = makeChainableSupabase(responses);
    chains.push(c);
    return c;
  });
  const client = { from: fromMock };
  return {
    service: { getClient: jest.fn().mockReturnValue(client) } as unknown as SupabaseService,
    chains,
  };
}

function makeExchangeRateService(usdPerLocalByCurrency: Record<string, number>): ExchangeRateService {
  return {
    getSnapshot: jest.fn().mockResolvedValue({
      convertStrict: (from: string) => usdPerLocalByCurrency[from] ?? 1,
    }),
  } as unknown as ExchangeRateService;
}

const testLogger = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as unknown as Logger;

describe('MHRService canonical MHR (Direct OH + Indirect OH)', () => {
  it('create(): total_machine_hour_rate = direct + indirect for a USD location, ignoring a submitted manualMHRValue', async () => {
    const { service: supabaseService, chains } = makeSupabaseService({
      onInsert: { data: { id: 'new-id', location: 'USA', currency: 'USD' }, error: null },
    });
    const service = new MHRService(supabaseService, testLogger, makeExchangeRateService({ USD: 1 }), makeLhrService());

    await service.create(
      {
        machineName: 'Test Laser', location: 'USA', commodityCode: 'FL',
        directOverheadRate: 6.35, indirectOverheadRate: 14.60, usdLhrTotal: 36.30,
        isManualEntry: true, manualMHRValue: 999, // deliberately wrong — must be overridden
      } as any,
      'user-1',
      'token',
    );

    const insertArg = chains[0].__insertArg;
    expect(insertArg.total_machine_hour_rate).toBeCloseTo(20.95, 2);
    expect(insertArg.manual_mhr_value).toBeCloseTo(20.95, 2);
  });

  it('create(): FX-converts the USD Direct+Indirect sum into the record\'s local currency (India/INR)', async () => {
    const { service: supabaseService, chains } = makeSupabaseService({
      onInsert: { data: { id: 'new-id', location: 'India', currency: 'INR' }, error: null },
    });
    // convertStrict('INR', 'USD') = 0.012 => 1 INR = $0.012 => $1 = ~83.33 INR
    const service = new MHRService(supabaseService, testLogger, makeExchangeRateService({ INR: 0.012 }), makeLhrService());

    await service.create(
      {
        machineName: 'Test Press Brake', location: 'India', commodityCode: 'PB',
        directOverheadRate: 6.35, indirectOverheadRate: 14.60, usdLhrTotal: 10,
        isManualEntry: true, manualMHRValue: 1,
      } as any,
      'user-1',
      'token',
    );

    const insertArg = chains[0].__insertArg;
    // $20.95 / 0.012 = 1745.83 INR — never the raw USD figure (20.95) stored as if it were INR.
    expect(insertArg.total_machine_hour_rate).toBeCloseTo(1745.83, 1);
    expect(insertArg.manual_mhr_value).toBeCloseTo(1745.83, 1);
  });

  it('update(): recomputes total_machine_hour_rate from the patched Direct/Indirect OH, not the old total', async () => {
    const existingRow = {
      id: '11111111-1111-4111-8111-111111111111',
      location: 'USA', currency: 'USD',
      direct_overhead_rate: 6.35, indirect_overhead_rate: 14.60,
      direct_overhead_source: 'shop_override', indirect_overhead_source: 'shop_override',
      total_machine_hour_rate: 20.95, manual_mhr_value: 20.95, is_manual_entry: true,
      calculations: JSON.stringify({ totalMachineHourRate: 20.95 }),
    };
    const { service: supabaseService, chains } = makeSupabaseService({
      onSelect: { data: existingRow, error: null },
      onUpdate: { data: { ...existingRow, location: 'USA' }, error: null },
    });
    const service = new MHRService(supabaseService, testLogger, makeExchangeRateService({ USD: 1 }), makeLhrService());

    // Only Indirect OH changes; Direct OH is untouched by this PATCH.
    await service.update(
      existingRow.id,
      { indirectOverheadRate: 20, isManualEntry: true, manualMHRValue: 999 } as any,
      'user-1',
      'token',
    );

    const updateArg = chains[1].__updateArg;
    expect(updateArg.total_machine_hour_rate).toBeCloseTo(26.35, 2); // 6.35 + 20
    expect(updateArg.manual_mhr_value).toBeCloseTo(26.35, 2);
  });

  it('update(): preserves the existing total_machine_hour_rate when a row has no Direct/Indirect OH on file at all (documented gap), instead of zeroing it', async () => {
    const existingRow = {
      id: '22222222-2222-4222-8222-222222222222',
      location: 'USA', currency: 'USD',
      direct_overhead_rate: null, indirect_overhead_rate: null,
      direct_overhead_source: null, indirect_overhead_source: null,
      total_machine_hour_rate: 1500, manual_mhr_value: null, is_manual_entry: false,
      calculations: JSON.stringify({ totalMachineHourRate: 1500 }),
    };
    const { service: supabaseService, chains } = makeSupabaseService({
      onSelect: { data: existingRow, error: null },
      onUpdate: { data: { ...existingRow }, error: null },
    });
    const service = new MHRService(supabaseService, testLogger, makeExchangeRateService({ USD: 1 }), makeLhrService());

    // Unrelated edit — e.g. correcting the machine's operator count — touches neither overhead field.
    await service.update(
      existingRow.id,
      { operators: 2, isManualEntry: true, manualMHRValue: 1500 } as any,
      'user-1',
      'token',
    );

    const updateArg = chains[1].__updateArg;
    expect(updateArg.total_machine_hour_rate).toBe(1500);
    expect(updateArg.manual_mhr_value).toBe(1500);
  });
});

// Root-caused 2026-08-30: migration 568 intended mhr.service.ts to resolve
// labor rate via LHRService.getEffectiveRate() (the same location/process-
// group-aware, shop-average-then-benchmark precedence real quote costing
// uses in bom-items.service.ts) instead of a generic, non-location-aware
// per-machine-name catalog lookup — but this wiring was never done. These
// tests prove the completed wiring and its fallback order: LHRService first,
// generic catalog lookup only when LHRService has nothing on file, generic
// zero-fallback only when neither has anything.
describe('MHRService labor rate resolution (LHR wiring completion)', () => {
  it('create(): resolves labor rate via LHRService.getEffectiveRate (shop average) when usdLhrTotal is not explicitly provided', async () => {
    const { service: supabaseService, chains } = makeSupabaseService({
      onInsert: { data: { id: 'new-id', location: 'USA', currency: 'USD' }, error: null },
    });
    const getEffectiveRate = jest.fn().mockResolvedValue({ rateUsdPerHr: 28.5, source: 'shop_average', sampleSize: 4 });
    const service = new MHRService(supabaseService, testLogger, makeExchangeRateService({ USD: 1 }), makeLhrService(getEffectiveRate));

    await service.create(
      {
        machineName: 'Test Laser', location: 'USA', processGroup: 'Laser Cutting', commodityCode: 'FL',
        directOverheadRate: 6.35, indirectOverheadRate: 14.60, // explicit, so only labor rate needs resolving
        isManualEntry: true, manualMHRValue: 999,
      } as any,
      'user-1',
      'token',
    );

    expect(getEffectiveRate).toHaveBeenCalledWith('USA', 'Laser Cutting', 'token');
    const insertArg = chains[1].__insertArg;
    expect(insertArg.usd_lhr_total).toBe(28.5);
    expect(insertArg.labor_rate_source).toBe('lhr_shop_avg');
  });

  it('create(): falls back to the generic per-machine-name catalog benchmark for labor rate only when LHRService has nothing on file', async () => {
    const { service: supabaseService, chains } = makeSupabaseService({
      onInsert: { data: { id: 'new-id', location: 'USA', currency: 'USD' }, error: null },
      onLookup: {
        data: [{ key: 'sm-1', raw: { name: 'Test Laser', direct_overhead_rate_usd_hr: 5, indirect_overhead_rate_usd_hr: 10, labor_rate_usd_hr: 42 } }],
        error: null,
      },
    });
    const getEffectiveRate = jest.fn().mockResolvedValue({ rateUsdPerHr: null, source: 'none', sampleSize: 0 });
    const service = new MHRService(supabaseService, testLogger, makeExchangeRateService({ USD: 1 }), makeLhrService(getEffectiveRate));

    await service.create(
      {
        machineName: 'Test Laser', location: 'USA', processGroup: 'Laser Cutting', commodityCode: 'FL',
        directOverheadRate: 6.35, indirectOverheadRate: 14.60,
        isManualEntry: true, manualMHRValue: 999,
      } as any,
      'user-1',
      'token',
    );

    expect(getEffectiveRate).toHaveBeenCalledWith('USA', 'Laser Cutting', 'token');
    const insertArg = chains[1].__insertArg;
    expect(insertArg.usd_lhr_total).toBe(42);
    expect(insertArg.labor_rate_source).toBe('benchmark');
  });

  it('create(): labor rate resolves to null/no_rate — never a fabricated $0 — when neither LHRService nor the catalog have anything on file (direct/indirect overhead are unaffected, since they were explicitly provided)', async () => {
    const { service: supabaseService, chains } = makeSupabaseService({
      onInsert: { data: { id: 'new-id', location: 'USA', currency: 'USD' }, error: null },
      // No matching sm_reference_data row for this machine name.
      onLookup: { data: [], error: null },
    });
    const getEffectiveRate = jest.fn().mockResolvedValue({ rateUsdPerHr: null, source: 'none', sampleSize: 0 });
    const service = new MHRService(supabaseService, testLogger, makeExchangeRateService({ USD: 1 }), makeLhrService(getEffectiveRate));

    await service.create(
      {
        machineName: 'Totally Unknown Machine', location: 'USA', processGroup: 'Laser Cutting', commodityCode: 'FL',
        directOverheadRate: 6.35, indirectOverheadRate: 14.60,
        isManualEntry: true, manualMHRValue: 999,
      } as any,
      'user-1',
      'token',
    );

    const insertArg = chains[1].__insertArg;
    expect(insertArg.usd_lhr_total).toBeNull();
    expect(insertArg.labor_rate_source).toBe('no_rate');
  });

  it('create(): refuses to persist a fabricated total_machine_hour_rate when neither direct nor indirect overhead has any real or benchmark value on file', async () => {
    const { service: supabaseService } = makeSupabaseService({
      onInsert: { data: { id: 'new-id', location: 'USA', currency: 'USD' }, error: null },
      // No matching sm_reference_data row for this machine name — no benchmark for direct/indirect either.
      onLookup: { data: [], error: null },
    });
    const service = new MHRService(supabaseService, testLogger, makeExchangeRateService({ USD: 1 }), makeLhrService());

    await expect(
      service.create(
        {
          machineName: 'Totally Unknown Machine', location: 'USA', processGroup: 'Laser Cutting', commodityCode: 'FL',
          // directOverheadRate/indirectOverheadRate deliberately omitted, and no benchmark exists — nothing real on file.
          isManualEntry: true, manualMHRValue: 999,
        } as any,
        'user-1',
        'token',
      ),
    ).rejects.toThrow(/No real value or industry benchmark data exists/);
  });
});

describe('MHRService.removeAll', () => {
  it('scopes the delete to the calling user_id, not every user', async () => {
    const eqMock = jest.fn().mockReturnThis();
    const selectMock = jest.fn().mockResolvedValue({ data: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], error: null });
    const deleteMock = jest.fn().mockReturnValue({ eq: eqMock, select: selectMock });
    const fromMock = jest.fn().mockReturnValue({ delete: deleteMock });
    const adminClient = { from: fromMock };

    const supabaseService = {
      getAdminClient: jest.fn().mockReturnValue(adminClient),
    } as unknown as SupabaseService;

    const service = new MHRService(
      supabaseService,
      { log: jest.fn(), error: jest.fn() } as unknown as Logger,
      {} as unknown as ExchangeRateService,
      makeLhrService(),
    );

    const result = await service.removeAll('user-456', 'token');

    expect(fromMock).toHaveBeenCalledWith('mhr_records');
    expect(eqMock).toHaveBeenCalledWith('user_id', 'user-456');
    expect(result).toEqual({ deleted: 3 });
  });
});
