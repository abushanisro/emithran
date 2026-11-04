import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api/config', () => ({ apiConfig: { endpoints: { api: { v1: '/api/v1' } } } }));
vi.mock('@/lib/auth/session-source', () => ({ sessionSource: {} }));

import { fetchSessionStatus } from '@/lib/auth/session-idle/browser';

const answer = (status: number, body: unknown) =>
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status, ok: status < 400, json: async () => body }));

afterEach(() => { vi.unstubAllGlobals(); });

describe('fetchSessionStatus', () => {
  it('reports that the server does not end idle sessions (switched off), so no countdown is started', async () => {
    answer(200, { data: { policy: { idleTimeoutMs: 1 }, enforced: false, deadline: null } });
    await expect(fetchSessionStatus()).resolves.toMatchObject({ ok: true, enforced: false });
  });

  it('reports an enforced session', async () => {
    answer(200, { data: { policy: {}, enforced: true, deadline: 123 } });
    await expect(fetchSessionStatus()).resolves.toMatchObject({ ok: true, enforced: true });
  });

  it('leaves enforcement unknown when the answer cannot be read, so the timeout runs as before', async () => {
    answer(503, null);
    const result = await fetchSessionStatus();
    expect(result).toEqual({ ok: false, idle: false });
  });

  it('still reads an idle sign-out from the server', async () => {
    answer(401, { code: 'SESSION_IDLE_TIMEOUT' });
    await expect(fetchSessionStatus()).resolves.toEqual({ ok: false, idle: true });
  });
});
