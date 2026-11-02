import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AccessToken } from '../../common/decorators/access-token.decorator';
import { CurrentOrganization } from '../../common/decorators/current-organization.decorator';
import { OrganizationContextGuard } from '../../common/guards/organization-context.guard';
import { SpendsAi } from '../../common/throttling/throttlers';
import { CopilotService, type CopilotEvent } from './copilot.service';
import { ConfirmMemoryProposalDto, CopilotChatDto, DeleteMemoryItemDto } from './dto/chat.dto';
import { CopilotMemoryService, type PreferenceChange } from './copilot-memory.service';

interface AuthUser {
  id: string;
}

@ApiTags('Copilot')
@ApiBearerAuth()
@Controller({ path: 'api/copilot', version: '1' })
export class CopilotController {
  constructor(
    private readonly copilot: CopilotService,
    private readonly memory: CopilotMemoryService,
  ) {}

  /** What the copilot has saved for this user (their own row only, RLS). */
  @Get('memory')
  @ApiOperation({ summary: 'List the preferences the copilot has saved for the current user' })
  async getMemory(@CurrentUser() user: AuthUser, @AccessToken() token: string): Promise<{ preferences: string[] }> {
    return { preferences: await this.memory.load(user.id, token) };
  }

  /** Forget everything the copilot has saved for this user. */
  @Delete('memory')
  @HttpCode(204)
  @ApiOperation({ summary: 'Clear the preferences the copilot has saved for the current user' })
  async clearMemory(@CurrentUser() user: AuthUser, @AccessToken() token: string): Promise<void> {
    await this.memory.clear(user.id, token);
  }

  /** Forget one saved preference (its exact text). */
  @Delete('memory/preferences')
  @ApiOperation({ summary: 'Delete one preference the copilot has saved for the current user' })
  async deleteMemoryItem(
    @Query() query: DeleteMemoryItemDto,
    @CurrentUser() user: AuthUser,
    @AccessToken() token: string,
  ): Promise<{ preferences: string[] }> {
    const change = await this.memory.remove(user.id, token, query.preference);
    return { preferences: change.preferences };
  }

  /**
   * The user pressed Save on a memory change the copilot proposed. The only way the copilot's proposals reach saved memory:
   * single use, within 10 minutes, for the same conversation and turn (410 otherwise).
   */
  @Post('memory/proposals/:id/confirm')
  @HttpCode(200)
  @ApiOperation({ summary: 'Save a memory change the copilot proposed' })
  async confirmMemoryProposal(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ConfirmMemoryProposalDto,
    @CurrentUser() user: AuthUser,
    @AccessToken() token: string,
  ): Promise<PreferenceChange> {
    return this.memory.confirm(user.id, token, id, dto.conversationId, dto.turn);
  }

  /**
   * Streams the answer as server-sent events, one JSON object per frame
   * (CopilotEvent). The response is written directly (not returned) so the
   * global TransformInterceptor does not wrap the stream. Anything that can
   * fail with a normal HTTP status (bad body, AI off or over budget, part not
   * visible to this user) is raised by prepare() before the stream opens.
   * Spend is charged to the organization the request acts for.
   */
  @Post('chat')
  @HttpCode(200)
  @SpendsAi() // each request runs up to 5 model calls on the server's key
  @UseGuards(OrganizationContextGuard)
  @ApiOperation({ summary: 'Ask the manufacturing copilot about one part (SSE stream)' })
  async chat(
    @Body() dto: CopilotChatDto,
    @CurrentUser() user: AuthUser,
    @AccessToken() token: string,
    @CurrentOrganization() organizationId: string,
    @Res() res: Response,
  ): Promise<void> {
    const prepared = await this.copilot.prepare(dto, { userId: user.id, organizationId, accessToken: token });

    const abort = new AbortController();
    const emit = (event: CopilotEvent) => {
      if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    try {
      res.status(200).set({
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.flushHeaders();
      res.on('close', () => {
        if (!res.writableFinished) abort.abort();
      });
      await this.copilot.stream(dto, prepared, emit, abort.signal);
    } finally {
      prepared.session.close(); // stream() closes it too; this covers a failure before it ran
      res.end();
    }
  }
}
