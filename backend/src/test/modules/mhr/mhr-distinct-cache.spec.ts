// The distinct-value lists (currencies, locations, ...) are one DISTINCT in the database (migration 986), not every machine-rate row downloaded and
// deduplicated in JavaScript; and they are read once per user per few minutes, and forgotten when machine rates are written. This runs the real
// service against a counted fake data API.
import { InternalServerErrorException } from '@nestjs/common';

import { type DatabaseService } from '../../../common/database/database.service';
import { type ExchangeRateService } from '../../../common/exchange-rate/exchange-rate.service';
import { type Logger } from '../../../common/logger/logger.service';
import { type LHRService } from '../../../modules/lhr/lhr.service';
import { MHRService } from '../../../modules/mhr/mhr.service';

const token = (sub: string) => `h.${Buffer.from(JSON.stringify({ sub })).toString('base64url')}.s`;

interface RpcAnswer { data: unknown; error: { message: string } | null }

function setup(answers: Record<string, RpcAnswer>) {
  const calls: { fn: string; args: unknown }[] = [];
  const rpc = jest.fn((fn: string, args?: unknown) => {
    calls.push({ fn, args });
    return Promise.resolve(answers[fn] ?? { data: [], error: null });
  });
  const deleteChain: Record<string, jest.Mock> = {};
  deleteChain.delete = jest.fn(() => deleteChain);
  deleteChain.eq = jest.fn(() => deleteChain);
  deleteChain.select = jest.fn(() => Promise.resolve({ data: [{ id: 'x' }], error: null }));
  const db = {
    getClient: jest.fn(() => ({ rpc })),
    getUserClient: jest.fn(() => ({ from: jest.fn(() => deleteChain) })),
  } as unknown as DatabaseService;
  const logger = { log: jest.fn(), error: jest.fn(), warn: jest.fn() } as unknown as Logger;
  return { service: new MHRService(db, logger, {} as ExchangeRateService, {} as LHRService), calls };
}

const values = (data: (string | null)[]): RpcAnswer => ({ data, error: null });

describe('MHR distinct lists come from the database, once, and are cached', () => {
  it('asks the database for the named column and returns a clean, sorted list', async () => {
    const { service, calls } = setup({ mhr_distinct_values: values(['USD', 'INR', null, '', 'USD']) });
    expect(await service.getDistinctCurrencies(token('u1'))).toEqual(['INR', 'USD']);
    expect(calls).toEqual([{ fn: 'mhr_distinct_values', args: { p_column: 'currency' } }]);
  });

  it('each list asks for its own column', async () => {
    const { service, calls } = setup({ mhr_distinct_values: values(['x']) });
    await service.getDistinctLocations(token('u1'));
    await service.getDistinctProcessGroups(token('u1'));
    await service.getDistinctManufacturerCountries(token('u1'));
    await service.getDistinctWageGrades(token('u1'));
    expect(calls.map((c) => (c.args as { p_column: string }).p_column)).toEqual(['location', 'process_group', 'manufacturer_country', 'wage_grade']);
  });

  it('the second request for the same user does not touch the database', async () => {
    const { service, calls } = setup({ mhr_distinct_values: values(['USD']) });
    await service.getDistinctCurrencies(token('u1'));
    await service.getDistinctCurrencies(token('u1'));
    expect(calls).toHaveLength(1);
  });

  it('a different user reads for themselves (row-level security decides each list)', async () => {
    const { service, calls } = setup({ mhr_distinct_values: values(['USD']) });
    await service.getDistinctCurrencies(token('u1'));
    await service.getDistinctCurrencies(token('u2'));
    expect(calls).toHaveLength(2);
  });

  it('a write empties the cache, so the next request reads fresh data', async () => {
    const { service, calls } = setup({ mhr_distinct_values: values(['USA']) });
    await service.getDistinctLocations(token('u1'));
    await service.removeAll('u1', token('u1'));
    await service.getDistinctLocations(token('u1'));
    expect(calls).toHaveLength(2);
  });

  it('categories are derived from the distinct sources, first appearance deciding the machine class', async () => {
    const { service, calls } = setup({
      mhr_distinct_category_sources: {
        data: [
          { benchmark_source_key: 'Inspection:cmm', machine_class: null, process_group: 'Machining', commodity_code: null },
          { benchmark_source_key: 'Inspection:cmm', machine_class: 'cmm', process_group: 'Machining', commodity_code: null },
          { benchmark_source_key: null, machine_class: 'press', process_group: null, commodity_code: 'PM' },
        ],
        error: null,
      },
    });
    const out = await service.getDistinctCategoriesWithClass(token('u1'));
    expect(calls).toEqual([{ fn: 'mhr_distinct_category_sources', args: undefined }]);
    // the null placeholder for 'Inspection' is upgraded by the later row that carries the real class
    expect(out.find((c) => c.category === 'Inspection')).toEqual({ category: 'Inspection', machineClass: 'cmm' });
    expect(out.map((c) => c.category)).toEqual([...out.map((c) => c.category)].sort((a, b) => a.localeCompare(b)));
  });

  it('keeps the old failure behaviour: a failed list is empty, except process groups which refuse to answer empty', async () => {
    const failure: RpcAnswer = { data: null, error: { message: 'db down' } };
    const { service } = setup({ mhr_distinct_values: failure });
    expect(await service.getDistinctCurrencies(token('u1'))).toEqual([]);
    await expect(service.getDistinctProcessGroups(token('u1'))).rejects.toBeInstanceOf(InternalServerErrorException);
  });
});

describe('a failed read is never remembered', () => {
  // Found live on 2026-11-12: right after migration 986 the data API did not know the new function yet, every list answered [] (as designed) and the cache
  // kept those empty answers for five minutes. A failure must answer [] now and read again next time.
  it.each([
    ['currencies', 'getDistinctCurrencies' as const],
    ['locations', 'getDistinctLocations' as const],
    ['manufacturer countries', 'getDistinctManufacturerCountries' as const],
    ['wage grades', 'getDistinctWageGrades' as const],
  ])('%s: empty while the database cannot answer, data as soon as it can', async (_label, method) => {
    let healthy = false;
    const rpc = jest.fn(() => Promise.resolve(healthy ? { data: ['A', 'B'], error: null } : { data: null, error: { message: 'function not found in the schema cache' } }));
    const db = { getClient: jest.fn(() => ({ rpc })) } as unknown as DatabaseService;
    const logger = { log: jest.fn(), error: jest.fn(), warn: jest.fn() } as unknown as Logger;
    const service = new MHRService(db, logger, {} as ExchangeRateService, {} as LHRService);

    expect(await service[method](token('u1'))).toEqual([]);
    healthy = true;
    expect(await service[method](token('u1'))).toEqual(['A', 'B']); // not stuck on the remembered failure
    expect(await service[method](token('u1'))).toEqual(['A', 'B']);
    expect(rpc).toHaveBeenCalledTimes(2); // the failure, then one good read that the cache keeps
  });

  it('categories too', async () => {
    let healthy = false;
    const rpc = jest.fn(() => Promise.resolve(healthy
      ? { data: [{ benchmark_source_key: 'Inspection', machine_class: 'cmm', process_group: 'Machining' }], error: null }
      : { data: null, error: { message: 'down' } }));
    const db = { getClient: jest.fn(() => ({ rpc })) } as unknown as DatabaseService;
    const logger = { log: jest.fn(), error: jest.fn(), warn: jest.fn() } as unknown as Logger;
    const service = new MHRService(db, logger, {} as ExchangeRateService, {} as LHRService);
    expect(await service.getDistinctCategoriesWithClass(token('u1'))).toEqual([]);
    healthy = true;
    expect(await service.getDistinctCategoriesWithClass(token('u1'))).toEqual([{ category: 'Inspection', machineClass: 'cmm' }]);
  });
});

describe('categories over the reduced sources equal categories over every row', () => {
  // The database now returns, per combination of (first segment of the key, machine class, effective group), one entry in first-appearance order
  // (migration 986). The service's rule depends only on the FIRST appearance of each such combination. Random tables prove it: the answer from every
  // raw row must equal the answer from the reduced rows, for every group scope.
  interface Raw { benchmark_source_key: string | null; machine_class: string | null; process_group: string | null; commodity_code: string | null }
  interface Reduced { benchmark_source_key: string | null; machine_class: string | null; process_group: string | null }
  const pick = <T,>(seed: () => number, xs: T[]): T => xs[Math.floor(seed() * xs.length)];
  const lcg = (n: number) => () => ((n = (n * 1664525 + 1013904223) % 4294967296) / 4294967296);

  // what the SQL does: key = text before the first ':' trimmed, NULL when empty; group = own group else commodity code, '' counting as missing.
  // The `||` is deliberate: an empty string must count as missing, exactly as in the service's rule.
  /* eslint-disable @typescript-eslint/prefer-nullish-coalescing */
  const reduce = (r: Raw): Reduced => ({
    benchmark_source_key: r.benchmark_source_key === null ? null : r.benchmark_source_key.split(':')[0].trim() || null,
    machine_class: r.machine_class,
    process_group: r.process_group || r.commodity_code || null,
  });
  /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */
  const firstSeenDistinct = (rows: Reduced[]): Reduced[] => {
    const seen = new Set<string>();
    return rows.filter((r) => { const k = JSON.stringify(r); if (seen.has(k)) return false; seen.add(k); return true; });
  };

  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])('seed %i', async (seedNo) => {
    const rnd = lcg(seedNo * 7919);
    const keys = [null, '', ':x', '  Inspection  :CMM', 'Inspection:Bench', 'Press:Hydraulic', 'Casting:Pit', ' Deburr : Brush'];
    const classes = [null, '', 'cmm', 'press', 'gun_drill', 'fiber_laser', 'sand_mixer'];
    const groups = [null, '', 'Machining', 'Sheet Metal', 'Plastic Molding'];
    const commodity = [null, '', 'PM', 'SM'];
    const rows: Raw[] = Array.from({ length: 500 }, () => ({
      benchmark_source_key: pick(rnd, keys), machine_class: pick(rnd, classes), process_group: pick(rnd, groups), commodity_code: pick(rnd, commodity),
    }));
    const reduced = firstSeenDistinct(rows.map(reduce));
    for (const scope of [undefined, 'Machining', 'Plastic Molding', 'PM']) {
      const fromAll = setup({ mhr_distinct_category_sources: { data: rows, error: null } }).service;
      const fromReduced = setup({ mhr_distinct_category_sources: { data: reduced, error: null } }).service;
      expect(await fromReduced.getDistinctCategoriesWithClass(token('u'), scope)).toEqual(await fromAll.getDistinctCategoriesWithClass(token('u'), scope));
    }
  });
});
