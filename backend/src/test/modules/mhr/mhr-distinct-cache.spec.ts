// The distinct-value lists (currencies, locations, ...) used to download every machine-rate row on every request. They are now read once per user per
// few minutes and forgotten when machine rates are written. This runs the real service against a counted fake database.
import { type DatabaseService } from '../../../common/database/database.service';
import { type ExchangeRateService } from '../../../common/exchange-rate/exchange-rate.service';
import { type Logger } from '../../../common/logger/logger.service';
import { type LHRService } from '../../../modules/lhr/lhr.service';
import { MHRService } from '../../../modules/mhr/mhr.service';

const token = (sub: string) => `h.${Buffer.from(JSON.stringify({ sub })).toString('base64url')}.s`;

function setup(rows: Record<string, string | null>[]) {
  let reads = 0;
  const readChain: any = {};
  for (const m of ['select', 'not', 'order']) readChain[m] = jest.fn(() => readChain);
  readChain.range = jest.fn(() => { reads += 1; return Promise.resolve({ data: rows, error: null }); });
  const deleteChain: any = { delete: jest.fn(() => deleteChain), eq: jest.fn(() => deleteChain), select: jest.fn(() => Promise.resolve({ data: [{ id: 'x' }], error: null })) };
  const db = {
    getClient: jest.fn(() => ({ from: jest.fn(() => readChain) })),
    getUserClient: jest.fn(() => ({ from: jest.fn(() => deleteChain) })),
  } as unknown as DatabaseService;
  const logger = { log: jest.fn(), error: jest.fn(), warn: jest.fn() } as unknown as Logger;
  const service = new MHRService(db, logger, {} as ExchangeRateService, {} as LHRService);
  return { service, reads: () => reads };
}

describe('MHR distinct lists are cached', () => {
  it('the second request for the same user does not touch the database', async () => {
    const { service, reads } = setup([{ currency: 'USD' }, { currency: 'INR' }, { currency: 'USD' }, { currency: null }]);
    expect(await service.getDistinctCurrencies(token('u1'))).toEqual(['INR', 'USD']);
    const afterFirst = reads();
    expect(afterFirst).toBeGreaterThan(0);
    expect(await service.getDistinctCurrencies(token('u1'))).toEqual(['INR', 'USD']);
    expect(reads()).toBe(afterFirst);
  });

  it('each list is cached separately, and a different user reads for themselves', async () => {
    const { service, reads } = setup([{ currency: 'USD', location: 'USA', process_group: 'Machining' }]);
    await service.getDistinctCurrencies(token('u1'));
    const one = reads();
    await service.getDistinctLocations(token('u1'));
    expect(reads()).toBe(one + 1);
    await service.getDistinctCurrencies(token('u2'));
    expect(reads()).toBe(one + 2);
  });

  it('a write empties the cache, so the next request reads fresh data', async () => {
    const { service, reads } = setup([{ location: 'USA' }]);
    await service.getDistinctLocations(token('u1'));
    await service.getDistinctLocations(token('u1'));
    const before = reads();
    await service.removeAll('u1', token('u1'));
    await service.getDistinctLocations(token('u1'));
    expect(reads()).toBe(before + 1);
  });
});
