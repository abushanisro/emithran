import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';

import { AuditService } from '../../../../../common/audit/audit.service';
import { DatabaseService } from '../../../../../common/database/database.service';

export type SnapshotStatus = 'submitted' | 'approved' | 'rejected';

export interface SnapshotRequest {
  bomItemId: string;
  userId: string;
  organizationId: string;
  token: string;
}

/** What a snapshot was computed with, stored beside the summary so it can be understood later. */
export interface SnapshotContext {
  location: string;
  batchSize: number | null;
  productionLifeYears: number | null;
  /** The part's own plant-variable values at the time (variable and value), the shared reference not included. */
  plantOverrides: Array<{ variable: string; value: string }>;
  /** The sand reference data version the route was costed with. */
  referenceSourceVersion: string;
}

/** One snapshot as the list shows it: the key figures of the frozen summary, who froze it, and its review. */
export interface SnapshotView {
  id: string;
  label: string;
  createdBy: string;
  createdAt: string;
  status: SnapshotStatus;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  figures: { pieceCost: number | null; materialCost: number | null; mouldingMachine: string | null; cavities: number | null };
  context: SnapshotContext;
}

interface Row {
  id: string;
  label: string;
  summary: Record<string, unknown>;
  context: SnapshotContext;
  status: SnapshotStatus;
  created_by: string;
  created_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
}

const COLUMNS = 'id, label, summary, context, status, created_by, created_at, reviewed_by, reviewed_at, review_note';
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** The key figures of a frozen cost summary (the whole summary stays in the row). */
export function figuresOf(summary: Record<string, unknown>): SnapshotView['figures'] {
  const sand = (summary['sandCasting'] ?? {}) as Record<string, unknown>;
  return {
    pieceCost: num(summary['totalCost']),
    materialCost: num(summary['materialCost']),
    mouldingMachine: typeof sand['mouldingMachine'] === 'string' ? sand['mouldingMachine'] : null,
    cavities: num(sand['cavities']),
  };
}

const view = (r: Row): SnapshotView => ({
  id: r.id,
  label: r.label,
  createdBy: r.created_by,
  createdAt: r.created_at,
  status: r.status,
  reviewedBy: r.reviewed_by,
  reviewedAt: r.reviewed_at,
  reviewNote: r.review_note,
  figures: figuresOf(r.summary),
  context: r.context,
});

/**
 * Frozen cost results of a sand-cast part (migration 962). A member freezes the cost summary as it was computed, with what it was computed
 * with; a different member approves or rejects it, once, with a note. Both are audited. Nothing here edits a snapshot.
 */
@Injectable()
export class SandSnapshotsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  async list(bomItemId: string, token: string): Promise<SnapshotView[]> {
    await this.readItem(bomItemId, token);
    const { data, error } = await this.database
      .getUserClient(token)
      .from('sand_cost_snapshots')
      .select(COLUMNS)
      .eq('bom_item_id', bomItemId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(`Could not read the cost snapshots: ${error.message}`);
    return ((data ?? []) as Row[]).map(view);
  }

  /** Freezes a cost summary the server computed. A summary that is not a sand-casting one, or is not whole, is refused: there is nothing to rely on. */
  async create(input: SnapshotRequest, label: string, summary: Record<string, unknown>, context: SnapshotContext): Promise<SnapshotView> {
    await this.readItem(input.bomItemId, input.token); // not found for another organization's item
    const sand = summary['sandCasting'] as Record<string, unknown> | undefined;
    if (!sand) throw new UnprocessableEntityException({ code: 'not_sand_cast', message: 'This cost summary has no sand-casting route to freeze.' });
    if (sand['complete'] !== true) {
      throw new UnprocessableEntityException({ code: 'route_incomplete', message: 'The route is incomplete (a step has no machine): fix it before freezing a cost.' });
    }
    const { data, error } = await this.admin()
      .from('sand_cost_snapshots')
      .insert({
        bom_item_id: input.bomItemId,
        organization_id: input.organizationId,
        label: label.trim(),
        summary,
        context,
        created_by: input.userId,
      })
      .select(COLUMNS)
      .single();
    if (error) throw new Error(`Could not store the cost snapshot: ${error.message}`);
    const row = data as Row;
    await this.audit.recordBestEffort({
      action: 'sand_snapshot.created',
      targetType: 'bom_item',
      targetId: input.bomItemId,
      organizationId: input.organizationId,
      meta: { snapshotId: row.id, label: row.label, pieceCost: figuresOf(summary).pieceCost },
    });
    return view(row);
  }

  /** A different member approves or rejects a submitted snapshot, with a note, once. */
  async review(input: Omit<SnapshotRequest, 'bomItemId'>, snapshotId: string, decision: 'approved' | 'rejected', note: string): Promise<SnapshotView> {
    // Read as the user: row-level security shows only their organization's snapshots, so another organization's is not found.
    const { data: found, error: readError } = await this.database
      .getUserClient(input.token)
      .from('sand_cost_snapshots')
      .select(`${COLUMNS}, bom_item_id`)
      .eq('id', snapshotId)
      .maybeSingle();
    if (readError) throw new Error(`Could not read the cost snapshot: ${readError.message}`);
    const current = found as (Row & { bom_item_id: string }) | null;
    if (!current) throw new NotFoundException(`Cost snapshot ${snapshotId} not found`);
    if (current.created_by === input.userId) throw new ForbiddenException({ code: 'own_snapshot', message: 'A snapshot is reviewed by a different member than the one who froze it.' });
    if (current.status !== 'submitted') throw new ConflictException({ code: 'already_reviewed', message: `This snapshot was already ${current.status}.` });
    const { data, error } = await this.admin()
      .from('sand_cost_snapshots')
      .update({ status: decision, reviewed_by: input.userId, reviewed_at: new Date().toISOString(), review_note: note.trim() })
      .eq('id', snapshotId)
      .eq('status', 'submitted')
      .select(COLUMNS)
      .maybeSingle();
    if (error) throw new Error(`Could not record the review: ${error.message}`);
    if (!data) throw new ConflictException({ code: 'already_reviewed', message: 'This snapshot was reviewed by someone else just now.' });
    await this.audit.recordBestEffort({
      action: 'sand_snapshot.reviewed',
      targetType: 'bom_item',
      targetId: current.bom_item_id,
      organizationId: input.organizationId,
      meta: { snapshotId, decision, note: note.trim() },
    });
    return view(data as Row);
  }

  /** The service-role client, only used after the BOM item was read as the user (row-level security decides whether it is theirs). */
  private admin() {
    return this.database.getPrivilegedClient('sand cost snapshots: freeze and review a part\'s cost after an RLS check of the BOM item');
  }

  private async readItem(bomItemId: string, token: string): Promise<void> {
    const { data, error } = await this.database.getUserClient(token).from('bom_items').select('id').eq('id', bomItemId).maybeSingle();
    if (error) throw new Error(`Could not read the BOM item: ${error.message}`);
    if (!data) throw new NotFoundException(`BOM item ${bomItemId} not found`);
  }
}
