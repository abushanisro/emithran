import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = {
  get: vi.fn<(endpoint: string) => Promise<unknown>>(),
  post: vi.fn<(endpoint: string, body?: unknown) => Promise<unknown>>(),
  patch: vi.fn<(endpoint: string, body?: unknown) => Promise<unknown>>(),
  delete: vi.fn<(endpoint: string) => Promise<unknown>>(),
};
vi.mock('@/lib/api/client', () => ({ apiClient: api }));

const { organizationApi } = await import('@/lib/api/organization');

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset().mockResolvedValue(null);
});

describe('organizationApi (through the backend, not Supabase)', () => {
  it('reads the signed-in user\'s organization from the API', async () => {
    api.get.mockResolvedValue({ id: 'o1', name: 'Acme' });
    expect(await organizationApi.getMyOrganization()).toEqual({ id: 'o1', name: 'Acme' });
    expect(api.get).toHaveBeenCalledWith('/organizations/mine');
  });

  it('creates and updates organizations with the fields as typed', async () => {
    await organizationApi.createOrganization({ name: 'Acme', country: 'IN' });
    expect(api.post).toHaveBeenCalledWith('/organizations', { name: 'Acme', country: 'IN' });

    await organizationApi.updateOrganization('o1', { city: 'Pune' });
    expect(api.patch).toHaveBeenCalledWith('/organizations/o1', { city: 'Pune' });
  });

  it('scopes member and workspace changes to their organization', async () => {
    await organizationApi.inviteMember('o1', 'a@acme.com', 'admin');
    expect(api.post).toHaveBeenCalledWith('/organizations/o1/members', { email: 'a@acme.com', role: 'admin' });

    await organizationApi.removeMember('o1', 'm1');
    expect(api.delete).toHaveBeenCalledWith('/organizations/o1/members/m1');

    await organizationApi.deleteWorkspace('o1', 'w1');
    expect(api.delete).toHaveBeenCalledWith('/organizations/o1/workspaces/w1');
  });

  it('encodes ids, so an id cannot change the path', async () => {
    await organizationApi.getMembers('a/../b');
    expect(api.get).toHaveBeenCalledWith('/organizations/a%2F..%2Fb/members');
  });
});
