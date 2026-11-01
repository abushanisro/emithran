import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Decorator to extract the user's access token from the request
 * Used to create the per-user database client, so row-level security applies
 */
export const AccessToken = createParamDecorator(
  (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.accessToken;
  },
);
