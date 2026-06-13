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
  private adminUserIdFetched = false; // true once we've attempted — avoids per-request retries

  constructor(
    private reflector: Reflector,
    private supabaseService: SupabaseService,
  ) {
    this.initAdminUser();
  }

  private async initAdminUser() {
    this.adminUserId = await this.supabaseService.getAdminUserId();
    this.adminUserIdFetched = true;
  }

  private getAdminFallbackUser() {
    return {
      id: this.adminUserId ?? 'admin-fallback',
      email: 'emuski@mithran.com',
      role: 'admin',
    };
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
      request.user = this.getAdminFallbackUser();
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
      request.user = this.getAdminFallbackUser();
      request.accessToken = null;
      return true;
    }
  }
}
