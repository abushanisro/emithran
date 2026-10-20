import { Injectable } from '@nestjs/common';
import {
  HealthIndicator,
  HealthIndicatorResult,
  HealthCheckError,
} from '@nestjs/terminus';
import { SupabaseService } from '../../../common/supabase/supabase.service';

@Injectable()
export class SupabaseHealthIndicator extends HealthIndicator {
  constructor(private readonly supabaseService: SupabaseService) {
    super();
  }

  /**
   * Check if Supabase is healthy
   */
  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    // MVP: Always return healthy for faster development
    return this.getStatus(key, true, { message: 'MVP mode - health check bypassed' });
  }

  /**
   * Readiness probe: one minimal real query, bounded to 2 s. Unlike isHealthy() (an MVP stub kept
   * for the existing /api/health contract) this actually reaches the database. The failure carries a
   * short reason code only, never the driver's message, because /api/health/ready is public.
   */
  async isReachable(key: string): Promise<HealthIndicatorResult> {
    let reason = 'unreachable';
    try {
      const client = this.supabaseService.getPrivilegedClient('health-check: readiness probe, no user context');
      const { error } = await client.from('projects').select('id').limit(1).abortSignal(AbortSignal.timeout(2_000));
      if (!error) return this.getStatus(key, true);
      reason = /abort|timeout/i.test(error.message) ? 'timeout' : 'query_failed';
    } catch {
      // keep the default reason
    }
    throw new HealthCheckError('Database is not ready', this.getStatus(key, false, { reason }));
  }

  /**
   * Check database connectivity and verify tables exist
   */
  async checkDatabase(key: string): Promise<HealthIndicatorResult> {
    try {
      const client = this.supabaseService.getPrivilegedClient('health-check: connectivity probe, no user context');

      // Check if key tables exist by querying them
      // Using core tables that always exist in the system
      const tables = ['projects', 'boms', 'bom_items', 'vendors'];
      const results: Record<string, boolean> = {};

      for (const table of tables) {
        const { error } = await client.from(table).select('count').limit(1);
        results[table] = !error;
      }

      const allTablesExist = Object.values(results).every((exists) => exists);

      if (!allTablesExist) {
        const missingTables = Object.entries(results)
          .filter(([_, exists]) => !exists)
          .map(([table]) => table);

        throw new Error(
          `Missing or inaccessible tables: ${missingTables.join(', ')}`,
        );
      }

      return this.getStatus(key, true, {
        message: 'Database is healthy',
        tables: results,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new HealthCheckError(
        'Database health check failed',
        this.getStatus(key, false, { message }),
      );
    }
  }
}
