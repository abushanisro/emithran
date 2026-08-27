import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

/**
 * Resolves which organization the current request is acting on behalf of,
 * given the user already attached to the request by SupabaseAuthGuard.
 *
 * Deliberately not registered globally (unlike SupabaseAuthGuard) — apply it
 * per-controller as the org-scoping conversion reaches each module, so a
 * module that hasn't been converted yet is unaffected. See
 * memory/sheetmetal (project_manufacturing_intelligence_data_reconciliation)
 * and .claude/plans/delegated-gliding-swan.md for the phased rollout this
 * guard is Phase 1 of.
 *
 * Never silently defaults: zero memberships or an ambiguous multi-org
 * membership without a disambiguating header both reject the request rather
 * than guessing which organization's data to expose.
 */
@Injectable()
export class OrganizationContextGuard implements CanActivate {
  constructor(private readonly supabaseService: SupabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const userId: string | undefined = request.user?.id;

    if (!userId) {
      throw new ForbiddenException('No authenticated user on request.');
    }

    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', userId)
      .eq('status', 'active');

    if (error) {
      throw new ForbiddenException('Unable to resolve organization membership.');
    }

    const orgIds = [...new Set((data ?? []).map((row: any) => row.organization_id as string))];

    if (orgIds.length === 0) {
      throw new ForbiddenException('This account is not a member of any organization.');
    }

    if (orgIds.length === 1) {
      request.organizationId = orgIds[0];
      return true;
    }

    // Multiple active memberships — require an explicit choice rather than
    // silently defaulting to "the first one", since that would non-obviously
    // hide the other organization's data from the caller.
    const requestedOrgId = request.headers['x-organization-id'];
    if (!requestedOrgId || typeof requestedOrgId !== 'string') {
      throw new BadRequestException(
        'This account belongs to multiple organizations — specify which one via the X-Organization-Id header.',
      );
    }
    if (!orgIds.includes(requestedOrgId)) {
      throw new ForbiddenException('You are not a member of the requested organization.');
    }

    request.organizationId = requestedOrgId;
    return true;
  }
}
