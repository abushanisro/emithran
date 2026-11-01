import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { DatabaseService } from '../database/database.service';

/**
 * Resolves which organization the current request is acting on behalf of,
 * given the user already attached to the request by RequestAuthGuard.
 *
 * Deliberately not registered globally (unlike RequestAuthGuard) — apply it
 * per-controller as the org-scoping conversion reaches each module, so a
 * module that hasn't been converted yet is unaffected. See
 * memory/sheetmetal (project_manufacturing_intelligence_data_reconciliation)
 * and the internal plan for the phased rollout this
 * guard is Phase 1 of.
 *
 * Never silently defaults: zero memberships or an ambiguous multi-org
 * membership without a disambiguating header both reject the request rather
 * than guessing which organization's data to expose.
 */
@Injectable()
export class OrganizationContextGuard implements CanActivate {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const userId: string | undefined = request.user?.id;

    if (!userId) {
      throw new ForbiddenException('No authenticated user on request.');
    }

    const { data, error } = await this.databaseService
      .getPrivilegedClient('auth: resolve organization membership before an org context exists')
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', userId)
      .eq('status', 'active');

    if (error) {
      throw new ForbiddenException('Unable to resolve organization membership.');
    }

    const orgIds = [...new Set((data ?? []).map((row: any) => row.organization_id as string))];

    if (orgIds.length === 0) {
      await this.denied('no_membership', userId);
      throw new ForbiddenException('This account is not a member of any organization.');
    }

    // Explicit selection must be validated even for a single membership:
    // never silently replace a requested organization with a different one.
    const requestedOrgId = request.headers['x-organization-id'];
    if (requestedOrgId !== undefined) {
      if (typeof requestedOrgId !== 'string' || !requestedOrgId) {
        throw new BadRequestException('X-Organization-Id must be a non-empty string.');
      }
      if (!orgIds.includes(requestedOrgId)) {
        await this.denied('not_a_member', userId, requestedOrgId);
        throw new ForbiddenException('You are not a member of the requested organization.');
      }
      request.organizationId = requestedOrgId;
      return true;
    }

    if (orgIds.length === 1) {
      request.organizationId = orgIds[0];
      return true;
    }

    // Multiple active memberships require an explicit choice.
    throw new BadRequestException(
      'This account belongs to multiple organizations — specify which one via the X-Organization-Id header.',
    );
  }

  // The request interceptor has not run yet, so the actor is named here. De-duplicated per user and reason by the audit service.
  private denied(reason: string, userId: string, organizationId?: string): Promise<void> {
    return this.audit.recordDenied(reason, userId, { organizationId, actor: { kind: 'user', userId } });
  }
}
