import { beforeEach, describe, expect, it, vi } from 'vitest';

const get = vi.fn<(url: string) => Promise<unknown>>();
vi.mock('@/lib/api/client', () => ({ apiClient: { get: (url: string) => get(url) } }));

import { calculatorsApi } from '@/lib/api/calculators';

/** GET /calculators?page=N serves pages of these sizes, as the backend does (at most 100 a page, retired rows left out). */
function serve(pageSizes: number[]) {
  get.mockImplementation((url: string) => {
    const page = Number(new URL(url, 'http://x').searchParams.get('page') ?? 1);
    const size = pageSizes[page - 1] ?? 0;
    const calculators = Array.from({ length: size }, (_, i) => ({ id: `p${page}-${i}` }));
    return Promise.resolve({ calculators, total: 999, page, limit: 100 });
  });
}

describe('calculatorsApi.getAll', () => {
  beforeEach(() => get.mockReset());

  it('returns every page, so a calculator older than the newest 100 is listed (Weight Check showed no calculator)', async () => {
    serve([100, 100, 58]);
    const all = await calculatorsApi.getAll({ limit: 100, summary: true });
    expect(all.calculators).toHaveLength(258);
    expect(all.calculators.at(-1)).toEqual({ id: 'p3-57' });
    expect(all.total).toBe(258);
    expect(get.mock.calls.every(([url]) => url.includes('limit=100') && url.includes('summary=true'))).toBe(true);
  });

  it('reads past a short page, which is short for retired rows and not the last one', async () => {
    serve([100, 97, 40]);
    expect((await calculatorsApi.getAll()).calculators).toHaveLength(237);
  });

  it('stops after the page the server says is the last: no request for the page past it (299 calculators: page 4 was a 500)', async () => {
    get.mockImplementation((url: string) => {
      const page = Number(new URL(url, 'http://x').searchParams.get('page') ?? 1);
      const size = [100, 100, 99][page - 1] ?? 0;
      return Promise.resolve({ calculators: Array.from({ length: size }, (_, i) => ({ id: `p${page}-${i}` })), total: 299, page, limit: 100, hasMore: page < 3 });
    });
    expect((await calculatorsApi.getAll()).calculators).toHaveLength(299);
    expect(get).toHaveBeenCalledTimes(3);
  });

  it('asks for 100 a page even when the caller names no limit (the backend default is 10)', async () => {
    serve([3]);
    await calculatorsApi.getAll();
    expect(String(get.mock.calls[0]?.[0])).toContain('limit=100');
  });

  it('serves just that page when the caller names one (the paged calculators list)', async () => {
    serve([100, 100]);
    const page = await calculatorsApi.getAll({ page: 2, limit: 100 });
    expect(page.calculators[0]).toEqual({ id: 'p2-0' });
    expect(get).toHaveBeenCalledTimes(1);
  });
});
