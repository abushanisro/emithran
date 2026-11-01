import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiKeyAuthService } from '../../modules/auth/api-key-auth.service';
import { IdentityService } from '../../modules/auth/identity.service';
import { API_KEY_PREFIX, type ApiKeyScope } from '../api-keys/api-key-scopes';
import { DatabaseService } from '../database/database.service';
import { API_KEY_SCOPES_KEY } from '../decorators/api-key-scopes.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { SessionActivityService } from '../session/session-activity.service';

@Injectable()
export class RequestAuthGuard implements CanActivate {
  private adminUserId: string | null = null;
  /** In-flight lookup, so concurrent requests share one round trip. */
  private adminUserIdLookup: Promise<string | null> | null = null;
  /** The configured bypass account, for the identity this guard reports. */
  private get adminUserEmail(): string {
    return this.databaseService.getAdminFallbackEmail() ?? '';
  }

  constructor(
    private reflector: Reflector,
    private databaseService: DatabaseService,
    private sessionActivity: SessionActivityService,
    private identity: IdentityService,
    private apiKeys: ApiKeyAuthService,
  ) {}

  /**
   * The development auth bypass needs an explicit opt-in (ALLOW_DEV_AUTH_BYPASS=true, default
   * off) AND a non-production environment. It must never activate in production, regardless of
   * whether ADMIN_FALLBACK_EMAIL happens to resolve to a real account. env.validation.ts
   * already refuses to boot if that variable is set with NODE_ENV=production; this is the
   * second, independent gate for the same rule, checked on every request rather than once
   * at startup, so a request never authenticates as admin in production for any reason.
   */
  private get bypassAllowed(): boolean {
    return this.databaseService.isDevAuthBypassEnabled();
  }

  /**
   * The real admin user's id, resolved once and awaited.
   *
   * This used to be kicked off in the constructor WITHOUT being awaited, so any
   * request arriving before that lookup resolved received the literal string
   * 'admin-fallback' as its user id. That string is not a uuid, so every write
   * carrying it into a uuid column failed — confirmed live: an apply-route call
   * failed with `invalid input syntax for type uuid: "admin-fallback"` after it
   * had already deleted the item's existing rows. A startup race, not a
   * dev-only quirk: the same window exists whenever the guard is constructed.
   *
   * Resolving lazily and awaiting removes the race. `null` here now means the
   * bypass has no identity at all, which getAdminFallbackUser turns into a
   * rejected request — the literal is gone entirely.
   */
  private async resolveAdminUserId(): Promise<string | null> {
    if (this.adminUserId !== null) return this.adminUserId;
    // Concurrent requests share one in-flight lookup.
    this.adminUserIdLookup ??= this.databaseService.getAdminUserId();
    this.adminUserId = await this.adminUserIdLookup;
    // Only a resolved id is kept. A failed lookup (e.g. a transient DNS or
    // network error reaching the database) returns null; keeping that promise
    // would reject every later bypass request until the process restarted,
    // so it is dropped and the next request looks the account up again.
    if (this.adminUserId === null) this.adminUserIdLookup = null;
    return this.adminUserId;
  }

  /**
   * The identity the development bypass acts as.
   *
   * Fails the request when no configured admin account resolves, instead of
   * substituting the literal 'admin-fallback'. That literal is not a uuid, so it
   * could never be persisted — it simply travelled until some write reached a
   * uuid column and was rejected there, after that write had already begun.
   * Confirmed live: an apply-route call died on
   * `invalid input syntax for type uuid: "admin-fallback"` having already
   * deleted the item's existing operations.
   *
   * Failing here is strictly earlier than any database mutation, and names the
   * one setting that fixes it. Production is unaffected: a real bearer token
   * goes through IdentityService and never reaches this path.
   */
  private async getAdminFallbackUser() {
    const id = await this.resolveAdminUserId();
    if (!id) {
      throw new UnauthorizedException(
        'No authenticated user, and the development auth bypass has no identity to act as. ' +
        'Set ADMIN_FALLBACK_EMAIL to an existing account, or send a valid bearer token.',
      );
    }
    return { id, email: this.adminUserEmail, role: 'admin' };
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const authHeader: unknown = request.headers.authorization;
    const token = typeof authHeader === 'string' && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;

    // Development fallback: no token at all → the configured bypass account. Never applies in production — see `bypassAllowed`.
    if (!token) {
      if (!this.bypassAllowed) {
        throw new UnauthorizedException('Authentication required');
      }
      const user = await this.getAdminFallbackUser();
      request.user = user;
      request.accessToken = this.databaseService.mintDbUserToken(user.id, { email: user.email });
      return true;
    }

    // API key: acts as its owner, but only on endpoints that declare @ApiKeyScopes, and only with every scope listed there. Keys
    // have their own expiry instead of the people-only inactivity timeout, so no session clock runs for them.
    if (token.startsWith(API_KEY_PREFIX)) {
      const login = await this.apiKeys.authenticate(token);
      const required = this.reflector.getAllAndOverride<ApiKeyScope[] | undefined>(API_KEY_SCOPES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);
      if (!required || required.length === 0) {
        await this.apiKeys.refuseScope(login.apiKey, login.user.id, 'api_key_endpoint_not_allowed');
        throw new ForbiddenException('This endpoint does not accept API keys');
      }
      const missing = required.filter((scope) => !login.apiKey.scopes.includes(scope));
      if (missing.length > 0) {
        await this.apiKeys.refuseScope(login.apiKey, login.user.id, 'api_key_scope_missing');
        throw new ForbiddenException(`This API key lacks the scope ${missing.join(', ')}`);
      }
      request.user = login.user;
      request.accessToken = login.dbToken;
      request.apiKey = login.apiKey;
      return true;
    }

    // Auth0: an invalid token, an uninvited person or an unreachable key set is rejected outright (the bypass above only covers a
    // request with no token at all). The inactivity timeout is enforced here so no client can skip it.
    const who = await this.identity.authenticate(token);
    await this.sessionActivity.assertActive(who.sessionId, who.user.id);
    request.user = who.user;
    request.accessToken = who.dbToken;
    request.sessionId = who.sessionId;
    return true;
  }
}
