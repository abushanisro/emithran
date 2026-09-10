import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SupabaseService } from '../supabase/supabase.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  private adminUserId: string | null = null;
  /** In-flight lookup, so concurrent requests share one round trip. */
  private adminUserIdLookup: Promise<string | null> | null = null;
  /** The configured bypass account, for the identity this guard reports. */
  private get adminUserEmail(): string {
    return this.supabaseService.getAdminFallbackEmail() ?? '';
  }

  constructor(
    private reflector: Reflector,
    private supabaseService: SupabaseService,
  ) {}

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
    this.adminUserIdLookup ??= this.supabaseService.getAdminUserId();
    this.adminUserId = await this.adminUserIdLookup;
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
   * resolves through verifyToken and never reaches this path.
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
    const authHeader = request.headers.authorization;

    // Extract token from either Authorization header (normal case) OR ?token=
    // query string (used by EventSource SSE, which can't send custom headers).
    let token: string | null = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    } else if (typeof request.query?.token === 'string' && request.query.token) {
      token = request.query.token as string;
    }

    // Development fallback: no token at all → use cached admin user
    if (!token) {
      request.user = await this.getAdminFallbackUser();
      request.accessToken = null;
      return true;
    }

    try {
      const user = await this.supabaseService.verifyToken(token);
      request.user = user;
      request.accessToken = token;
      return true;
    } catch {
      // Token invalid → development fallback, no network call
      request.user = await this.getAdminFallbackUser();
      request.accessToken = null;
      return true;
    }
  }
}
