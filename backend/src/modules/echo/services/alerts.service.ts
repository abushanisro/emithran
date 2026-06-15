import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { AlertDetectorService } from './alert-detector.service';
import { AlertRankerService, type RankedAlert } from './alert-ranker.service';

import type { AlertDto } from '../dto/alert.dto';

/**
 * Composes detection + ranking + persistence into a single user-facing
 * endpoint. Upserts each ranked alert into echo_alerts so dismissals and
 * idempotency survive across page reloads.
 */
@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly detector: AlertDetectorService,
    private readonly ranker: AlertRankerService,
  ) {}

  async listForUser(args: {
    ownerId: string;
    accessToken: string | null;
    refresh?: boolean;
  }): Promise<AlertDto[]> {
    if (args.refresh) {
      await this.refresh(args);
    }
    return this.fetchActive(args);
  }

  async dismiss(args: {
    alertId: string;
    ownerId: string;
    accessToken: string | null;
  }): Promise<void> {
    const client = this.supabase.getClient(args.accessToken ?? undefined);
    const { error } = await client
      .from('echo_alerts')
      .update({ dismissed_at: new Date().toISOString() })
      .eq('id', args.alertId)
      .eq('owner_id', args.ownerId);
    if (error) throw new Error(`dismiss: ${error.message}`);
  }

  private async refresh(args: { ownerId: string; accessToken: string | null }): Promise<void> {
    const candidates = await this.detector.detect(args);
    if (candidates.length === 0) return;
    const ranked = await this.ranker.rank(candidates);
    if (ranked.length === 0) return;

    const client = this.supabase.getClient(args.accessToken ?? undefined);
    for (const a of ranked) {
      // Upsert by unique (owner_id, kind, source_entity_type, source_entity_id)
      const { error } = await client
        .from('echo_alerts')
        .upsert(
          {
            owner_id: args.ownerId,
            kind: a.kind,
            severity: a.severity,
            title: a.title.slice(0, 280),
            body: a.body ?? null,
            link_route: a.linkRoute ?? null,
            next_action: a.nextAction ?? null,
            source_entity_type: a.sourceEntityType ?? null,
            source_entity_id: a.sourceEntityId ?? null,
            metadata: a.metadata ?? null,
          },
          { onConflict: 'owner_id,kind,source_entity_type,source_entity_id' },
        );
      if (error) this.logger.warn(`upsert alert failed: ${error.message}`);
    }
  }

  private async fetchActive(args: {
    ownerId: string;
    accessToken: string | null;
  }): Promise<AlertDto[]> {
    const client = this.supabase.getClient(args.accessToken ?? undefined);
    const { data, error } = await client
      .from('echo_alerts')
      .select(
        'id, kind, severity, title, body, link_route, next_action, source_entity_type, source_entity_id, created_at',
      )
      .eq('owner_id', args.ownerId)
      .is('dismissed_at', null)
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) throw new Error(`fetchActive: ${error.message}`);
    return (data ?? []).map((r: any) => ({
      id: r.id,
      kind: r.kind,
      severity: r.severity,
      title: r.title,
      body: r.body ?? undefined,
      linkRoute: r.link_route ?? undefined,
      nextAction: r.next_action ?? undefined,
      sourceEntityType: r.source_entity_type ?? undefined,
      sourceEntityId: r.source_entity_id ?? undefined,
      createdAt: r.created_at,
    }));
  }
}
