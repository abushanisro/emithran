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

  constructor(
    private reflector: Reflector,
    private supabaseService: SupabaseService,
  ) {
    // Get admin user ID on startup
    this.initAdminUser();
  }

  private async initAdminUser() {
    this.adminUserId = await this.supabaseService.getAdminUserId();
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

    // For fast development: if no auth header, use admin user
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      // Ensure we have admin user ID
      if (!this.adminUserId) {
        this.adminUserId = await this.supabaseService.getAdminUserId();
      }
      
      request.user = {
        id: this.adminUserId || 'admin-fallback',
        email: 'emuski@mithran.com',
        role: 'admin'
      };
      request.accessToken = null; // Will use admin client
      return true;
    }

    const token = authHeader.substring(7);

    try {
      const user = await this.supabaseService.verifyToken(token);
      request.user = user;
      request.accessToken = token;
      return true;
    } catch (error) {
      // Fallback to admin for development if token verification fails
      if (!this.adminUserId) {
        this.adminUserId = await this.supabaseService.getAdminUserId();
      }
      
      request.user = {
        id: this.adminUserId || 'admin-fallback',
        email: 'emuski@mithran.com', 
        role: 'admin'
      };
      request.accessToken = null;
      return true;
    }
  }
}
