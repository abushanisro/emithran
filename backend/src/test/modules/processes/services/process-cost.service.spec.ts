import { BadRequestException } from '@nestjs/common';
import { ProcessCostService } from '../../../../modules/processes/services/process-cost.service';
import { CreateProcessCostDto, UpdateProcessCostDto } from '../../../../modules/processes/dto/process-cost.dto';

// Minimal chainable Supabase query-builder stub. Only the methods actually
// exercised by create()/update() (select/eq/maybeSingle for the MHR lookup,
// insert/update/select/single for the record write) are implemented.
function makeSupabaseStub(script: {
  mhrLookup?: { data: any; error: any };
  benchmarkLookup?: { data: any; error: any };
  lhrLookup?: { data: any; error: any };
  benchmarkLhrLookup?: { data: any; error: any };
  existingRecord?: { data: any; error: any };
  insertResult?: { data: any; error: any };
  updateResult?: { data: any; error: any };
}) {
  const calls: { table: string; method: string; args: any[] }[] = [];
  const LOOKUP_TABLES = ['mhr_records', 'mhr_benchmark_rates', 'lhr_records', 'lhr_benchmark_rates'];

  function chain(table: string, mode: 'lookup' | 'existing' | 'insert' | 'update' | undefined) {
    const record = (method: string, args: any[]) => calls.push({ table, method, args });
    const isLookupTable = LOOKUP_TABLES.includes(table);

    return {
      select: (...args: any[]) => {
        record('select', args);
        return chain(table, mode ?? (isLookupTable ? 'lookup' : 'existing'));
      },
      insert: (...args: any[]) => {
        record('insert', args);
        return chain(table, 'insert');
      },
      update: (...args: any[]) => {
        record('update', args);
        return chain(table, 'update');
      },
      eq: (...args: any[]) => {
        record('eq', args);
        return chain(table, mode);
      },
      single: async () => {
        if (mode === 'insert') return script.insertResult ?? { data: {}, error: null };
        if (mode === 'update') return script.updateResult ?? { data: {}, error: null };
        return script.existingRecord ?? { data: {}, error: null };
      },
      maybeSingle: async () => {
        if (table === 'mhr_benchmark_rates') return script.benchmarkLookup ?? { data: null, error: null };
        if (table === 'lhr_records') return script.lhrLookup ?? { data: null, error: null };
        if (table === 'lhr_benchmark_rates') return script.benchmarkLhrLookup ?? { data: null, error: null };
        return script.mhrLookup ?? { data: null, error: null };
      },
    };
  }

  const clientCalls: string[] = [];
  const from = (table: string) => chain(table, undefined);

  return {
    getClient: () => { clientCalls.push('getClient'); return { from }; },
    getAdminClient: () => { clientCalls.push('getAdminClient'); return { from }; },
    calls,
    insertPayload: () => calls.find((c) => c.method === 'insert')?.args?.[0],
    updatePayload: () => calls.find((c) => c.method === 'update')?.args?.[0],
    queriedMhrRecords: () => calls.some((c) => c.table === 'mhr_records'),
    queriedBenchmarkRecords: () => calls.some((c) => c.table === 'mhr_benchmark_rates'),
    queriedLhrRecords: () => calls.some((c) => c.table === 'lhr_records'),
    queriedBenchmarkLhrRecords: () => calls.some((c) => c.table === 'lhr_benchmark_rates'),
    // The exact value passed to .eq('id', <this>) for the mhr_benchmark_rates
    // lookup — lets a test assert the 'bm-mhr-' prefix was actually stripped,
    // not just that the lookup happened to return the right data.
    benchmarkEqIdArg: () => calls.find((c) => c.table === 'mhr_benchmark_rates' && c.method === 'eq')?.args?.[1],
    benchmarkLhrEqIdArg: () => calls.find((c) => c.table === 'lhr_benchmark_rates' && c.method === 'eq')?.args?.[1],
    usedAdminClientForBenchmarkLookup: () => clientCalls.includes('getAdminClient'),
  };
}

const fakeLogger = { log: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() } as any;

// Test DTOs never set `location`, so getCurrencyForLocation('') always resolves
// to USD — real toUsd() would already be a no-op (convertStrict('USD','USD')=1)
// for every case these tests exercise; this stub mirrors that identity directly.
const fakeExchangeRateService = {
  getSnapshot: async () => ({
    toUsd: (amount: number) => amount,
    convertStrict: () => 1,
    convertOptional: () => 1,
  }),
} as any;

function baseCreateDto(overrides: Partial<CreateProcessCostDto> = {}): CreateProcessCostDto {
  return {
    processGroup: 'Sheet Metal',
    processRoute: 'Laser Cutting',
    operation: 'Fiber Laser Cut',
    directRate: 50,
    setupManning: 1,
    setupTime: 10,
    batchSize: 100,
    heads: 1,
    cycleTime: 30,
    partsPerCycle: 1,
    scrap: 5,
    ...overrides,
  } as CreateProcessCostDto;
}

function existingRow(overrides: Record<string, any> = {}) {
  return {
    id: 'existing-id',
    op_nbr: 10,
    direct_rate: 50,
    indirect_rate: 0,
    fringe_rate: 0,
    machine_rate: 0,
    machine_value: 0,
    setup_manning: 1,
    setup_time: 10,
    batch_size: 100,
    heads: 1,
    cycle_time: 30,
    parts_per_cycle: 1,
    scrap: 5,
    mhr_id: null,
    machine_name: null,
    machine_class: null,
    ...overrides,
  };
}

describe('ProcessCostService — machine_name/machine_class derivation', () => {
  describe('create()', () => {
    it('resolves machine_name/machine_class from mhr_records when mhrId is set', async () => {
      const supabase = makeSupabaseStub({
        mhrLookup: { data: { machine_name: 'Fiber Laser 2kW', machine_class: 'fiber_laser' }, error: null },
      });
      const service = new ProcessCostService(supabase as any, fakeLogger, fakeExchangeRateService);

      await service.create(baseCreateDto({ mhrId: 'mhr-1' }), 'user-1', 'token');

      const payload = supabase.insertPayload();
      expect(payload.machine_name).toBe('Fiber Laser 2kW');
      expect(payload.machine_class).toBe('fiber_laser');
    });

    it('stores null machine_name/machine_class and skips the lookup when no mhrId is given', async () => {
      const supabase = makeSupabaseStub({});
      const service = new ProcessCostService(supabase as any, fakeLogger, fakeExchangeRateService);

      await service.create(baseCreateDto(), 'user-1', 'token');

      const payload = supabase.insertPayload();
      expect(payload.machine_name).toBeNull();
      expect(payload.machine_class).toBeNull();
      expect(supabase.queriedMhrRecords()).toBe(false);
    });

    it('throws BadRequestException when mhrId does not resolve to any mhr_records row', async () => {
      const supabase = makeSupabaseStub({ mhrLookup: { data: null, error: null } });
      const service = new ProcessCostService(supabase as any, fakeLogger, fakeExchangeRateService);

      await expect(
        service.create(baseCreateDto({ mhrId: 'missing-mhr' }), 'user-1', 'token'),
      ).rejects.toThrow(BadRequestException);
      expect(supabase.insertPayload()).toBeUndefined();
    });

    it('resolves machine_name/machine_class from mhr_benchmark_rates when only benchmarkMhrId is given (★ machine, no real mhr_records row)', async () => {
      const supabase = makeSupabaseStub({
        benchmarkLookup: { data: { machine_name: 'Fiber Laser 10kW', machine_class: 'fiber_laser' }, error: null },
      });
      const service = new ProcessCostService(supabase as any, fakeLogger, fakeExchangeRateService);

      await service.create(baseCreateDto({ benchmarkMhrId: 42 }), 'user-1', 'token');

      const payload = supabase.insertPayload();
      expect(payload.machine_name).toBe('Fiber Laser 10kW');
      expect(payload.machine_class).toBe('fiber_laser');
      expect(supabase.queriedMhrRecords()).toBe(false);
      expect(supabase.queriedBenchmarkRecords()).toBe(true);
    });

    // Regression test for a real bug found in production: mhr.service.ts's
    // getBenchmarkRates() (which populates the dialog's dropdown) returns every
    // benchmark row's id prefixed as 'bm-mhr-<id>', never the bare bigint the
    // mhr_benchmark_rates.id column actually stores. Selecting a ★ machine and
    // saving therefore always sent e.g. 'bm-mhr-42' as benchmarkMhrId — which
    // .eq('id', 'bm-mhr-42') against a BIGSERIAL column can never match,
    // regardless of the actual id — and the save failed with "The specified
    // benchmark machine rate does not exist or is not accessible." on every
    // single benchmark-machine save. This must resolve exactly like the bare
    // numeric id case above.
    it('resolves correctly when benchmarkMhrId has the "bm-mhr-" prefix the dropdown actually sends', async () => {
      const supabase = makeSupabaseStub({
        benchmarkLookup: { data: { machine_name: 'Fiber Laser 10kW', machine_class: 'fiber_laser' }, error: null },
      });
      const service = new ProcessCostService(supabase as any, fakeLogger, fakeExchangeRateService);

      await service.create(baseCreateDto({ benchmarkMhrId: 'bm-mhr-42' }), 'user-1', 'token');

      const payload = supabase.insertPayload();
      expect(payload.machine_name).toBe('Fiber Laser 10kW');
      expect(payload.machine_class).toBe('fiber_laser');
      // The critical assertion: the prefix must be stripped before querying —
      // querying with the raw 'bm-mhr-42' string is exactly the bug.
      expect(supabase.benchmarkEqIdArg()).toBe('42');
    });

    // Regression test for the second half of the same bug: mhr_benchmark_rates
    // has no user_id column (migration 345 documents it as global/shared), so a
    // lookup via the RLS-scoped per-request client can return zero rows even
    // for a valid id if RLS is enabled with no policy for this table. The
    // dropdown-listing endpoint already reads it via the admin client for this
    // exact reason (mhr.service.ts#getBenchmarkRates) — the single-row lookup
    // must use the same client, not the user-scoped one used for mhr_records.
    it('uses the admin client (not the RLS-scoped per-request client) for the benchmark lookup', async () => {
      const supabase = makeSupabaseStub({
        benchmarkLookup: { data: { machine_name: 'Fiber Laser 10kW', machine_class: 'fiber_laser' }, error: null },
      });
      const service = new ProcessCostService(supabase as any, fakeLogger, fakeExchangeRateService);

      await service.create(baseCreateDto({ benchmarkMhrId: 'bm-mhr-42' }), 'user-1', 'token');

      expect(supabase.usedAdminClientForBenchmarkLookup()).toBe(true);
    });

    it('prefers mhrId over benchmarkMhrId when both are somehow given', async () => {
      const supabase = makeSupabaseStub({
        mhrLookup: { data: { machine_name: 'Real MHR Machine', machine_class: 'press_brake' }, error: null },
        benchmarkLookup: { data: { machine_name: 'Should Not Be Used', machine_class: 'fiber_laser' }, error: null },
      });
      const service = new ProcessCostService(supabase as any, fakeLogger, fakeExchangeRateService);

      await service.create(baseCreateDto({ mhrId: 'mhr-1', benchmarkMhrId: 42 }), 'user-1', 'token');

      const payload = supabase.insertPayload();
      expect(payload.machine_name).toBe('Real MHR Machine');
      expect(payload.machine_class).toBe('press_brake');
      expect(supabase.queriedBenchmarkRecords()).toBe(false);
    });

    it('throws BadRequestException when benchmarkMhrId does not resolve to any mhr_benchmark_rates row', async () => {
      const supabase = makeSupabaseStub({ benchmarkLookup: { data: null, error: null } });
      const service = new ProcessCostService(supabase as any, fakeLogger, fakeExchangeRateService);

      await expect(
        service.create(baseCreateDto({ benchmarkMhrId: 999 }), 'user-1', 'token'),
      ).rejects.toThrow(BadRequestException);
      expect(supabase.insertPayload()).toBeUndefined();
    });
  });

  describe('update()', () => {
    it('re-derives machine_name/machine_class when mhrId changes to a different record', async () => {
      const supabase = makeSupabaseStub({
        existingRecord: { data: existingRow({ mhr_id: 'old-mhr', machine_name: 'Old Machine', machine_class: 'press_brake' }), error: null },
        mhrLookup: { data: { machine_name: 'New Laser', machine_class: 'fiber_laser' }, error: null },
      });
      const service = new ProcessCostService(supabase as any, fakeLogger, fakeExchangeRateService);

      await service.update('existing-id', { mhrId: 'new-mhr' } as UpdateProcessCostDto, 'user-1', 'token');

      const payload = supabase.updatePayload();
      expect(payload.machine_name).toBe('New Laser');
      expect(payload.machine_class).toBe('fiber_laser');
    });

    it('leaves machine_name/machine_class untouched when mhrId is not part of the update payload', async () => {
      const supabase = makeSupabaseStub({
        existingRecord: { data: existingRow({ mhr_id: 'old-mhr', machine_name: 'Old Machine', machine_class: 'press_brake' }), error: null },
      });
      const service = new ProcessCostService(supabase as any, fakeLogger, fakeExchangeRateService);

      await service.update('existing-id', { setupTime: 20 } as UpdateProcessCostDto, 'user-1', 'token');

      const payload = supabase.updatePayload();
      expect(payload.machine_name).toBeUndefined();
      expect(payload.machine_class).toBeUndefined();
      expect(supabase.queriedMhrRecords()).toBe(false);
    });

    it('clears machine_name/machine_class when mhrId is explicitly set to null', async () => {
      const supabase = makeSupabaseStub({
        existingRecord: { data: existingRow({ mhr_id: 'old-mhr', machine_name: 'Old Machine', machine_class: 'press_brake' }), error: null },
      });
      const service = new ProcessCostService(supabase as any, fakeLogger, fakeExchangeRateService);

      await service.update('existing-id', { mhrId: null } as unknown as UpdateProcessCostDto, 'user-1', 'token');

      const payload = supabase.updatePayload();
      expect(payload.machine_name).toBeNull();
      expect(payload.machine_class).toBeNull();
    });

    it('resolves machine_name/machine_class from mhr_benchmark_rates when only benchmarkMhrId changes (mhrId untouched)', async () => {
      const supabase = makeSupabaseStub({
        existingRecord: { data: existingRow(), error: null },
        benchmarkLookup: { data: { machine_name: 'Fiber Laser 10kW', machine_class: 'fiber_laser' }, error: null },
      });
      const service = new ProcessCostService(supabase as any, fakeLogger, fakeExchangeRateService);

      await service.update('existing-id', { benchmarkMhrId: 42 } as UpdateProcessCostDto, 'user-1', 'token');

      const payload = supabase.updatePayload();
      expect(payload.machine_name).toBe('Fiber Laser 10kW');
      expect(payload.machine_class).toBe('fiber_laser');
    });

    it('throws BadRequestException when the update changes mhrId to an unresolvable value', async () => {
      const supabase = makeSupabaseStub({
        existingRecord: { data: existingRow({ mhr_id: 'old-mhr' }), error: null },
        mhrLookup: { data: null, error: null },
      });
      const service = new ProcessCostService(supabase as any, fakeLogger, fakeExchangeRateService);

      await expect(
        service.update('existing-id', { mhrId: 'missing-mhr' } as UpdateProcessCostDto, 'user-1', 'token'),
      ).rejects.toThrow(BadRequestException);
      expect(supabase.updatePayload()).toBeUndefined();
    });
  });
});

// labor_type is the labour-side counterpart of machine_name/machine_class,
// derived the same way via deriveLaborFields() — same bug class as the
// benchmark machine one above (mhr.service.ts's getBenchmarkRates() had a
// 'bm-mhr-' prefix bug; lhr.service.ts's getBenchmarkRates() had the same
// prefix problem PLUS fabricated labourType from process_group instead of
// selecting the real labour_type column — see lhr.service.ts for that half of
// the fix). This suite proves the labor_type derivation half end-to-end.
describe('ProcessCostService — labor_type derivation', () => {
  describe('create()', () => {
    it('resolves labor_type from lhr_records when lhrId is set', async () => {
      const supabase = makeSupabaseStub({
        lhrLookup: { data: { labour_type: 'Skilled' }, error: null },
      });
      const service = new ProcessCostService(supabase as any, fakeLogger, fakeExchangeRateService);

      await service.create(baseCreateDto({ lhrId: 'lhr-1' }), 'user-1', 'token');

      const payload = supabase.insertPayload();
      expect(payload.labor_type).toBe('Skilled');
    });

    it('stores null labor_type and skips the lookup when neither lhrId nor benchmarkLhrId is given', async () => {
      const supabase = makeSupabaseStub({});
      const service = new ProcessCostService(supabase as any, fakeLogger, fakeExchangeRateService);

      await service.create(baseCreateDto(), 'user-1', 'token');

      const payload = supabase.insertPayload();
      expect(payload.labor_type).toBeNull();
      expect(supabase.queriedLhrRecords()).toBe(false);
      expect(supabase.queriedBenchmarkLhrRecords()).toBe(false);
    });

    it('throws BadRequestException when lhrId does not resolve to any lhr_records row', async () => {
      const supabase = makeSupabaseStub({ lhrLookup: { data: null, error: null } });
      const service = new ProcessCostService(supabase as any, fakeLogger, fakeExchangeRateService);

      await expect(
        service.create(baseCreateDto({ lhrId: 'missing-lhr' }), 'user-1', 'token'),
      ).rejects.toThrow(BadRequestException);
      expect(supabase.insertPayload()).toBeUndefined();
    });

    it('resolves labor_type from lhr_benchmark_rates when only benchmarkLhrId is given (★ labour rate, no real lhr_records row)', async () => {
      const supabase = makeSupabaseStub({
        benchmarkLhrLookup: { data: { labour_type: 'CNC Machinist' }, error: null },
      });
      const service = new ProcessCostService(supabase as any, fakeLogger, fakeExchangeRateService);

      await service.create(baseCreateDto({ benchmarkLhrId: 17 }), 'user-1', 'token');

      const payload = supabase.insertPayload();
      expect(payload.labor_type).toBe('CNC Machinist');
      expect(supabase.queriedLhrRecords()).toBe(false);
      expect(supabase.queriedBenchmarkLhrRecords()).toBe(true);
    });

    // Regression test for the exact real-world bug: lhr.service.ts's
    // getBenchmarkRates() prefixes every row's bigint id as 'bm-lhr-<id>'
    // before it reaches the frontend, so a selected benchmark labour rate's id
    // is always e.g. 'bm-lhr-17', never the bare '17' the id column stores.
    it('resolves correctly when benchmarkLhrId has the "bm-lhr-" prefix the dropdown actually sends', async () => {
      const supabase = makeSupabaseStub({
        benchmarkLhrLookup: { data: { labour_type: 'CNC Machinist' }, error: null },
      });
      const service = new ProcessCostService(supabase as any, fakeLogger, fakeExchangeRateService);

      await service.create(baseCreateDto({ benchmarkLhrId: 'bm-lhr-17' }), 'user-1', 'token');

      const payload = supabase.insertPayload();
      expect(payload.labor_type).toBe('CNC Machinist');
      expect(supabase.benchmarkLhrEqIdArg()).toBe('17');
    });

    it('uses the admin client (not the RLS-scoped per-request client) for the benchmark LHR lookup', async () => {
      const supabase = makeSupabaseStub({
        benchmarkLhrLookup: { data: { labour_type: 'CNC Machinist' }, error: null },
      });
      const service = new ProcessCostService(supabase as any, fakeLogger, fakeExchangeRateService);

      await service.create(baseCreateDto({ benchmarkLhrId: 'bm-lhr-17' }), 'user-1', 'token');

      expect(supabase.usedAdminClientForBenchmarkLookup()).toBe(true);
    });

    it('prefers lhrId over benchmarkLhrId when both are somehow given', async () => {
      const supabase = makeSupabaseStub({
        lhrLookup: { data: { labour_type: 'Skilled' }, error: null },
        benchmarkLhrLookup: { data: { labour_type: 'Should Not Be Used' }, error: null },
      });
      const service = new ProcessCostService(supabase as any, fakeLogger, fakeExchangeRateService);

      await service.create(baseCreateDto({ lhrId: 'lhr-1', benchmarkLhrId: 17 }), 'user-1', 'token');

      const payload = supabase.insertPayload();
      expect(payload.labor_type).toBe('Skilled');
      expect(supabase.queriedBenchmarkLhrRecords()).toBe(false);
    });

    it('throws BadRequestException when benchmarkLhrId does not resolve to any lhr_benchmark_rates row', async () => {
      const supabase = makeSupabaseStub({ benchmarkLhrLookup: { data: null, error: null } });
      const service = new ProcessCostService(supabase as any, fakeLogger, fakeExchangeRateService);

      await expect(
        service.create(baseCreateDto({ benchmarkLhrId: 999 }), 'user-1', 'token'),
      ).rejects.toThrow(BadRequestException);
      expect(supabase.insertPayload()).toBeUndefined();
    });
  });

  describe('update()', () => {
    it('re-derives labor_type when lhrId changes to a different record', async () => {
      const supabase = makeSupabaseStub({
        existingRecord: { data: existingRow({ lhr_id: 'old-lhr', labor_type: 'Semi-Skilled' }), error: null },
        lhrLookup: { data: { labour_type: 'Skilled' }, error: null },
      });
      const service = new ProcessCostService(supabase as any, fakeLogger, fakeExchangeRateService);

      await service.update('existing-id', { lhrId: 'new-lhr' } as UpdateProcessCostDto, 'user-1', 'token');

      const payload = supabase.updatePayload();
      expect(payload.labor_type).toBe('Skilled');
    });

    it('leaves labor_type untouched when neither lhrId nor benchmarkLhrId is part of the update payload', async () => {
      const supabase = makeSupabaseStub({
        existingRecord: { data: existingRow({ lhr_id: 'old-lhr', labor_type: 'Semi-Skilled' }), error: null },
      });
      const service = new ProcessCostService(supabase as any, fakeLogger, fakeExchangeRateService);

      await service.update('existing-id', { setupTime: 20 } as UpdateProcessCostDto, 'user-1', 'token');

      const payload = supabase.updatePayload();
      expect(payload.labor_type).toBeUndefined();
      expect(supabase.queriedLhrRecords()).toBe(false);
      expect(supabase.queriedBenchmarkLhrRecords()).toBe(false);
    });

    it('resolves labor_type from lhr_benchmark_rates when only benchmarkLhrId changes (lhrId untouched)', async () => {
      const supabase = makeSupabaseStub({
        existingRecord: { data: existingRow(), error: null },
        benchmarkLhrLookup: { data: { labour_type: 'CNC Machinist' }, error: null },
      });
      const service = new ProcessCostService(supabase as any, fakeLogger, fakeExchangeRateService);

      await service.update('existing-id', { benchmarkLhrId: 'bm-lhr-17' } as UpdateProcessCostDto, 'user-1', 'token');

      const payload = supabase.updatePayload();
      expect(payload.labor_type).toBe('CNC Machinist');
    });

    it('throws BadRequestException when the update changes lhrId to an unresolvable value', async () => {
      const supabase = makeSupabaseStub({
        existingRecord: { data: existingRow({ lhr_id: 'old-lhr' }), error: null },
        lhrLookup: { data: null, error: null },
      });
      const service = new ProcessCostService(supabase as any, fakeLogger, fakeExchangeRateService);

      await expect(
        service.update('existing-id', { lhrId: 'missing-lhr' } as UpdateProcessCostDto, 'user-1', 'token'),
      ).rejects.toThrow(BadRequestException);
      expect(supabase.updatePayload()).toBeUndefined();
    });
  });
});
