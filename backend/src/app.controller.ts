import { Controller, Get, Logger, VERSION_NEUTRAL } from '@nestjs/common';
import { Public } from './common/decorators/public.decorator';

@Controller({ version: VERSION_NEUTRAL })
export class AppController {
  private readonly logger = new Logger(AppController.name);

  constructor() {
    this.logger.log('🚀 AppController initialized');
  }

  @Public()
  @Get()
  healthCheck() {
    this.logger.log('✅ Root route / accessed');
    return {
      success: true,
      data: {
        service: 'mithran-api-gateway',
        status: 'healthy',
        version: '1.0.0',
        environment: process.env.NODE_ENV || 'development',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
      },
    };
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

  @Public()
  @Get('test')
  test() {
    return { message: 'AppController is working!' };
  }
}