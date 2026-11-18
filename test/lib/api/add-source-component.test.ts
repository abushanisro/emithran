import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = {
  post: vi.fn<(endpoint: string, body?: unknown) => Promise<unknown>>(),
  patch: vi.fn<(endpoint: string, body?: unknown) => Promise<unknown>>(),
  put: vi.fn<(endpoint: string, body?: unknown, opts?: unknown) => Promise<unknown>>(),
  delete: vi.fn<(endpoint: string) => Promise<unknown>>(),
  uploadFiles: vi.fn<(endpoint: string, form: FormData, opts?: unknown) => Promise<unknown>>(),
};
vi.mock('@/lib/api/client', () => ({ apiClient: api, ApiError: class extends Error {} }));

const { addSourceComponent } = await import('@/lib/api/hooks/useBOMItems');

const part = { id: 'part', bomId: 'bom', name: 'Back cover', partNumber: 'BC-1', quantity: 2, annualVolume: 1000, materialGrade: 'AA 380', parentItemId: 'asm' } as never;
const file = new File(['ISO-10303-21;'], 'blank.step');

describe('adding a 2-Model source component from its STEP model', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.post.mockResolvedValue({ id: 'blank' });
    api.patch.mockResolvedValue({});
    api.uploadFiles.mockResolvedValue({});
    api.put.mockResolvedValue({ id: 'part', sourceItemId: 'blank' });
    api.delete.mockResolvedValue(undefined);
  });

  it('creates the blank beside the part, sets its process before the model is analysed, uploads it and links it', async () => {
    const linked = await addSourceComponent({ part, file, processGroup: 'Forging' });
    expect(api.post).toHaveBeenCalledWith('/bom-items', expect.objectContaining({
      bomId: 'bom', name: 'Back cover (source)', partNumber: 'BC-1-SRC', quantity: 2, annualVolume: 1000, materialGrade: 'AA 380', parentItemId: 'asm', itemType: 'child_part',
    }));
    expect(api.patch).toHaveBeenCalledWith('/bom-items/blank/scenario-overrides', { processGroup: 'Forging' });
    expect(api.patch.mock.invocationCallOrder[0]).toBeLessThan(api.uploadFiles.mock.invocationCallOrder[0] ?? 0);
    const [endpoint, form] = api.uploadFiles.mock.calls[0] ?? [];
    expect(endpoint).toBe('/bom-items/blank/files');
    expect(form?.get('file3d')).toBeInstanceOf(File);
    expect(api.put).toHaveBeenCalledWith('/bom-items/part/source-item', { sourceItemId: 'blank' }, expect.anything());
    expect(linked).toEqual({ id: 'part', sourceItemId: 'blank' });
  });

  it('deletes the half-made blank when a step fails, and reports the failure', async () => {
    api.uploadFiles.mockRejectedValue(new Error('the model could not be read'));
    await expect(addSourceComponent({ part, file, processGroup: 'Casting' })).rejects.toThrow('the model could not be read');
    expect(api.delete).toHaveBeenCalledWith('/bom-items/blank');
    expect(api.put).not.toHaveBeenCalled();
  });
});
