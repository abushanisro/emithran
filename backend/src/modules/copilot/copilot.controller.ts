import { Body, Controller, HttpCode, Post, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AccessToken } from '../../common/decorators/access-token.decorator';
import { SpendsAi } from '../../common/throttling/throttlers';
import { CopilotService, type CopilotEvent } from './copilot.service';
import { CopilotChatDto } from './dto/chat.dto';

interface AuthUser {
  id: string;
}

@ApiTags('Copilot')
@ApiBearerAuth()
@Controller({ path: 'api/copilot', version: '1' })
export class CopilotController {
  constructor(private readonly copilot: CopilotService) {}

  /**
   * Streams the answer as server-sent events, one JSON object per frame
   * (CopilotEvent). The response is written directly (not returned) so the
   * global TransformInterceptor does not wrap the stream. Anything that can
   * fail with a normal HTTP status (bad body, no key, part not visible to this
   * user) is raised by prepare() before the stream opens.
   */
  @Post('chat')
  @HttpCode(200)
  @SpendsAi() // each request runs up to 5 model calls on the server's key
  @ApiOperation({ summary: 'Ask the manufacturing copilot about one part (SSE stream)' })
  async chat(
    @Body() dto: CopilotChatDto,
    @CurrentUser() user: AuthUser,
    @AccessToken() token: string,
    @Res() res: Response,
  ): Promise<void> {
    const prepared = await this.copilot.prepare(dto, user.id, token);

    res.status(200).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();

    const abort = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) abort.abort();
    });

    const emit = (event: CopilotEvent) => {
      if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    try {
      await this.copilot.stream(dto, user.id, token, prepared, emit, abort.signal);
    } finally {
      res.end();
    }
  }
}
