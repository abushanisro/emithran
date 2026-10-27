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
import { EngineHealthIndicator } from './indicators/engine.health';
import { ElectronicsQueueHealthIndicator } from '../electronics-costing/infrastructure/queue/queue.health';
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
    private readonly engineIndicator: EngineHealthIndicator,
    private readonly queueIndicator: ElectronicsQueueHealthIndicator,
  ) { }

  /**
   * Liveness: the process is up and its event loop answers. Depends on NOTHING external, so a database
   * or engine outage can never make a platform restart a healthy process. Use this for restart decisions.
   */
  @Get('live')
  @ApiOperation({ summary: 'Liveness (process only, no dependencies)' })
  @ApiResponse({ status: 200, description: 'Process is alive' })
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /**
   * Readiness: the dependencies this API needs to serve costing and CAD work answer. Returns 503 with a
   * per-dependency reason code when one does not. For monitoring and alerting, NOT for restart or
   * traffic-removal decisions (an engine outage should page someone, not take the whole API away).
   * A dependency with no URL or backend configured is reported `configured: false` and does not fail readiness.
   * cad-engine is probed on its own /ready route (deploy cad-engine before the backend that probes it).
   */
  @Get('ready')
  @ApiOperation({ summary: 'Readiness (database and engines)' })
  @ApiResponse({ status: 200, description: 'Dependencies are reachable' })
  @ApiResponse({ status: 503, description: 'A dependency is not ready' })
  @HealthCheck()
  ready(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.supabaseIndicator.isReachable('database'),
      () => this.engineIndicator.check('cad_engine', 'CAD_ENGINE_URL', '/ready'),
      () => this.engineIndicator.check('ecad_engine', 'ECAD_ENGINE_URL', '/ready'),
      () => this.queueIndicator.check('electronics_queue'),
    ]);
  }

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
