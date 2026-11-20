import { Body, Controller, Get, HttpCode, Post, Req, UnauthorizedException } from '@nestjs/common';
import { IsString } from 'class-validator';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { AccessService } from '../../common/authz/access.service';
import { Authenticated } from '../../common/authz/authz-policy';
import type { OrgRoleName } from '../../common/authz/org-role';
import { AccessToken } from '../../common/decorators/access-token.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { SessionActivityService } from '../../common/session/session-activity.service';
import { idleTimeoutEnabled } from '../../common/session/session-idle-policy';
import { IdentityService } from './identity.service';

export class SessionStartDto {
  /** The ID token of the sign-in that just completed (the app's server has it from the Auth0 callback). */
  @IsString()
  idToken!: string;
}

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
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(
    private readonly access: AccessService,
    private readonly identity: IdentityService,
    private readonly sessionActivity: SessionActivityService,
  ) {}

  /**
   * A sign-in just completed (the app's Auth0 callback calls this, server to server, with the new tokens). Auth0 keeps its session id
   * across a re-authentication, so the inactivity clock of an Auth0 session left idle would refuse the new sign-in's first request and
   * sign the person out (they had to sign in twice). The clock restarts here, only for a proven new sign-in: the ID token of the same
   * person and Auth0 session, authenticated within the last minutes and after the session's last activity. Public to the request guard
   * (its idle check is what this answers); it authenticates the access token itself.
   */
  @Public()
  @Post('sign-ins')
  @HttpCode(204)
  @ApiOperation({ summary: 'A new sign-in: restarts the inactivity clock of its Auth0 session (proven by the sign-in\'s ID token).' })
  async startSession(@Req() req: { headers: Record<string, unknown> }, @Body() body: SessionStartDto): Promise<void> {
    const header = req.headers['authorization'];
    const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new UnauthorizedException('Authentication required');
    const signIn = await this.identity.verifyNewSignIn(token, body.idToken);
    if (idleTimeoutEnabled()) await this.sessionActivity.restart(signIn.sessionId, signIn.user.id, signIn.authTimeMs);
  }

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
