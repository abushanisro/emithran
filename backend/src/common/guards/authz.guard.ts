import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { AuditService } from '../audit/audit.service';
import { AccessService } from '../authz/access.service';
import { resolveAuthzPolicy } from '../authz/authz-policy';
import { satisfiesOrgRole } from '../authz/org-role';

/**
 * Default-deny authorization, registered app-wide right after RequestAuthGuard (which has established who is calling).
 *
 * Every route must declare a policy (common/authz/authz-policy.ts). A route without one is refused with 403 and logged as an
 * error, so a forgotten declaration fails closed in production as well as in the route inventory test. Refusals for a missing
 * role are recorded in the audit trail (auth.forbidden), de-duplicated per person and reason.
 */
@Injectable()
export class AuthzGuard implements CanActivate {
  private readonly logger = new Logger(AuthzGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return false;
    const handler = context.getHandler();
    const controller = context.getClass();
    const policy = resolveAuthzPolicy(this.reflector, handler, controller);
    const route = `${controller.name}.${handler.name}`;

    if (!policy) {
      this.logger.error(`${route} declares no authorization policy; refused. Add @Public, @Authenticated, @OrgRole or @PlatformAdmin.`);
      throw new ForbiddenException('This endpoint has no authorization policy.');
    }
    if (policy.kind === 'public') return true;

    const request = context.switchToHttp().getRequest();
    const userId: string | undefined = request.user?.id;
    const token: string | undefined = request.accessToken;
    if (!userId || !token) throw new ForbiddenException('No authenticated user on request.');
    if (policy.kind === 'authenticated') return true;

    if (policy.kind === 'platform_admin') {
      if (await this.access.isPlatformAdmin(userId, token)) return true;
      return this.refuse('platform_admin_required', userId, route, 'This action is for platform administrators.');
    }

    const role = await this.access.organizationRole(userId, token);
    if (satisfiesOrgRole(role, policy.role)) return true;
    return this.refuse(`org_role_${policy.role}_required`, userId, route, `This action needs the ${policy.role} role in your organization.`);
  }

  private async refuse(reason: string, userId: string, route: string, message: string): Promise<never> {
    this.logger.warn(`${route} refused for ${userId}: ${reason}`);
    // The request interceptor has not run yet, so the actor is named here.
    await this.audit.recordDenied(reason, userId, { actor: { kind: 'user', userId } });
    throw new ForbiddenException(message);
  }
}
