import { Injectable, ServiceUnavailableException } from '@nestjs/common';

import { DatabaseService } from '../database/database.service';
import { effectiveOrgRole, type OrgRoleName } from './org-role';

/**
 * What the signed-in person may do, read as that person (their own database token: they can read their own memberships, and
 * is_platform_admin answers only for the caller). Never cached: removing a role or a platform admin takes effect on the next
 * request. A read that fails refuses the request (503) instead of guessing.
 */
@Injectable()
export class AccessService {
  constructor(private readonly database: DatabaseService) {}

  /** The role the person acts with across their active memberships (see effectiveOrgRole), or null without one. */
  async organizationRole(userId: string, accessToken: string): Promise<OrgRoleName | null> {
    const { data, error } = await this.database
      .getUserClient(accessToken)
      .from('organization_members')
      .select('role')
      .eq('user_id', userId)
      .eq('status', 'active');
    if (error) throw new ServiceUnavailableException('Unable to resolve organization role.');
    return effectiveOrgRole(((data ?? []) as Array<{ role: string }>).map((m) => m.role));
  }

  async isPlatformAdmin(userId: string, accessToken: string): Promise<boolean> {
    const { data, error } = await this.database.getUserClient(accessToken).rpc('is_platform_admin', { p_user_id: userId });
    if (error) throw new ServiceUnavailableException('Unable to resolve platform admin status.');
    return data === true;
  }
}
