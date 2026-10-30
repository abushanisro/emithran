import { afterEach, describe, expect, it, vi } from 'vitest';

// Regression (P0-06): the export sent "Authorization: Bearer null" because it read a token getter that always returned null.

const browserAuthHeaders = vi.fn<() => Promise<Record<string, string> | null>>();
vi.mock('@/lib/api/auth-headers', () => ({ browserAuthHeaders: () => browserAuthHeaders() }));

const { downloadBomItemExcel } = await import('@/lib/utils/download-bom-item-excel');

const sentHeaders = (fetcher: ReturnType<typeof vi.fn<typeof fetch>>) => new Headers(fetcher.mock.calls[0]?.[1]?.headers);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('downloadBomItemExcel', () => {
  it("sends the session's real token", async () => {
    const fetcher = vi.fn<typeof fetch>(() => Promise.resolve(new Response(null, { status: 500 })));
    vi.stubGlobal('fetch', fetcher);
    browserAuthHeaders.mockResolvedValue({ Authorization: 'Bearer real-token' });

    await expect(downloadBomItemExcel('item-1', 'x.xlsx')).rejects.toThrow('Excel export failed (500)');
    expect(sentHeaders(fetcher).get('authorization')).toBe('Bearer real-token');
  });

  it('sends no Authorization header through the BFF', async () => {
    const fetcher = vi.fn<typeof fetch>(() => Promise.resolve(new Response(null, { status: 500 })));
    vi.stubGlobal('fetch', fetcher);
    browserAuthHeaders.mockResolvedValue({});

    await expect(downloadBomItemExcel('item-1', 'x.xlsx')).rejects.toThrow();
    expect(sentHeaders(fetcher).get('authorization')).toBeNull();
  });
});
