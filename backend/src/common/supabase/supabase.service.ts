import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SupabaseClient } from '@supabase/supabase-js';

import { DbTokenMinter } from '../db/db-token';
import { createDbClient } from '../db/postgrest-client';
import { currentRequestAuth } from '../request-context/request-auth-context';

/**
 * Database clients for the PostgREST in front of plain Postgres. Every token PostgREST accepts is signed here with DB_JWT_SECRET: a
 * user's token (RLS sees the user through auth.uid()) or the service token for the privileged client. The class keeps its historical
 * name and the `.from()` / `.rpc()` client surface, so the modules that still use it are unchanged until they move to Kysely.
 */
@Injectable()
export class SupabaseService {
  private readonly logger = new Logger(SupabaseService.name);
  private readonly postgrestUrl: string;
  private readonly minter: DbTokenMinter;

  constructor(private readonly configService: ConfigService) {
    this.postgrestUrl = this.configService.getOrThrow<string>('POSTGREST_URL');
    this.minter = new DbTokenMinter(this.configService.getOrThrow<string>('DB_JWT_SECRET'));
  }

  /** A client that acts as the user behind `accessToken` (a database token this backend signed), so RLS applies. */
  getClient(accessToken: string): SupabaseClient {
    // Never fall back to the privileged client: a lost or missing token must fail closed, not silently bypass RLS.
    if (typeof accessToken !== 'string' || accessToken.trim() === '') {
      throw new UnauthorizedException('Access token is required for a user-scoped database client');
    }
    return createDbClient(this.postgrestUrl, accessToken);
  }

  /**
   * RLS-enforced client for the CURRENT authenticated request, taking the token from the request-scoped auth context
   * (RequestAuthInterceptor). Throws when there is no authenticated request in scope (public route, background job, lost async
   * context) instead of degrading to the privileged client.
   */
  getUserClient(explicitAccessToken?: string | null): SupabaseClient {
    if (typeof explicitAccessToken === 'string' && explicitAccessToken.trim() !== '') {
      return this.getClient(explicitAccessToken);
    }
    const auth = currentRequestAuth();
    if (!auth) {
      throw new UnauthorizedException(
        'No authenticated request in scope. Use getPrivilegedClient(reason) only for work that genuinely has no user context.',
      );
    }
    return this.getClient(auth.accessToken);
  }

  /**
   * The ONLY sanctioned way to get the privileged client (bypasses RLS). `reason` is mandatory and logged at debug level so every
   * privileged access is searchable and reviewable, e.g. 'reference-data: sm_reference_data'.
   */
  getPrivilegedClient(reason: string): SupabaseClient {
    if (!reason || !reason.trim()) {
      throw new Error('getPrivilegedClient requires a non-empty reason');
    }
    this.logger.debug(`privileged client: ${reason}`);
    return createDbClient(this.postgrestUrl, this.minter.forService());
  }

  /** The token PostgREST trusts for this user (RLS sees `userId` through auth.uid()). */
  mintDbUserToken(userId: string, extra: { email?: string; sessionId?: string } = {}): string {
    return this.minter.forUser(userId, extra);
  }

  /**
   * Whether the development auth bypass may serve a request that has no token. Both conditions are required: not production, and
   * ALLOW_DEV_AUTH_BYPASS explicitly 'true' (default 'false'). Having ADMIN_FALLBACK_EMAIL configured is not enough.
   */
  isDevAuthBypassEnabled(): boolean {
    return process.env.NODE_ENV !== 'production' && this.configService.get<string>('ALLOW_DEV_AUTH_BYPASS') === 'true';
  }

  /** The account the development bypass acts as. No default: which identity a bypass assumes is configuration, not code. */
  getAdminFallbackEmail(): string | null {
    return this.configService.get<string>('ADMIN_FALLBACK_EMAIL')?.trim() || null;
  }

  /** The bypass account's user id, or null (logged) when ADMIN_FALLBACK_EMAIL is unset or matches nobody. */
  async getAdminUserId(): Promise<string | null> {
    const adminEmail = this.getAdminFallbackEmail();
    if (!adminEmail) {
      this.logger.warn(
        'ADMIN_FALLBACK_EMAIL is not set — the development auth bypass has no account to act as. Requests without a bearer token will be rejected.',
      );
      return null;
    }
    const { data, error } = await this.getPrivilegedClient('dev-bypass: find ADMIN_FALLBACK_EMAIL in the directory').rpc(
      'directory_find_by_email',
      { p_email: adminEmail },
    );
    if (error) {
      this.logger.warn(`Failed to get admin user ID: ${error.message}`);
      return null;
    }
    const id = (data as string | null) ?? null;
    if (!id) this.logger.warn(`No account matches ADMIN_FALLBACK_EMAIL '${adminEmail}'.`);
    return id;
  }
}
