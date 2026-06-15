import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Logger,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AccessToken } from '../../common/decorators/access-token.decorator';

import { ChatRequestDto } from './dto/chat-request.dto';
import {
  ConversationDetailDto,
  ConversationSummaryDto,
} from './dto/conversation.dto';
import { AlertDto } from './dto/alert.dto';
import { SuggestionDto } from './dto/suggestion.dto';
import { HintDto } from './dto/hint.dto';

import { EchoService } from './services/echo.service';
import { ConversationService } from './services/conversation.service';
import { AlertsService } from './services/alerts.service';
import { SuggestionService } from './services/suggestion.service';
import { HintsService } from './services/hints.service';

interface AuthUser {
  id: string;
  email?: string;
  role?: string;
}

@ApiTags('Echo')
@ApiBearerAuth()
@Controller({ path: 'api/echo', version: '1' })
export class EchoController {
  private readonly logger = new Logger(EchoController.name);

  constructor(
    private readonly echo: EchoService,
    private readonly conversations: ConversationService,
    private readonly alerts: AlertsService,
    private readonly suggestions: SuggestionService,
    private readonly hints: HintsService,
  ) {}

  /**
   * POST /api/echo/chat
   *
   * Streams a Server-Sent-Event response. Each event is `data: <json>` per the
   * `ChatEvent` discriminated union. Emits `conversation_started`,
   * `skill_selected`, `context_hydrated`, `token` (many), `tool_call_*`,
   * `message_complete`, `error`.
   *
   * Uses POST (vs. GET + @Sse) because we need a JSON body. The browser reads
   * the streaming response via `fetch().body.getReader()` and parses SSE
   * frames manually — supported in all evergreen browsers.
   */
  @Post('chat')
  @ApiOperation({ summary: 'Streaming chat (SSE over POST)' })
  async chat(
    @Body() body: ChatRequestDto,
    @CurrentUser() user: AuthUser,
    @AccessToken() token: string | null,
    @Res() res: Response,
  ): Promise<void> {
    if (!user?.id) throw new BadRequestException('User authentication required');
    if (!body?.message) throw new BadRequestException('message is required');
    if (!body?.pageContext?.route) throw new BadRequestException('pageContext.route is required');

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // disable proxy buffering (nginx)
    res.flushHeaders?.();

    const stream$ = this.echo.chatStream({ body, userId: user.id, accessToken: token });

    await new Promise<void>((resolve) => {
      let closed = false;
      const finish = () => {
        if (closed) return;
        closed = true;
        try { res.end(); } catch { /* response already closed */ }
        resolve();
      };

      // Heartbeat every 15s to keep proxies/CDNs from killing the connection.
      const heartbeat = setInterval(() => {
        if (closed) return;
        try { res.write(': ping\n\n'); } catch { /* ignore */ }
      }, 15_000);

      const subscription = stream$.subscribe({
        next: (ev) => {
          if (closed) return;
          try {
            const payload = typeof ev.data === 'string' ? ev.data : JSON.stringify(ev.data);
            res.write(`data: ${payload}\n\n`);
          } catch {
            // Backpressure or socket closed; let the close handler tear down.
          }
        },
        complete: () => { clearInterval(heartbeat); finish(); },
        error: (err) => {
          clearInterval(heartbeat);
          try {
            const errBody = JSON.stringify({
              type: 'error',
              data: { message: String(err?.message ?? err), recoverable: false },
            });
            res.write(`data: ${errBody}\n\n`);
          } catch { /* ignore */ }
          finish();
        },
      });

      res.on('close', () => {
        subscription.unsubscribe();
        clearInterval(heartbeat);
        finish();
      });
    });
  }

  // ── Conversations ────────────────────────────────────────────────────────

  @Get('conversations')
  @ApiOperation({ summary: 'List current user\'s conversations' })
  @ApiResponse({ status: 200, type: [ConversationSummaryDto] })
  async listConversations(
    @CurrentUser() user: AuthUser,
    @AccessToken() token: string | null,
    @Query('limit') limit?: number,
  ): Promise<ConversationSummaryDto[]> {
    if (!user?.id) throw new BadRequestException('User authentication required');
    return this.conversations.listConversations({
      ownerId: user.id,
      accessToken: token,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('conversations/:id')
  @ApiOperation({ summary: 'Get a conversation with full message history' })
  @ApiResponse({ status: 200, type: ConversationDetailDto })
  async getConversation(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @AccessToken() token: string | null,
  ): Promise<ConversationDetailDto> {
    if (!user?.id) throw new BadRequestException('User authentication required');
    return this.conversations.getConversation({
      conversationId: id,
      ownerId: user.id,
      accessToken: token,
    });
  }

  @Delete('conversations/:id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Archive (soft-delete) a conversation' })
  async archiveConversation(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @AccessToken() token: string | null,
  ): Promise<void> {
    if (!user?.id) throw new BadRequestException('User authentication required');
    await this.conversations.archiveConversation({
      conversationId: id,
      ownerId: user.id,
      accessToken: token,
    });
  }

  // ── Alerts ───────────────────────────────────────────────────────────────

  @Get('alerts')
  @ApiOperation({ summary: 'List active alerts for the current user' })
  @ApiResponse({ status: 200, type: [AlertDto] })
  async listAlerts(
    @CurrentUser() user: AuthUser,
    @AccessToken() token: string | null,
    @Query('refresh') refresh?: string,
  ): Promise<AlertDto[]> {
    if (!user?.id) throw new BadRequestException('User authentication required');
    return this.alerts.listForUser({
      ownerId: user.id,
      accessToken: token,
      refresh: refresh === 'true' || refresh === '1',
    });
  }

  @Post('alerts/:id/dismiss')
  @HttpCode(204)
  @ApiOperation({ summary: 'Dismiss an alert' })
  async dismissAlert(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @AccessToken() token: string | null,
  ): Promise<void> {
    if (!user?.id) throw new BadRequestException('User authentication required');
    await this.alerts.dismiss({
      alertId: id,
      ownerId: user.id,
      accessToken: token,
    });
  }

  // ── Suggestions ──────────────────────────────────────────────────────────

  @Get('suggestions')
  @ApiOperation({ summary: 'Get smart suggestions for the current route + entity' })
  @ApiResponse({ status: 200, type: [SuggestionDto] })
  async listSuggestions(
    @CurrentUser() user: AuthUser,
    @AccessToken() token: string | null,
    @Query('route') route: string,
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
  ): Promise<SuggestionDto[]> {
    if (!user?.id) throw new BadRequestException('User authentication required');
    if (!route) throw new BadRequestException('route query param is required');
    return this.suggestions.list({
      ownerId: user.id,
      accessToken: token,
      route,
      entityType,
      entityId,
    });
  }

  @Post('suggestions/dismiss')
  @HttpCode(204)
  @ApiOperation({ summary: 'Dismiss a suggestion for this route' })
  async dismissSuggestion(
    @CurrentUser() user: AuthUser,
    @AccessToken() token: string | null,
    @Body() body: { route: string; suggestionId: string },
  ): Promise<void> {
    if (!user?.id) throw new BadRequestException('User authentication required');
    if (!body?.route || !body?.suggestionId) {
      throw new BadRequestException('route and suggestionId are required');
    }
    await this.suggestions.dismiss({
      ownerId: user.id,
      accessToken: token,
      route: body.route,
      suggestionId: body.suggestionId,
    });
  }

  // ── Hints ────────────────────────────────────────────────────────────────

  @Get('hints')
  @ApiOperation({ summary: 'Get a hint by topic for the current route' })
  @ApiResponse({ status: 200, type: HintDto })
  async getHint(
    @CurrentUser() user: AuthUser,
    @AccessToken() token: string | null,
    @Query('route') route: string,
    @Query('topic') topic: string,
  ): Promise<HintDto> {
    if (!user?.id) throw new BadRequestException('User authentication required');
    if (!route || !topic) throw new BadRequestException('route and topic are required');
    return this.hints.findByTopic({ accessToken: token, route, topicId: topic });
  }

  @Get('hints/by-route')
  @ApiOperation({ summary: 'List all hints relevant to a route' })
  @ApiResponse({ status: 200, type: [HintDto] })
  async listHintsByRoute(
    @CurrentUser() user: AuthUser,
    @AccessToken() token: string | null,
    @Query('route') route: string,
  ): Promise<HintDto[]> {
    if (!user?.id) throw new BadRequestException('User authentication required');
    if (!route) throw new BadRequestException('route is required');
    return this.hints.listByRoute({ accessToken: token, route });
  }
}
