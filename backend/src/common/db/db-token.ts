import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The tokens the BACKEND signs for PostgREST. PostgREST trusts exactly one secret (DB_JWT_SECRET) and nothing from the outside world:
 * the backend has already authenticated the caller (Auth0), so it re-states who they are in the one form the database understands:
 * `sub` = the internal user uuid (what auth.uid() returns), `role` = the Postgres role to switch to. HS256 with Node's own crypto: no
 * dependency, and PostgREST accepts it directly.
 */
export type DbRole = 'authenticated' | 'service_role';

export interface DbClaims {
  role: DbRole;
  sub?: string;
  email?: string;
  session_id?: string;
  [claim: string]: unknown;
}

const ISSUER = 'emithran-backend';
const MIN_SECRET_LENGTH = 32;
const REFRESH_BEFORE_EXPIRY_MS = 30_000;
const MAX_CACHED = 10_000;

const encode = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url');
const sign = (secret: string, input: string): string => createHmac('sha256', secret).update(input).digest('base64url');

export class DbTokenMinter {
  private readonly cache = new Map<string, { token: string; expiresAtMs: number }>();

  constructor(
    private readonly secret: string,
    private readonly ttlSeconds = 300,
    private readonly now: () => number = Date.now,
  ) {
    if (secret.length < MIN_SECRET_LENGTH) throw new Error(`DB_JWT_SECRET must be at least ${MIN_SECRET_LENGTH} characters`);
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 3600) throw new Error('the database token lifetime must be 60 to 3600 seconds');
  }

  /** For a signed-in user: RLS sees `userId` through auth.uid(). */
  forUser(userId: string, extra: { email?: string; sessionId?: string } = {}): string {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) throw new Error('a database token needs the internal user uuid');
    return this.issue(`user:${userId}:${extra.email ?? ''}:${extra.sessionId ?? ''}`, {
      role: 'authenticated',
      sub: userId,
      ...(extra.email && { email: extra.email }),
      ...(extra.sessionId && { session_id: extra.sessionId }),
    });
  }

  /** For the backend's own privileged work (bypasses RLS: callers must justify it, see getPrivilegedClient). */
  forService(): string {
    return this.issue('service', { role: 'service_role' });
  }

  private issue(cacheKey: string, claims: DbClaims): string {
    const nowMs = this.now();
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAtMs - REFRESH_BEFORE_EXPIRY_MS > nowMs) return cached.token;

    // No `iat`: PostgREST rejects a token issued "in the future", which happens whenever the database's clock trails the backend's
    // (a laptop's Docker VM after sleep). The lifetime is bounded by `exp` alone.
    const exp = Math.floor(nowMs / 1000) + this.ttlSeconds;
    const head = encode({ alg: 'HS256', typ: 'JWT' });
    const body = encode({ ...claims, iss: ISSUER, exp });
    const token = `${head}.${body}.${sign(this.secret, `${head}.${body}`)}`;

    if (this.cache.size >= MAX_CACHED) this.cache.delete(this.cache.keys().next().value as string); // oldest first
    this.cache.set(cacheKey, { token, expiresAtMs: exp * 1000 });
    return token;
  }
}

/** What PostgREST does with a token, for tests and tooling: the claims when the signature and lifetime hold, otherwise an error. */
export function verifyDbToken(token: string, secret: string, nowMs: number = Date.now()): DbClaims {
  const [head, body, signature, ...extra] = token.split('.');
  if (!head || !body || !signature || extra.length > 0) throw new Error('not a JWT');
  const expected = Buffer.from(sign(secret, `${head}.${body}`));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) throw new Error('bad signature');
  const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as DbClaims & { exp?: number };
  if (typeof claims.exp !== 'number' || claims.exp * 1000 <= nowMs) throw new Error('expired');
  return claims;
}
