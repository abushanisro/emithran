import { apiConfig } from '@/lib/api/config';
import { SESSION_IDLE_TIMEOUT_CODE } from '@/lib/auth/session-idle/policy';

export type CallerCheck =
  | { status: 'ok'; userId: string }
  | { status: 'idle' | 'invalid' | 'forbidden' | 'unavailable' };

/**
 * Who is behind this Auth0 access token? One call to the backend, which already verifies the token, checks the person is invited and
 * enforces the inactivity deadline, so a Next.js route never repeats any of that.
 */
export async function resolveAuth0Caller(accessToken: string, fetcher: typeof fetch = fetch): Promise<CallerCheck> {
  try {
    const res = await fetcher(`${apiConfig.endpoints.api.v1}/auth/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(5_000),
    });
    const body = (await res.json().catch(() => null)) as { data?: { id?: string }; error?: { code?: string } } | null;
    if (res.ok) return body?.data?.id ? { status: 'ok', userId: body.data.id } : { status: 'unavailable' };
    if (res.status === 401) return { status: body?.error?.code === SESSION_IDLE_TIMEOUT_CODE ? 'idle' : 'invalid' };
    if (res.status === 403) return { status: 'forbidden' };
    return { status: 'unavailable' };
  } catch {
    return { status: 'unavailable' };
  }
}
