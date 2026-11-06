import { Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';

import { DatabaseService } from '../../../common/database/database.service';
import { buildCostTable, type CostTable, type LogisticsRecord, type MaterialRecord, type ProcessRecord, type ProcuredRecord, type ToolingRecord } from '../costing/shared/cost-table';

/**
 * The applied cost of a part as a table (see costing/shared/cost-table.ts): the active rows Apply Scenario wrote, read as the user (row-level security
 * decides whether the item is theirs) and laid out. No engine runs: it is as fast as five reads, and it shows what was applied, never an estimate.
 */
@Injectable()
export class CostTableService {
  constructor(private readonly database: DatabaseService) {}

  async forItem(id: string, token: string): Promise<CostTable> {
    const client = this.database.getUserClient(token);
    const active = <T>(table: string, columns: string) =>
      client.from(table).select(columns).eq('bom_item_id', id).eq('is_active', true).then((r) => {
        if (r.error) throw new InternalServerErrorException(`Could not read ${table}: ${r.error.message}`);
        return (r.data ?? []) as unknown as T[];
      });

    const { data: item, error } = await client.from('bom_items').select('id, name, annual_volume').eq('id', id).maybeSingle();
    if (error) throw new InternalServerErrorException(`Could not read the BOM item: ${error.message}`);
    if (!item) throw new NotFoundException(`BOM item ${id} not found`);

    const [processes, materials, logistics, procured, tooling] = await Promise.all([
      active<ProcessRecord>('process_cost_records', 'id, operation, process_name, process_group, machine_name, cycle_time, setup_cost_per_part, total_cost_per_part, op_nbr, created_at, parts_per_cycle, scrap, setup_time, batch_size, machine_rate, labor_rate, timing_source, setup_time_source'),
      active<MaterialRecord>('raw_material_cost_records', 'id, material_name, unit_cost, net_usage, total_cost, material_utilization_rate'),
      active<LogisticsRecord>('packaging_logistics_cost_records', 'id, cost_name, total_cost'),
      active<ProcuredRecord>('procured_parts_cost_records', 'id, part_name, total_cost'),
      active<ToolingRecord>('tooling_cost_records', 'id, tooling_type, description, unit_cost, quantity, total_cost, total_tooling_investment'),
    ]);

    const row = item as { id: string; name: string; annual_volume: number | null };
    return buildCostTable({ part: { id: row.id, name: row.name, annualVolume: row.annual_volume }, processes, materials, logistics, procured, tooling });
  }
}
