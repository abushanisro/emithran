import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';

import { AuditService } from '../../../../../common/audit/audit.service';
import type { DbClient } from '../../../../../common/db/postgrest-client';
import { DatabaseService } from '../../../../../common/database/database.service';
import { SandReferenceService } from './sand-reference.service';
import {
  checkOverride,
  overrideViews,
  type SandVariableOverrideRow,
  type SandVariableOverrideView,
} from './sand-variable-overrides';

export interface OverrideRequest {
  bomItemId: string;
  userId: string;
  organizationId: string;
  token: string;
}

const COLUMNS = 'variable, value, reason, set_by, set_at';

/**
 * A part's own values for sand-casting plant variables (migration 961). The shared plant data is never edited: the costing lays these
 * rows over it for this one BOM item (SandReference.withOverrides). Writing is audited and needs a reason.
 */
@Injectable()
export class SandVariableOverridesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly reference: SandReferenceService,
    private readonly audit: AuditService,
  ) {}

  /** The rows of one BOM item, read with the caller's client (row-level security limits them to their organization). */
  static async rows(client: DbClient, bomItemId: string): Promise<SandVariableOverrideRow[]> {
    const { data, error } = await client.from('sand_variable_overrides').select(COLUMNS).eq('bom_item_id', bomItemId);
    if (error) throw new Error(`Could not read the sand variable overrides: ${error.message}`);
    return (data ?? []) as SandVariableOverrideRow[];
  }

  async list(bomItemId: string, token: string): Promise<SandVariableOverrideView[]> {
    await this.readItem(bomItemId, token);
    const { reference } = await this.reference.get();
    const rows = await SandVariableOverridesService.rows(this.database.getUserClient(token), bomItemId);
    return reference ? overrideViews(reference, rows) : [];
  }

  /** Sets one variable for the part (with the reason). Audited. */
  async set(input: OverrideRequest, variable: string, value: string, reason: string): Promise<SandVariableOverrideView[]> {
    await this.readItem(input.bomItemId, input.token); // not found for another organization's item
    const { reference, missing } = await this.reference.get();
    if (!reference) throw new UnprocessableEntityException({ code: 'reference_unavailable', message: missing.join('; ') });
    const checked = checkOverride(reference, variable, value);
    if ('error' in checked) throw new UnprocessableEntityException({ code: 'invalid_override', message: checked.error });
    const previous = (await SandVariableOverridesService.rows(this.database.getUserClient(input.token), input.bomItemId)).find((r) => r.variable === variable);
    const { error } = await this.admin()
      .from('sand_variable_overrides')
      .upsert(
        {
          bom_item_id: input.bomItemId,
          variable,
          organization_id: input.organizationId,
          value: checked.value,
          reason: reason.trim(),
          set_by: input.userId,
          set_at: new Date().toISOString(),
        },
        { onConflict: 'bom_item_id,variable' },
      );
    if (error) throw new Error(`Could not store the sand variable override: ${error.message}`);
    await this.audit.recordBestEffort({
      action: 'sand_variable_override.set',
      targetType: 'bom_item',
      targetId: input.bomItemId,
      organizationId: input.organizationId,
      meta: { variable, value: checked.value, reason: reason.trim(), previousValue: previous?.value ?? null, plantValue: reference.plantOrSharedValue(variable) ?? null },
    });
    return this.list(input.bomItemId, input.token);
  }

  /** Returns one variable to the plant value. Audited. */
  async clear(input: OverrideRequest, variable: string): Promise<SandVariableOverrideView[]> {
    await this.readItem(input.bomItemId, input.token);
    const previous = (await SandVariableOverridesService.rows(this.database.getUserClient(input.token), input.bomItemId)).find((r) => r.variable === variable);
    const { error } = await this.admin().from('sand_variable_overrides').delete().eq('bom_item_id', input.bomItemId).eq('variable', variable);
    if (error) throw new Error(`Could not remove the sand variable override: ${error.message}`);
    if (previous) {
      await this.audit.recordBestEffort({
        action: 'sand_variable_override.cleared',
        targetType: 'bom_item',
        targetId: input.bomItemId,
        organizationId: input.organizationId,
        meta: { variable, previousValue: previous.value, previousReason: previous.reason },
      });
    }
    return this.list(input.bomItemId, input.token);
  }

  /** The service-role client, only used after the BOM item was read as the user (row-level security decides whether it is theirs). */
  private admin() {
    return this.database.getPrivilegedClient('sand variable overrides: store a part\'s own plant-variable value after an RLS check of the BOM item');
  }

  private async readItem(bomItemId: string, token: string): Promise<void> {
    const { data, error } = await this.database.getUserClient(token).from('bom_items').select('id').eq('id', bomItemId).maybeSingle();
    if (error) throw new Error(`Could not read the BOM item: ${error.message}`);
    if (!data) throw new NotFoundException(`BOM item ${bomItemId} not found`);
  }
}
