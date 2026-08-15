/**
 * Health Check Controller
 *
 * Provides health check endpoints for monitoring and ops:
 * - Database connectivity
 * - Table existence verification
 * - Basic query execution test
 *
 * Following industry best practices for health checks
 */

import { Controller, Get, Post, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { HealthCheckService, HealthCheck, HealthCheckResult } from '@nestjs/terminus';
import { SupabaseHealthIndicator } from './indicators/supabase.health';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { Public } from '../../common/decorators/public.decorator';

@ApiTags('Health')
@Controller({ path: 'api/health', version: VERSION_NEUTRAL })
@Public() // Health checks should be publicly accessible for monitoring
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly supabaseIndicator: SupabaseHealthIndicator,
    private readonly supabaseService: SupabaseService,
  ) { }

  @Get()
  @ApiOperation({ summary: 'Overall health check' })
  @ApiResponse({ status: 200, description: 'Service is healthy' })
  @ApiResponse({ status: 503, description: 'Service is unhealthy' })
  @HealthCheck()
  check(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.supabaseIndicator.isHealthy('supabase'),
    ]);
  }

  @Get('/db')
  @ApiOperation({ summary: 'Database health check with table verification' })
  @ApiResponse({ status: 200, description: 'Database is healthy' })
  @ApiResponse({ status: 503, description: 'Database is unhealthy' })
  @HealthCheck()
  checkDatabase(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.supabaseIndicator.checkDatabase('database'),
    ]);
  }

  @Post('/reload-schema')
  @ApiOperation({ summary: 'Reload Supabase schema cache' })
  @ApiResponse({ status: 200, description: 'Schema cache reloaded successfully' })
  @ApiResponse({ status: 500, description: 'Failed to reload schema cache' })
  async reloadSchema() {
    const success = await this.supabaseService.reloadSchemaCache();
    
    if (success) {
      return {
        success: true,
        message: 'Schema cache reload triggered successfully',
        timestamp: new Date().toISOString()
      };
    } else {
      return {
        success: false,
        message: 'Failed to reload schema cache',
        timestamp: new Date().toISOString()
      };
    }
  }

}
