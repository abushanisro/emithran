import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import type { QueryLogsDto, RequestLogDto, LogStatsDto } from '../dto/request-log.dto';

interface WriteLogPayload {
  userId: string | null;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  errorCode?: string | null;
}

@Injectable()
export class RequestLogsService {
  constructor(private readonly supabase: SupabaseService) {}

  async write(payload: WriteLogPayload): Promise<void> {
    try {
      // Use admin client to bypass RLS for write path
      const client = this.supabase.getClient();
      await client.from('api_request_logs').insert({
        user_id: payload.userId,
        method: payload.method,
        path: payload.path,
        status_code: payload.statusCode,
        duration_ms: payload.durationMs,
        error_code: payload.errorCode ?? null,
      });
    } catch {
      // Fire-and-forget — never throw from logging
    }
  }

  async findAll(userId: string, accessToken: string, query: QueryLogsDto): Promise<{ logs: RequestLogDto[]; total: number }> {
    const client = this.supabase.getClient(accessToken);
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const from = (page - 1) * limit;

    const ascending = query.sortOrder === 'asc';

    let q = client
      .from('api_request_logs')
      .select('id, method, path, status_code, duration_ms, created_at, error_code', { count: 'exact' })
      .eq('user_id', userId)
      .order('created_at', { ascending })
      .range(from, from + limit - 1);

    if (query.method) q = q.eq('method', query.method.toUpperCase());
    if (query.statusMin) q = q.gte('status_code', query.statusMin);
    if (query.statusMax) q = q.lte('status_code', query.statusMax);
    if (query.dateFrom) q = q.gte('created_at', query.dateFrom);
    if (query.dateTo) q = q.lte('created_at', query.dateTo);

    const { data, error, count } = await q;
    if (error) throw new Error(error.message);

    return {
      logs: (data ?? []).map((row: any) => ({
        id: row.id,
        method: row.method,
        path: row.path,
        statusCode: row.status_code,
        durationMs: row.duration_ms,
        createdAt: row.created_at,
        errorCode: row.error_code,
      })),
      total: count ?? 0,
    };
  }

  async getStats(userId: string, accessToken: string): Promise<LogStatsDto> {
    const client = this.supabase.getClient(accessToken);
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    const { data, error } = await client
      .from('api_request_logs')
      .select('status_code, duration_ms, path')
      .eq('user_id', userId)
      .gte('created_at', since);

    if (error) throw new Error(error.message);

    const rows = data ?? [];
    const total = rows.length;
    const successCount = rows.filter((r: any) => r.status_code >= 200 && r.status_code < 300).length;
    const errorCount = total - successCount;
    const avgDurationMs =
      total > 0
        ? Math.round(rows.reduce((sum: number, r: any) => sum + (r.duration_ms ?? 0), 0) / total)
        : 0;

    // Top 5 endpoints by request count
    const pathCounts: Record<string, number> = {};
    rows.forEach((r: any) => {
      pathCounts[r.path] = (pathCounts[r.path] ?? 0) + 1;
    });
    const topEndpoints = Object.entries(pathCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([path, count]) => ({ path, count }));

    return {
      total,
      successCount,
      errorCount,
      successRate: total > 0 ? Math.round((successCount / total) * 100) : 0,
      avgDurationMs,
      topEndpoints,
    };
  }
}
