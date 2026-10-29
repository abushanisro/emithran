import { apiClient } from '@/lib/api/client';
import { apiConfig } from '@/lib/api/config';
import { sessionSource } from '@/lib/auth/session-source';

import { SESSION_IDLE_TIMEOUT_CODE } from './policy';

import type { ServerResult } from './controller';

/** The backend's response envelope, as far as these calls read it. */
type SessionResponse = {
  error?: { code?: string };
  data?: { policy?: unknown };
} | null;

const NOTICE_KEY = 'emithran.sessionIdle.signedOutNotice';

/**
 * Calls the session endpoints with plain fetch rather than apiClient: a
 * heartbeat must not be retried, cached, queued behind the circuit breaker, or
 * turned into a global sign-out by the generic 401 handling.
 */
async function call(method: 'GET' | 'POST', path: string, body?: unknown): Promise<ServerResult> {
  const token = await apiClient.getAuthToken();
  if (!token) return { ok: false, idle: false };
  try {
    const res = await fetch(`${apiConfig.endpoints.api.v1}/auth/session${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? null : JSON.stringify(body),
      cache: 'no-store',
    });
    const json = (await res.json().catch(() => null)) as SessionResponse;
    if (res.status === 401 && json?.error?.code === SESSION_IDLE_TIMEOUT_CODE) return { ok: false, idle: true };
    if (!res.ok) return { ok: false, idle: false };
    return { ok: true, policy: json?.data?.policy };
  } catch {
    return { ok: false, idle: false };
  }
}

export const fetchSessionStatus = () => call('GET', '');
export const sendSessionHeartbeat = (kind: 'user' | 'job') => call('POST', '/activity', { kind });

/**
 * Ends this session for inactivity: remembers the page so login returns to it
 * (AppLayout restores sessionStorage.redirectAfterAuth), ends only THIS
 * device's session, then fully reloads into /auth so no previous data stays in memory.
 */
export async function signOutForInactivity(): Promise<void> {
  try {
    const here = window.location.pathname + window.location.search;
    if (here !== '/' && !here.startsWith('/auth')) sessionStorage.setItem('redirectAfterAuth', here);
    sessionStorage.setItem(NOTICE_KEY, '1');
  } catch {
    // storage blocked: still sign out
  }
  try {
    await sessionSource.signOutThisDevice();
  } catch {
    // the server has already ended the session or will on the next request
  }
  window.location.replace('/auth');
}

/** True once, after an inactivity sign-out, so the login page can say why. */
export function consumeInactivitySignOutNotice(): boolean {
  try {
    if (sessionStorage.getItem(NOTICE_KEY) !== '1') return false;
    sessionStorage.removeItem(NOTICE_KEY);
    return true;
  } catch {
    return false;
  }
}
