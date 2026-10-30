import { describe, expect, it, vi } from 'vitest';

const uploadFiles = vi.fn<(endpoint: string, form: FormData) => Promise<unknown>>();
vi.mock('@/lib/api/client', () => ({ apiClient: { uploadFiles } }));

const { profileApi } = await import('@/lib/api/profile');

describe('profileApi.uploadAvatar', () => {
  it('sends the photo to the backend as one "file" part, not to a storage service', async () => {
    uploadFiles.mockResolvedValue({ avatarUrl: 'https://files.test/avatars/u1/avatar' });
    const photo = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'me.png', { type: 'image/png' });

    expect(await profileApi.uploadAvatar(photo)).toEqual({ avatarUrl: 'https://files.test/avatars/u1/avatar' });
    const [endpoint, form] = uploadFiles.mock.calls[0] ?? [];
    expect(endpoint).toBe('/profile/avatar');
    expect(form?.get('file')).toBe(photo);
  });
});
