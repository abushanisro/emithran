import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { Authenticated } from '../authz/authz-policy';
import { CurrentUser } from '../decorators/current-user.decorator';
import { SessionId } from './session-id.decorator';
import { SessionActivityService, type ActivityKind } from './session-activity.service';
import { SESSION_IDLE_POLICY, idleTimeoutEnabled, sessionDeadline, type SessionActivityTimes } from './session-idle-policy';

export class SessionActivityDto {
  @IsIn(['user', 'job'])
  kind!: ActivityKind;
}

export interface SessionStatusDto {
  policy: typeof SESSION_IDLE_POLICY;
  /** False for the development bypass (no sign-in session) and when the inactivity timeout is switched off. */
  enforced: boolean;
  deadline: number | null;
}

/**
 * The session endpoints: inactivity-timeout status and heartbeat, and ending the session at logout. RequestAuthGuard has already run
 * (and rejected an expired or ended session) before any handler is reached.
 */
@ApiTags('Session')
@ApiBearerAuth()
@Authenticated()
@Controller({ path: 'auth/session', version: '1' })
export class SessionController {
  constructor(private readonly sessionActivity: SessionActivityService) {}

  @Get()
  @ApiOperation({ summary: 'Inactivity-timeout policy and this session\'s deadline. Does not count as activity.' })
  async status(
    @SessionId() sessionId: string | undefined,
    @CurrentUser('id') userId: string,
  ): Promise<SessionStatusDto> {
    if (!sessionId || !idleTimeoutEnabled()) return this.dto(null);
    return this.dto(await this.sessionActivity.assertActive(sessionId, userId));
  }

  @Post('activity')
  @HttpCode(200)
  @ApiOperation({ summary: 'Heartbeat: real user activity, or a protected CAD/BOM flow still running.' })
  async activity(
    @Body() body: SessionActivityDto,
    @SessionId() sessionId: string | undefined,
    @CurrentUser('id') userId: string,
  ): Promise<SessionStatusDto> {
    if (!sessionId || !idleTimeoutEnabled()) return this.dto(null);
    return this.dto(await this.sessionActivity.recordActivity(sessionId, userId, body.kind));
  }

  @Post('end')
  @HttpCode(204)
  @ApiOperation({ summary: 'Logout: ends this session on the server, so a copied session cookie is refused from now on.' })
  async end(@SessionId() sessionId: string | undefined, @CurrentUser('id') userId: string): Promise<void> {
    if (sessionId) await this.sessionActivity.end(sessionId, userId);
  }

  private dto(times: SessionActivityTimes | null): SessionStatusDto {
    return {
      policy: SESSION_IDLE_POLICY,
      enforced: times !== null,
      deadline: times ? sessionDeadline(times) : null,
    };
  }
}
