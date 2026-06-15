import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';

export interface EntitySnapshot {
  entityType: string;
  entityId: string;
  data: Record<string, unknown>;
}

/**
 * Hydrates a compact JSON snapshot for the entity the user is currently
 * viewing. This goes into every Echo chat turn so Claude doesn't have to
 * call tools just to learn the user's context.
 *
 * Design goals:
 *   - Single round-trip per turn (no chained queries unless cheap).
 *   - Bounded payload size (each snapshot caps at ~1 KB of JSON to control
 *     prompt cost).
 *   - Never crashes the chat turn — on any error, returns null and the chat
 *     proceeds without entity context.
 */
@Injectable()
export class EntityHydratorService {
  private readonly logger = new Logger(EntityHydratorService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async hydrate(
    entityType: string | undefined,
    entityId: string | undefined,
    accessToken: string | null,
  ): Promise<EntitySnapshot | null> {
    if (!entityType || !entityId) return null;

    try {
      const client = this.supabase.getClient(accessToken ?? undefined);
      switch (entityType) {
        case 'project':
          return await this.project(client, entityId);
        case 'bom':
          return await this.bom(client, entityId);
        case 'bom_item':
          return await this.bomItem(client, entityId);
        case 'rfq':
          return await this.rfq(client, entityId);
        case 'lot':
          return await this.lot(client, entityId);
        case 'vendor':
          return await this.vendor(client, entityId);
        default:
          return { entityType, entityId, data: { note: `No hydrator for type '${entityType}'` } };
      }
    } catch (e: any) {
      this.logger.warn(`hydrate ${entityType}/${entityId} failed: ${e?.message ?? e}`);
      return null;
    }
  }

  private async project(client: any, id: string): Promise<EntitySnapshot | null> {
    const { data } = await client
      .from('projects')
      .select('id, name, description, status, industry, country, state, city, target_bom_cost, estimated_annual_volume, created_at')
      .eq('id', id)
      .maybeSingle();
    if (!data) return null;
    return { entityType: 'project', entityId: id, data: trim(data) };
  }

  private async bom(client: any, id: string): Promise<EntitySnapshot | null> {
    const { data } = await client
      .from('boms')
      .select('id, project_id, name, version, status, created_at')
      .eq('id', id)
      .maybeSingle();
    if (!data) return null;
    const { count: itemCount } = await client
      .from('bom_items')
      .select('id', { count: 'exact', head: true })
      .eq('bom_id', id);
    return { entityType: 'bom', entityId: id, data: { ...trim(data), itemCount: itemCount ?? 0 } };
  }

  private async bomItem(client: any, id: string): Promise<EntitySnapshot | null> {
    const { data } = await client
      .from('bom_items')
      .select(
        'id, bom_id, name, part_number, description, item_type, quantity, unit, annual_volume, material, material_grade, make_buy, weight, max_length, max_width, max_height, surface_area, unit_cost, total_cost, currency, manufacturability_score, difficulty_level, recommended_processes, analysis_timestamp',
      )
      .eq('id', id)
      .maybeSingle();
    if (!data) return null;
    // Hydrate the parent BOM so Echo can navigate to project context if asked.
    const { data: bom } = await client
      .from('boms')
      .select('project_id, name, version')
      .eq('id', data.bom_id)
      .maybeSingle();
    return {
      entityType: 'bom_item',
      entityId: id,
      data: trim({ ...data, project_id: bom?.project_id, bom_name: bom?.name }),
    };
  }

  private async rfq(client: any, id: string): Promise<EntitySnapshot | null> {
    const { data } = await client
      .from('rfq_tracking')
      .select('id, project_id, status, vendor_count, part_count, sent_at, created_at')
      .eq('id', id)
      .maybeSingle();
    if (!data) return null;
    return { entityType: 'rfq', entityId: id, data: trim(data) };
  }

  private async lot(client: any, id: string): Promise<EntitySnapshot | null> {
    const { data } = await client
      .from('production_planning_lots')
      .select('id, project_id, name, status, planned_quantity, completed_quantity, target_date, updated_at')
      .eq('id', id)
      .maybeSingle();
    if (!data) return null;
    return { entityType: 'lot', entityId: id, data: trim(data) };
  }

  private async vendor(client: any, id: string): Promise<EntitySnapshot | null> {
    const { data } = await client
      .from('vendor_summary')
      .select('id, name, supplier_code, city, state, country, status, vendor_type, process, industries, certifications')
      .eq('id', id)
      .maybeSingle();
    if (!data) return null;
    return { entityType: 'vendor', entityId: id, data: trim(data) };
  }
}

/**
 * Strips `null` and undefined keys to keep the JSON payload tight — every
 * extra token in the entity snapshot ships in every turn.
 */
function trim<T extends Record<string, unknown>>(data: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v !== null && v !== undefined && v !== '') out[k] = v;
  }
  return out;
}
