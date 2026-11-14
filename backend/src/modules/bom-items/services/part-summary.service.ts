import { Injectable } from '@nestjs/common';

import { DatabaseService } from '../../../common/database/database.service';
import { escapeLikePattern, quoteFilterValue } from '../../../common/db/postgrest-filter';
import { resolveCostingInputs } from '../costing/shared/physics/costing-inputs';
import { buildPartSummary, type PartSummary } from '../costing/shared/part-summary';
import { CostTableService } from './cost-table.service';

/** The fields of the BOM item the summary reads (the item is read once by the controller, as for every other view). */
interface SummaryItem {
  id: string;
  materialGrade?: string | null;
  maxLength?: number | null;
  maxWidth?: number | null;
  maxHeight?: number | null;
  surfaceArea?: number | null;
  volume?: number | null;
  annualVolume?: number | null;
  scenarioOverrides?: Record<string, unknown> | null;
}

/**
 * The Part Summary of an item (costing/shared/part-summary.ts): the applied cost table, the item's geometry, the scenario's resolved production inputs and the material's
 * library row. No engine runs and nothing is priced: it is a projection of what Apply Scenario wrote, so it agrees with the Part Details view by construction.
 */
@Injectable()
export class PartSummaryService {
  constructor(private readonly costTables: CostTableService, private readonly database: DatabaseService) {}

  async forItem(item: SummaryItem, token: string): Promise<PartSummary> {
    const table = await this.costTables.forItem(item.id, token);
    // Applied means a cost object was written: a part row alone (every item has one) is not a cost.
    const applied = table.rows.some((r) => r.kind !== 'part');
    const inputs = resolveCostingInputs({ scenarioOverrides: item.scenarioOverrides ?? null, item: { annualVolume: item.annualVolume ?? null } });
    return buildPartSummary({
      item: { lengthMm: item.maxLength, widthMm: item.maxWidth, heightMm: item.maxHeight, surfaceAreaMm2: item.surfaceArea, volumeMm3: item.volume },
      inputs: { batchSize: inputs.batchSize, location: inputs.location, annualVolume: inputs.annualVolume, productionLifeYears: inputs.productionLifeYears },
      table: applied ? table : null,
      material: await this.material(token, item.id, item.materialGrade ?? null),
    });
  }

  /** The blank the applied material record was costed from (raw_material_cost_records.stock_label); null when none was recorded. */
  private async appliedStock(token: string, itemId: string): Promise<string | null> {
    const { data } = await this.database.getUserClient(token).from('raw_material_cost_records').select('stock_label')
      .eq('bom_item_id', itemId).eq('is_active', true).not('stock_label', 'is', null).limit(1);
    return ((data ?? [])[0] as { stock_label?: string | null } | undefined)?.stock_label ?? null;
  }

  /** The material's row in the library, by its grade; null when the grade is not one row (nothing is guessed from a partial match). */
  private async material(token: string, itemId: string, grade: string | null) {
    // The stock is the blank the applied cost was sized on; the library's stock form stands in where none was recorded.
    const stock = await this.appliedStock(token, itemId);
    const onlyStock = stock ? { name: null, stockForm: stock, priceSource: null, priceVersion: null } : null;
    const g = grade?.trim();
    if (!g) return onlyStock;
    const client = this.database.getUserClient(token);
    const { data, error } = await client.from('raw_materials').select('name, stock_form, price_source, price_version')
      .or(`name.ilike.${quoteFilterValue(escapeLikePattern(g))},grade.ilike.${quoteFilterValue(escapeLikePattern(g))}`).limit(5);
    if (error || !data || data.length === 0) return onlyStock;
    const rows = data as Array<{ name: string; stock_form: string | null; price_source: string | null; price_version: string | null }>;
    const exact = rows.filter((r) => r.name === g);
    const row = exact.length === 1 ? exact[0]! : rows.length === 1 ? rows[0]! : null;
    return row ? { name: row.name, stockForm: stock ?? row.stock_form, priceSource: row.price_source, priceVersion: row.price_version } : onlyStock;
  }
}
