import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../../../common/audit/audit.service';
import { DatabaseService } from '../../../common/database/database.service';
import { isMissingTable } from '../../../common/db/missing-table';
import { AUTOMATIC_PULL_DIRECTION, pullDirectionView, type PullAxis, type PullDirectionView } from '../costing/plastic-molding/override/pull-direction';

export interface PullDirectionRequest {
  bomItemId: string;
  userId: string;
  organizationId: string;
  token: string;
}

/**
 * The engineer's pull (mold-opening) axis of a plastic part (migration 968). Without one the CAD engine chooses it. Writing is audited and needs
 * a reason. Applying it means analysing the part again along it, which the caller does (the stored analysis is what costing reads).
 */
@Injectable()
export class PlasticPullDirectionService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  /** The item's pull direction as it applies to its file now. Read as the user, so another organization's item is not found. */
  async get(bomItemId: string, token: string): Promise<PullDirectionView> {
    const item = await this.readItem(bomItemId, token);
    return this.view(bomItemId, token, item.file_3d_path);
  }

  async set(input: PullDirectionRequest, axis: PullAxis, reason: string): Promise<PullDirectionView> {
    const item = await this.readItem(input.bomItemId, input.token);
    const previous = await this.view(input.bomItemId, input.token, item.file_3d_path);
    const { error } = await this.admin().from('plastic_pull_directions').upsert(
      {
        bom_item_id: input.bomItemId,
        organization_id: input.organizationId,
        axis,
        reason: reason.trim(),
        set_by: input.userId,
        set_at: new Date().toISOString(),
        source_path: item.file_3d_path,
      },
      { onConflict: 'bom_item_id' },
    );
    if (error) throw new Error(`Could not store the pull direction: ${error.message}`);
    await this.audit.recordBestEffort({
      action: 'plastic_pull_direction.set',
      targetType: 'bom_item',
      targetId: input.bomItemId,
      organizationId: input.organizationId,
      meta: { axis, reason: reason.trim(), previousAxis: previous.declaredAxis },
    });
    return this.view(input.bomItemId, input.token, item.file_3d_path);
  }

  async clear(input: PullDirectionRequest): Promise<PullDirectionView> {
    const item = await this.readItem(input.bomItemId, input.token);
    const previous = await this.view(input.bomItemId, input.token, item.file_3d_path);
    const { error } = await this.admin().from('plastic_pull_directions').delete().eq('bom_item_id', input.bomItemId);
    if (error) throw new Error(`Could not remove the pull direction: ${error.message}`);
    if (previous.declaredAxis) {
      await this.audit.recordBestEffort({
        action: 'plastic_pull_direction.cleared',
        targetType: 'bom_item',
        targetId: input.bomItemId,
        organizationId: input.organizationId,
        meta: { previousAxis: previous.declaredAxis, previousReason: previous.reason },
      });
    }
    return AUTOMATIC_PULL_DIRECTION;
  }

  private async view(bomItemId: string, token: string, currentPath: string | null): Promise<PullDirectionView> {
    const { data, error } = await this.database.getUserClient(token)
      .from('plastic_pull_directions')
      .select('axis, reason, set_by, set_at, source_path')
      .eq('bom_item_id', bomItemId)
      .maybeSingle();
    // A database that predates migration 968 has no override for any part: the engine's automatic choice applies.
    if (error && isMissingTable(error)) return AUTOMATIC_PULL_DIRECTION;
    if (error) throw new Error(`Could not read the pull direction: ${error.message}`);
    return pullDirectionView(data as Parameters<typeof pullDirectionView>[0], currentPath);
  }

  private async readItem(bomItemId: string, token: string): Promise<{ id: string; file_3d_path: string | null }> {
    const { data, error } = await this.database.getUserClient(token).from('bom_items').select('id, file_3d_path').eq('id', bomItemId).maybeSingle();
    if (error) throw new Error(`Could not read the BOM item: ${error.message}`);
    if (!data) throw new NotFoundException(`BOM item ${bomItemId} not found`);
    return data as { id: string; file_3d_path: string | null };
  }

  /** The service-role client, only used after the BOM item was read as the user (row-level security decides whether it is theirs). */
  private admin() {
    return this.database.getPrivilegedClient('plastic pull direction: store the override after an RLS check of the BOM item');
  }
}
