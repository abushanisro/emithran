import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * The Supabase session id SupabaseAuthGuard checked for this request, or
 * undefined for the development bypass (which has no idle timeout).
 */
export const SessionId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => ctx.switchToHttp().getRequest().sessionId,
);
