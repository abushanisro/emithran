import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AccessService } from '../../common/authz/access.service';
import { Authenticated } from '../../common/authz/authz-policy';
import type { OrgRoleName } from '../../common/authz/org-role';
import { AccessToken } from '../../common/decorators/access-token.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

interface User { id: string; email: string; [key: string]: unknown }

export interface Me {
  id: string;
  email: string;
  /** The role the person acts with in their organization (AuthzGuard decides with the same value), null without a membership. */
  organizationRole: OrgRoleName | null;
  /** Whether the person is a platform administrator (platform_admins, migration 943). */
  platformAdmin: boolean;
}

@ApiTags('Auth')
@ApiBearerAuth()
@Authenticated()
@Controller({ path: 'api/auth', version: '1' })
export class AuthController {
  constructor(private readonly access: AccessService) {}

  /**
   * Who am I. The app-wide guard has already refused anyone who is not signed in or not invited (401/403), so reaching this
   * means the login is good: the sign-in callback calls it to learn whether to let the person in. The app reads the role from
   * here to show only the controls the person may use; the API enforces it regardless.
   */
  @Get('me')
  @ApiOperation({ summary: 'The signed-in, authorised user, with their organization role' })
  async me(@CurrentUser() user: User, @AccessToken() token: string): Promise<Me> {
    const [organizationRole, platformAdmin] = await Promise.all([
      this.access.organizationRole(user.id, token),
      this.access.isPlatformAdmin(user.id, token),
    ]);
    return { id: user.id, email: user.email, organizationRole, platformAdmin };
  }
}
