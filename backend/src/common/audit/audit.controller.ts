import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsISO8601, IsOptional, IsUUID, Matches, Max, Min } from 'class-validator';

import { AccessToken } from '../decorators/access-token.decorator';
import { DatabaseService } from '../database/database.service';

export class QueryAuditEventsDto {
  /** An exact action such as bom_item.deleted. */
  @IsOptional() @Matches(/^[a-z_]+\.[a-z_]+$/) action?: string;
  @IsOptional() @IsUUID() actorId?: string;
  @IsOptional() @IsUUID() organizationId?: string;
  @IsOptional() @IsISO8601() from?: string;
  @IsOptional() @IsISO8601() to?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  /** The cursor from the previous page (`nextCursor`): only older events are returned. */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) before?: number;
}

const DEFAULT_LIMIT = 50;

// Read-only. It queries as the signed-in user, so row-level security decides what comes back: an owner or admin sees the events
// of their organizations, everyone else sees an empty list. Nothing here can write.
@ApiTags('Audit')
@ApiBearerAuth()
@Controller({ path: 'api/audit-events', version: '1' })
export class AuditController {
  constructor(private readonly database: DatabaseService) {}

  @Get()
  @ApiOperation({ summary: 'Audit events of the organizations you administer, newest first' })
  async list(@Query() filters: QueryAuditEventsDto, @AccessToken() token: string) {
    const limit = filters.limit ?? DEFAULT_LIMIT;
    let query = this.database
      .getUserClient(token)
      .from('audit_events')
      .select('id, at, org_id, actor_id, actor_kind, action, target_type, target_id, outcome, ip, request_id, meta')
      .order('id', { ascending: false })
      .limit(limit + 1); // one extra row says whether there is another page
    if (filters.action) query = query.eq('action', filters.action);
    if (filters.actorId) query = query.eq('actor_id', filters.actorId);
    if (filters.organizationId) query = query.eq('org_id', filters.organizationId);
    if (filters.from) query = query.gte('at', filters.from);
    if (filters.to) query = query.lte('at', filters.to);
    if (filters.before) query = query.lt('id', filters.before);

    const { data, error } = await query;
    if (error) throw new Error(`Could not read audit events: ${error.message}`);
    const rows = (data ?? []) as { id: number }[];
    const items = rows.slice(0, limit);
    return { items, nextCursor: rows.length > limit ? (items[items.length - 1]?.id ?? null) : null };
  }
}
