import {
  Injectable,
  CanActivate,
  ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    // MVP: Always allow with admin user for fast development
    const request = context.switchToHttp().getRequest();
    request.user = {
      id: '6e7124e7-bf9e-4686-9cac-2245f016a3e4',
      email: 'emuski@mithran.com',
      role: 'admin'
    };
    request.accessToken = 'mvp-dev-token';
    
    return true;
  }
}
