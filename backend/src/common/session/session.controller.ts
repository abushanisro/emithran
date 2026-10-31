import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { IsIn } from 'class-validator';
import { CurrentUser } from '../decorators/current-user.decorator';
import { SessionId } from './session-id.decorator';
import { SessionActivityService, type ActivityKind } from './session-activity.service';
import { SESSION_IDLE_POLICY, sessionDeadline, type SessionActivityTimes } from './session-idle-policy';

export class SessionActivityDto {
  @IsIn(['user', 'job'])
  kind!: ActivityKind;
}

export interface SessionStatusDto {
  policy: typeof SESSION_IDLE_POLICY;
  /** False only for the development bypass, which has no sign-in session. */
  enforced: boolean;
  deadline: number | null;
}

/**
 * The inactivity timeout's two endpoints. RequestAuthGuard has already run
 * (and rejected an expired session) before either handler is reached.
 */
@ApiTags('Session')
@ApiBearerAuth()
@Controller({ path: 'api/auth/session', version: '1' })
export class SessionController {
  constructor(private readonly sessionActivity: SessionActivityService) {}

  @Get()
  // Next.js API routes call this for every request they serve, all from the
  // Next server's one IP, so the per-IP limit would throttle unrelated users.
  // Read-only and behind RequestAuthGuard; the heartbeat stays throttled.
  @SkipThrottle()
  @ApiOperation({ summary: 'Inactivity-timeout policy and this session\'s deadline. Does not count as activity.' })
  async status(
    @SessionId() sessionId: string | undefined,
    @CurrentUser('id') userId: string,
  ): Promise<SessionStatusDto> {
    if (!sessionId) return this.dto(null);
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
    if (!sessionId) return this.dto(null);
    return this.dto(await this.sessionActivity.recordActivity(sessionId, userId, body.kind));
  }

  private dto(times: SessionActivityTimes | null): SessionStatusDto {
    return {
      policy: SESSION_IDLE_POLICY,
      enforced: times !== null,
      deadline: times ? sessionDeadline(times) : null,
    };
  }
}
