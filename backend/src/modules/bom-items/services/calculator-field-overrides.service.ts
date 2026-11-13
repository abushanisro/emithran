import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';

import { AuditService } from '../../../common/audit/audit.service';
import { isMissingTable } from '../../../common/db/missing-table';
import type { DbClient } from '../../../common/db/postgrest-client';
import { DatabaseService } from '../../../common/database/database.service';
import type { CalculatorFieldOverrides } from '../costing/shared/calculators/reference-calculator';

export interface CalculatorFieldOverrideRow {
  calculator_name: string;
  field_name: string;
  value: number | string;
  reason: string;
  set_by: string;
  set_at: string;
}

export interface CalculatorFieldOverrideView {
  calculator: string;
  field: string;
  value: number;
  reason: string;
  setBy: string;
  setAt: string;
}

export interface FieldOverrideRequest {
  bomItemId: string;
  userId: string;
  organizationId: string;
  token: string;
}

const COLUMNS = 'calculator_name, field_name, value, reason, set_by, set_at';

/** The rows as the costing lays them over the calculators: per calculator name, per field. */
export function overridesByCalculator(rows: readonly CalculatorFieldOverrideRow[]): CalculatorFieldOverrides {
  const out: Record<string, Record<string, { value: number; reason: string }>> = {};
  for (const r of rows) {
    const value = Number(r.value);
    if (!Number.isFinite(value) || value <= 0) continue;
    (out[r.calculator_name] ??= {})[r.field_name] = { value, reason: r.reason };
  }
  return out;
}

/**
 * A part's own values for fields of stored calculators (migration 1011). The stored calculators are never edited: the costing lays these rows over
 * them for this one BOM item (withFieldOverrides). Writing is audited and needs a reason; the calculator and the field must exist.
 */
@Injectable()
export class CalculatorFieldOverridesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: AuditService,
  ) {}

  /** The rows of one BOM item, read with the caller's client (row-level security limits them to their organization). */
  static async rows(client: DbClient, bomItemId: string): Promise<CalculatorFieldOverrideRow[]> {
    const { data, error } = await client.from('calculator_field_overrides').select(COLUMNS).eq('bom_item_id', bomItemId);
    if (error && isMissingTable(error)) return [];
    if (error) throw new Error(`Could not read the calculator field overrides: ${error.message}`);
    return (data ?? []) as CalculatorFieldOverrideRow[];
  }

  async list(bomItemId: string, token: string): Promise<CalculatorFieldOverrideView[]> {
    await this.readItem(bomItemId, token);
    const rows = await CalculatorFieldOverridesService.rows(this.database.getUserClient(token), bomItemId);
    return rows.map((r) => ({ calculator: r.calculator_name, field: r.field_name, value: Number(r.value), reason: r.reason, setBy: r.set_by, setAt: r.set_at }));
  }

  /** Sets one field of one calculator for the part (with the reason). Audited. */
  async set(input: FieldOverrideRequest, calculator: string, field: string, value: number, reason: string): Promise<CalculatorFieldOverrideView[]> {
    await this.readItem(input.bomItemId, input.token);
    if (!Number.isFinite(value) || value <= 0) throw new UnprocessableEntityException({ code: 'invalid_override', message: 'The value must be a positive number.' });
    await this.assertField(input.token, calculator, field);
    const client = this.database.getUserClient(input.token);
    const previous = (await CalculatorFieldOverridesService.rows(client, input.bomItemId)).find((r) => r.calculator_name === calculator && r.field_name === field);
    const { error } = await this.admin()
      .from('calculator_field_overrides')
      .upsert(
        {
          bom_item_id: input.bomItemId, calculator_name: calculator, field_name: field, organization_id: input.organizationId,
          value, reason: reason.trim(), set_by: input.userId, set_at: new Date().toISOString(),
        },
        { onConflict: 'bom_item_id,calculator_name,field_name' },
      );
    if (error) throw new Error(`Could not store the calculator field override: ${error.message}`);
    await this.audit.recordBestEffort({
      action: 'calculator_field_override.set', targetType: 'bom_item', targetId: input.bomItemId, organizationId: input.organizationId,
      meta: { calculator, field, value, reason: reason.trim(), previousValue: previous ? Number(previous.value) : null },
    });
    return this.list(input.bomItemId, input.token);
  }

  /** Returns one field to the calculator for the part. Audited. */
  async clear(input: FieldOverrideRequest, calculator: string, field: string): Promise<CalculatorFieldOverrideView[]> {
    await this.readItem(input.bomItemId, input.token);
    const previous = (await CalculatorFieldOverridesService.rows(this.database.getUserClient(input.token), input.bomItemId))
      .find((r) => r.calculator_name === calculator && r.field_name === field);
    const { error } = await this.admin().from('calculator_field_overrides').delete()
      .eq('bom_item_id', input.bomItemId).eq('calculator_name', calculator).eq('field_name', field);
    if (error) throw new Error(`Could not remove the calculator field override: ${error.message}`);
    if (previous) {
      await this.audit.recordBestEffort({
        action: 'calculator_field_override.cleared', targetType: 'bom_item', targetId: input.bomItemId, organizationId: input.organizationId,
        meta: { calculator, field, previousValue: Number(previous.value), previousReason: previous.reason },
      });
    }
    return this.list(input.bomItemId, input.token);
  }

  /** The field must belong to a current global stored calculator of that name. */
  private async assertField(token: string, calculator: string, field: string): Promise<void> {
    const client = this.database.getUserClient(token);
    const { data: calc, error } = await client.from('calculators').select('id').eq('name', calculator).is('user_id', null).is('retired_at', null).maybeSingle();
    if (error) throw new Error(`Could not read the calculator: ${error.message}`);
    if (!calc) throw new UnprocessableEntityException({ code: 'unknown_calculator', message: `No stored calculator named "${calculator}".` });
    const { data: f, error: fieldError } = await client.from('calculator_fields').select('field_name').eq('calculator_id', (calc as { id: string }).id).eq('field_name', field).maybeSingle();
    if (fieldError) throw new Error(`Could not read the calculator field: ${fieldError.message}`);
    if (!f) throw new UnprocessableEntityException({ code: 'unknown_field', message: `"${calculator}" has no field "${field}".` });
  }

  /** The service-role client, only used after the BOM item was read as the user (row-level security decides whether it is theirs). */
  private admin() {
    return this.database.getPrivilegedClient('calculator field overrides: store a part\'s own calculator field value after an RLS check of the BOM item');
  }

  private async readItem(bomItemId: string, token: string): Promise<void> {
    const { data, error } = await this.database.getUserClient(token).from('bom_items').select('id').eq('id', bomItemId).maybeSingle();
    if (error) throw new Error(`Could not read the BOM item: ${error.message}`);
    if (!data) throw new NotFoundException(`BOM item ${bomItemId} not found`);
  }
}
