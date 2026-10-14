import {
  BadRequestException, ConflictException, ForbiddenException, Injectable, InternalServerErrorException,
  NotFoundException, UnprocessableEntityException,
} from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import {
  canReviewPmi, PMI_REVIEW_BASES, pmiFileSha256, resolvePmiRecords, reviewTargetOf,
  type PmiRecord, type PmiReviewRow, type PmiReviewScope,
} from '../costing/shared/tolerance/pmi-records';

export interface PmiReviewRequest {
  recordKey: string;
  scope?: PmiReviewScope;
  decision: 'approved' | 'rejected';
  /** The fingerprint of the record the engineer was looking at; a changed record is refused as stale. */
  recordFingerprint: string;
  basis: string;
  notes?: string | undefined;
}

export interface PmiRecordsView {
  records: PmiRecord[];
  fileSha256: string | null;
  /** The caller's organization role and whether it may approve or reject (enforced again on write). */
  role: string | null;
  canReview: boolean;
  bases: readonly string[];
}

const MAX_NOTES = 2000;

function toRow(r: any): PmiReviewRow {
  return {
    recordKey: r.record_key, scope: r.scope, decision: r.decision, recordFingerprint: r.record_fingerprint,
    fileSha256: r.file_sha256, reviewerId: r.reviewer_id, reviewerEmail: r.reviewer_email ?? null, reviewedAt: r.reviewed_at,
    approvedValues: r.approved_values ?? {}, decodedStatus: r.decoded_status, basis: r.basis, notes: r.notes ?? null,
    supersededAt: r.superseded_at ?? null,
  };
}

/**
 * Engineer review of PMI values the CAD engine could only decode from drawn glyphs (migration 908).
 * Native PMI needs no review. The decision is written by review_pmi_record(), which re-checks the role,
 * staleness and eligibility atomically; this service checks the same things first so the caller gets a
 * precise error, and it never trusts the browser for who may review or what a record says.
 */
@Injectable()
export class PmiReviewService {
  constructor(private readonly supabase: SupabaseService) {}

  private async loadItem(id: string, accessToken: string) {
    const { data, error } = await this.supabase.getUserClient(accessToken)
      .from('bom_items')
      .select('id, organization_id, feature_graph')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new InternalServerErrorException(`Failed to read BOM item: ${error.message}`);
    if (!data) throw new NotFoundException(`BOM item with ID ${id} not found`);
    return data as { id: string; organization_id: string | null; feature_graph: any };
  }

  private async roleOf(userId: string, organizationId: string | null, accessToken: string): Promise<string | null> {
    if (!organizationId) return null;
    const { data, error } = await this.supabase.getUserClient(accessToken)
      .from('organization_members')
      .select('role')
      .eq('user_id', userId)
      .eq('organization_id', organizationId)
      .eq('status', 'active')
      .maybeSingle();
    if (error) throw new InternalServerErrorException(`Failed to read organization membership: ${error.message}`);
    return (data as { role?: string } | null)?.role ?? null;
  }

  private async currentRows(id: string, accessToken: string): Promise<PmiReviewRow[]> {
    const { data, error } = await this.supabase.getUserClient(accessToken)
      .from('pmi_record_reviews')
      .select('*')
      .eq('bom_item_id', id)
      .is('superseded_at', null);
    if (error) throw new InternalServerErrorException(`Failed to read PMI reviews (is migration 908 applied?): ${error.message}`);
    return (data ?? []).map(toRow);
  }

  async get(id: string, userId: string, accessToken: string): Promise<PmiRecordsView> {
    const item = await this.loadItem(id, accessToken);
    const [rows, role] = await Promise.all([this.currentRows(id, accessToken), this.roleOf(userId, item.organization_id, accessToken)]);
    return {
      records: resolvePmiRecords(item.feature_graph, rows),
      fileSha256: pmiFileSha256(item.feature_graph),
      role,
      canReview: canReviewPmi(role),
      bases: PMI_REVIEW_BASES,
    };
  }

  /** Every decision ever taken on one record, newest first (the audit history). */
  async history(id: string, recordKey: string, accessToken: string): Promise<PmiReviewRow[]> {
    await this.loadItem(id, accessToken);
    const { data, error } = await this.supabase.getUserClient(accessToken)
      .from('pmi_record_reviews')
      .select('*')
      .eq('bom_item_id', id)
      .eq('record_key', recordKey)
      .order('reviewed_at', { ascending: false });
    if (error) throw new InternalServerErrorException(`Failed to read PMI review history: ${error.message}`);
    return (data ?? []).map(toRow);
  }

  async review(id: string, userId: string, accessToken: string, request: PmiReviewRequest): Promise<PmiRecordsView> {
    const scope: PmiReviewScope = request.scope ?? 'record';
    if (request.decision !== 'approved' && request.decision !== 'rejected') throw new BadRequestException('decision must be "approved" or "rejected"');
    if (scope !== 'record' && scope !== 'datum_refs') throw new BadRequestException('scope must be "record" or "datum_refs"');
    if (!(PMI_REVIEW_BASES as readonly string[]).includes(request.basis)) {
      throw new BadRequestException(`basis must name the authoritative source checked: ${PMI_REVIEW_BASES.join(', ')}`);
    }
    if (typeof request.recordKey !== 'string' || !request.recordKey || typeof request.recordFingerprint !== 'string' || !request.recordFingerprint) {
      throw new BadRequestException('recordKey and recordFingerprint are required');
    }
    if (request.notes !== undefined && (typeof request.notes !== 'string' || request.notes.length > MAX_NOTES)) {
      throw new BadRequestException(`notes must be text of at most ${MAX_NOTES} characters`);
    }

    const item = await this.loadItem(id, accessToken);
    const role = await this.roleOf(userId, item.organization_id, accessToken);
    if (!canReviewPmi(role)) throw new ForbiddenException('Only an owner of this organization may approve or reject decoded PMI values.');

    const target = reviewTargetOf(item.feature_graph, request.recordKey, scope);
    if (!target.ok) {
      if (target.code === 'not_found') throw new NotFoundException(target.reason);
      throw new UnprocessableEntityException(target.reason);
    }
    if (target.fingerprint !== request.recordFingerprint) {
      throw new ConflictException('The record changed since you opened it (re-analysis or a new file). Reload and review the current values.');
    }

    const { error } = await this.supabase.getUserClient(accessToken).rpc('review_pmi_record', {
      p_bom_item_id: id,
      p_record_key: target.recordKey,
      p_scope: scope,
      p_decision: request.decision,
      p_record_fingerprint: request.recordFingerprint,
      p_basis: request.basis,
      p_notes: request.notes ?? null,
    });
    if (error) throw this.mapDatabaseError(error);
    return this.get(id, userId, accessToken);
  }

  private mapDatabaseError(error: { message: string; code?: string }) {
    const m = error.message ?? '';
    if (m.includes('not_authorized') || error.code === '42501') return new ForbiddenException('Only an owner of this organization may approve or reject decoded PMI values.');
    if (m.includes('stale_record') || error.code === '40001') return new ConflictException('The record changed since you opened it. Reload and review the current values.');
    if (m.includes('not_reviewable')) return new UnprocessableEntityException(`This record cannot be reviewed (${m.split('not_reviewable:')[1] ?? 'not eligible'}).`);
    if (m.includes('record_not_found') || m.includes('item_not_found')) return new NotFoundException('The PMI record no longer exists on this part.');
    if (m.includes('no_source_fingerprint')) return new UnprocessableEntityException('This analysis carries no source fingerprint: re-analyse the part before reviewing.');
    if (m.includes('review_pmi_record') && /does not exist|Could not find/i.test(m)) {
      return new InternalServerErrorException('PMI review is not available: migration 908 has not been applied.');
    }
    return new InternalServerErrorException(`Failed to save the PMI review: ${m}`);
  }
}
