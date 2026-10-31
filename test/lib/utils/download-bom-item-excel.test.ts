import { afterEach, describe, expect, it, vi } from 'vitest';

// The export goes same-origin through the BFF; browser code sends no Authorization header (it once sent "Bearer null").

const { downloadBomItemExcel } = await import('@/lib/utils/download-bom-item-excel');

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('downloadBomItemExcel', () => {
  it('asks the API for the workbook without any Authorization header', async () => {
    const fetcher = vi.fn<typeof fetch>(() => Promise.resolve(new Response(null, { status: 500 })));
    vi.stubGlobal('fetch', fetcher);

    await expect(downloadBomItemExcel('item-1', 'x.xlsx', { batchSize: 100 })).rejects.toThrow('Excel export failed (500)');
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(typeof url === 'string' ? url : '').toContain('/cost-analysis/bom-item/item-1/excel?batchSize=100');
    expect(new Headers(init?.headers).get('authorization')).toBeNull();
  });
});
