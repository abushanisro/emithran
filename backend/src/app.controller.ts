import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { Public } from './common/decorators/public.decorator';

// Unauthenticated liveness only: nothing about the environment, the version or how long the process has run.
@Controller({ version: VERSION_NEUTRAL })
export class AppController {
  @Public()
  @Get()
  healthCheck() {
    return { success: true, data: { status: 'ok' } };
  }

  @Public()
  @Get('ping')
  ping() {
    return {
      success: true,
      data: {
        pong: true,
        timestamp: new Date().toISOString(),
      },
    };
  }
}
