import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';

import type { AlertKind, AlertSeverity } from '../dto/alert.dto';

export interface CandidateAlert {
  kind: AlertKind;
  severity: AlertSeverity;
  title: string;
  body?: string;
  linkRoute?: string;
  sourceEntityType?: string;
  sourceEntityId?: string;
  metadata?: Record<string, unknown>;
}

const PENDING_RFQ_DAYS = 3;
const STALE_LOT_DAYS = 5;
const COST_SPIKE_PCT = 10;
const MISSING_PLAN_DAYS = 14;

/**
 * Pure-rule detection — no AI, no flake. Each rule is small and independently
 * testable. The AlertRankerService then asks Claude to triage these
 * candidates into the top N with severity + nextAction recommendations.
 *
 * Detectors are intentionally read-only and per-user (RLS-scoped through
 * the user-token Supabase client).
 */
@Injectable()
export class AlertDetectorService {
  private readonly logger = new Logger(AlertDetectorService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async detect(args: {
    ownerId: string;
    accessToken: string | null;
  }): Promise<CandidateAlert[]> {
    const client = this.supabase.getClient(args.accessToken ?? undefined);
    const results = await Promise.allSettled([
      this.detectPendingRfqs(client),
      this.detectStaleLots(client),
      this.detectCostSpikes(client, args.ownerId),
      this.detectMissingPlans(client),
      this.detectMissingDrawings(client),
    ]);

    const candidates: CandidateAlert[] = [];
    for (const r of results) {
      if (r.status === 'fulfilled') candidates.push(...r.value);
      else this.logger.warn(`alert detection rule failed: ${r.reason?.message ?? r.reason}`);
    }
    return candidates;
  }

  // ── Rules ────────────────────────────────────────────────────────────────

  private async detectPendingRfqs(client: any): Promise<CandidateAlert[]> {
    const cutoff = new Date(Date.now() - PENDING_RFQ_DAYS * 86_400_000).toISOString();
    const { data } = await client
      .from('rfq_tracking')
      .select('id, project_id, status, vendor_count, sent_at')
      .eq('status', 'sent')
      .lt('sent_at', cutoff)
      .limit(20);
    return (data ?? []).map((row: any) => {
      const days = Math.floor((Date.now() - new Date(row.sent_at).getTime()) / 86_400_000);
      return {
        kind: 'rfq_pending' as AlertKind,
        severity: (days > 7 ? 'urgent' : 'warn') as AlertSeverity,
        title: `RFQ pending for ${days} days`,
        body: `${row.vendor_count ?? 0} vendors invited, no quotes recorded.`,
        linkRoute: row.project_id ? `/projects/${row.project_id}/rfq` : '/rfq',
        sourceEntityType: 'rfq',
        sourceEntityId: row.id,
        metadata: { pendingDays: days },
      };
    });
  }

  private async detectStaleLots(client: any): Promise<CandidateAlert[]> {
    const cutoff = new Date(Date.now() - STALE_LOT_DAYS * 86_400_000).toISOString();
    const { data } = await client
      .from('production_planning_lots')
      .select('id, project_id, name, status, updated_at')
      .neq('status', 'completed')
      .lt('updated_at', cutoff)
      .limit(20);
    return (data ?? []).map((row: any) => {
      const days = Math.floor((Date.now() - new Date(row.updated_at).getTime()) / 86_400_000);
      return {
        kind: 'stale_lot' as AlertKind,
        severity: (days > 10 ? 'urgent' : 'warn') as AlertSeverity,
        title: `Production lot "${row.name}" stale ${days} days`,
        body: `Status: ${row.status}. No updates in ${days} days.`,
        linkRoute: row.project_id
          ? `/projects/${row.project_id}/production-planning`
          : '/production-planning',
        sourceEntityType: 'lot',
        sourceEntityId: row.id,
        metadata: { staleDays: days },
      };
    });
  }

  private async detectCostSpikes(client: any, ownerId: string): Promise<CandidateAlert[]> {
    // Compare the two most recent context snapshots per bom_item for this owner.
    // Cheap heuristic: just-now total vs. previous total. SQL fast-path would be a window
    // function in a view; the JS version is fine for v1's small N.
    const { data } = await client
      .from('echo_context_snapshots')
      .select('entity_id, entity_type, route, context_json, created_at')
      .eq('owner_id', ownerId)
      .eq('entity_type', 'bom_item')
      .order('created_at', { ascending: false })
      .limit(200);
    if (!data) return [];

    const grouped = new Map<string, any[]>();
    for (const row of data) {
      const arr = grouped.get(row.entity_id) ?? [];
      arr.push(row);
      grouped.set(row.entity_id, arr);
    }

    const alerts: CandidateAlert[] = [];
    for (const [entityId, snapshots] of grouped.entries()) {
      if (snapshots.length < 2) continue;
      const [latest, previous] = snapshots;
      const latestCost = num((latest.context_json as any)?.total_cost);
      const prevCost = num((previous.context_json as any)?.total_cost);
      if (prevCost <= 0 || latestCost <= 0) continue;
      const deltaPct = ((latestCost - prevCost) / prevCost) * 100;
      if (deltaPct < COST_SPIKE_PCT) continue;
      const partName = (latest.context_json as any)?.part_name ?? 'BOM item';
      alerts.push({
        kind: 'cost_spike',
        severity: deltaPct > 25 ? 'urgent' : 'warn',
        title: `${partName} cost up ${Math.round(deltaPct)}%`,
        body: `Previous ${prevCost.toFixed(0)} → latest ${latestCost.toFixed(0)}.`,
        linkRoute: latest.route,
        sourceEntityType: 'bom_item',
        sourceEntityId: entityId,
        metadata: { deltaPct: Math.round(deltaPct * 10) / 10, prevCost, latestCost },
      });
    }
    return alerts;
  }

  private async detectMissingPlans(client: any): Promise<CandidateAlert[]> {
    const cutoff = new Date(Date.now() - MISSING_PLAN_DAYS * 86_400_000).toISOString();
    // BOM items created > 14 days ago with no process_plan_generations.
    const { data } = await client
      .from('bom_items')
      .select('id, project_id, bom_id, part_number, part_name, created_at')
      .lt('created_at', cutoff)
      .is('process_plan_generated_at', null)
      .limit(15);
    return (data ?? []).map((row: any) => ({
      kind: 'missing_plan' as AlertKind,
      severity: 'info' as AlertSeverity,
      title: `No process plan for ${row.part_name ?? row.part_number}`,
      body: 'BOM item is older than 2 weeks and has no AI-generated process plan.',
      linkRoute: row.project_id
        ? `/projects/${row.project_id}/process-planning`
        : '/process-planning',
      sourceEntityType: 'bom_item',
      sourceEntityId: row.id,
    }));
  }

  private async detectMissingDrawings(client: any): Promise<CandidateAlert[]> {
    const { data } = await client
      .from('bom_items')
      .select('id, project_id, part_number, part_name, drawing_file_url, item_type')
      .neq('item_type', 'assembly')
      .is('drawing_file_url', null)
      .limit(10);
    return (data ?? []).map((row: any) => ({
      kind: 'missing_drawing' as AlertKind,
      severity: 'info' as AlertSeverity,
      title: `Missing drawing for ${row.part_name ?? row.part_number}`,
      body: 'Manufacturing planning needs a drawing — DFM and process candidates depend on it.',
      linkRoute: row.project_id ? `/projects/${row.project_id}/bom` : '/bom',
      sourceEntityType: 'bom_item',
      sourceEntityId: row.id,
    }));
  }
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : 0;
}
