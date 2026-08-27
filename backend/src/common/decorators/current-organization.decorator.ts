import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Current Organization Decorator
 *
 * Extracts the organization id resolved by OrganizationContextGuard
 * (request.organizationId). Only meaningful on routes that guard runs on.
 *
 * @example
 * @CurrentOrganization() organizationId: string
 */
export const CurrentOrganization = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const request = ctx.switchToHttp().getRequest();
    return request.organizationId;
  },
);
