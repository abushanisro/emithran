import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

import { RecentKeys } from '../cache/recent-keys';
import { currentRequestAuth } from '../request-context/request-auth-context';
import { SupabaseService } from '../supabase/supabase.service';
import { buildAuditRow, type AuditEventInput } from './audit-row';

// Where an audit event is written. Two ways, chosen per call site:
//   record()            awaited, and a write failure fails the request. For actions someone must be able to answer for (deletes,
//                       applying a cost, exports). The failure is also logged loudly with the target, so it can be reconciled.
//   recordBestEffort()  a failure is caught and logged, never thrown (docs/ENGINEERING.md: no unguarded fire-and-forget writes). For
//                       low-risk events, and for the outcome of an action that already failed.
// Rows are written through the record_audit_event() database function with the service role: nothing else can add one.
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);
  private readonly recentDenials = new RecentKeys(60_000, 500);

  constructor(private readonly supabase: SupabaseService) {}

  async record(event: AuditEventInput): Promise<void> {
    const row = buildAuditRow(event, currentRequestAuth());
    const { error } = await this.supabase
      .getPrivilegedClient('audit: write an audit event through record_audit_event')
      .rpc('record_audit_event', row);
    if (error) {
      this.logger.error(`audit write failed for ${row.p_action} on ${row.p_target_type ?? '-'}/${row.p_target_id ?? '-'}: ${error.message}`);
      throw new ServiceUnavailableException('The action could not be recorded in the audit trail.');
    }
  }

  async recordBestEffort(event: AuditEventInput): Promise<void> {
    try {
      await this.record(event);
    } catch (error) {
      // record() already logged the cause; this is the unexpected kind (bad event, no client)
      if (!(error instanceof ServiceUnavailableException)) this.logger.warn(`audit event ${event.action} not recorded: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * A denied request, recorded once per actor and reason a minute: a client hammering a forbidden route must not fill the table.
   * Best effort.
   */
  async recordDenied(reason: string, actorKey: string, event: Omit<AuditEventInput, 'action' | 'outcome'>): Promise<void> {
    if (!this.recentDenials.firstSeen(`${actorKey}:${reason}`)) return;
    await this.recordBestEffort({ ...event, action: 'auth.forbidden', outcome: 'denied', meta: { ...event.meta, reason } });
  }

  /**
   * Runs an action and records what happened. On success the event is awaited (it fails the request if it cannot be written, so
   * an unaudited change is never reported as fine); on failure the error is recorded best-effort and the original error rethrown.
   */
  async audited<T>(event: AuditEventInput, run: () => Promise<T>): Promise<T> {
    let result: T;
    try {
      result = await run();
    } catch (error) {
      await this.recordBestEffort({ ...event, outcome: 'error' });
      throw error;
    }
    await this.record({ ...event, outcome: 'ok' });
    return result;
  }

  /**
   * Audits a change to one row (delete it, apply a cost to it): reads the row's organization and name first, because the route
   * may not resolve an organization and the row is gone afterwards, then runs the change under audited().
   */
  async auditedRowChange<T>(
    table: 'bom_items' | 'boms',
    id: string,
    action: 'bom.deleted' | 'bom_item.deleted' | 'cost.applied',
    run: () => Promise<T>,
    meta?: Record<string, unknown>,
  ): Promise<T> {
    const facts = await this.describe(table, id);
    return this.audited(
      {
        action,
        targetType: table === 'boms' ? 'bom' : 'bom_item',
        targetId: id,
        ...(facts.organizationId ? { organizationId: facts.organizationId } : {}),
        meta: { ...(facts.name ? { name: facts.name } : {}), ...meta },
      },
      run,
    );
  }

  /** What the audit trail needs to know about a row before it is changed or deleted: its organization and its name. Empty when unreadable. */
  async describe(table: 'bom_items' | 'boms', id: string): Promise<{ organizationId?: string; name?: string }> {
    const { data, error } = await this.supabase
      .getPrivilegedClient('audit: find the organization and name of the row being changed')
      .from(table)
      .select('organization_id, name')
      .eq('id', id)
      .maybeSingle();
    if (error || !data) return {};
    const row = data as { organization_id?: string | null; name?: string | null };
    return { ...(row.organization_id ? { organizationId: row.organization_id } : {}), ...(row.name ? { name: row.name } : {}) };
  }
}
