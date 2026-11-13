import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';

import { RawMaterialsService } from '../../raw-materials/raw-materials.service';
import { RawMaterialCostService } from '../../raw-materials/services/raw-material-cost.service';
import type { BOMItemResponseDto } from '../dto/bom-item-response.dto';
import type { CostSummaryResponseDto } from '../dto/cost-breakdown.dto';
import { deriveMaterialUsage, type MaterialUsage } from '../costing/shared/material-usage';

export interface MaterialSnapshotInput {
  item: BOMItemResponseDto;
  grade: string;
  location: string;
  /** The cost summary at the scenario being applied: the engine's own weights and prices, which the record is a snapshot of. */
  summary: CostSummaryResponseDto;
  userId: string;
  organizationId: string;
  token: string;
}

export interface MaterialSnapshotResult {
  /** kept: the active record is still right for this grade, geometry and location. replaced: stale records were retired and a new one written. */
  action: 'kept' | 'replaced';
  recordId: string | null;
  usage: MaterialUsage | null;
}

/** A stored usage that differs from the engine's live one by more than this share means the record is stale. */
const STALE_RELATIVE_DIFFERENCE = 0.01;

const relDiff = (stored: number, live: number) => (live > 0 ? Math.abs(stored - live) / live : 0);

/**
 * The part's Raw Material cost record for the applied scenario: net and gross usage from the engine's real nesting or stock result, the unit price of
 * the grade at the location. Moved from the browser (Apply's `autoAddMaterialCost`), where it was computed from the cost summary and priced with a
 * location-name match; the record now takes its price from the one derivation the cost-record service already owns (regional column, currency
 * conversion, a disclosed India fallback, the currency provenance of migration 708).
 *
 * The existing record is kept when it is still right (same grade, usage within 1% of the engine's, same location). Otherwise every active record of the
 * part is retired first, and the new one is written only if that succeeded: two active records would double the material cost.
 */
@Injectable()
export class MaterialCostSnapshotService {
  private readonly logger = new Logger(MaterialCostSnapshotService.name);

  constructor(
    private readonly costRecords: RawMaterialCostService,
    private readonly materials: RawMaterialsService,
  ) {}

  async ensure(input: MaterialSnapshotInput): Promise<MaterialSnapshotResult> {
    const { item, grade, location, summary, userId, organizationId, token } = input;
    const liveGross = (summary.grossWeightKg ?? 0) > 0 ? summary.grossWeightKg : null;
    const liveNet = (summary.blankSpec?.netWeightKg ?? 0) > 0 ? summary.blankSpec!.netWeightKg : null;

    const active = (await this.costRecords.findAll({ bomItemId: item.id, isActive: true, page: 1, limit: 10 } as never, userId, token)).records ?? [];

    const existing = active.find((r) => (r.totalCost ?? 0) > 0 && r.materialName === grade);
    const staleAgainstNesting = !!existing && (
      (liveGross !== null && relDiff(Number(existing.grossUsage ?? 0), liveGross) > STALE_RELATIVE_DIFFERENCE)
      || (liveNet !== null && relDiff(Number(existing.netUsage ?? 0), liveNet) > STALE_RELATIVE_DIFFERENCE)
    );
    // The geometry does not change with the Digital Factory, the price per kg does.
    const staleAgainstLocation = !!existing && (existing.country ?? '') !== location;
    if (existing && !staleAgainstNesting && !staleAgainstLocation) return { action: 'kept', recordId: existing.id, usage: null };

    // Retire every active record first; one that cannot be retired stops the apply (a second active record doubles the material cost).
    for (const r of active) {
      try {
        await this.costRecords.update(r.id, { isActive: false } as never, userId, token);
      } catch (e: unknown) {
        throw new InternalServerErrorException(`Could not retire the existing material cost record ${r.id}: ${e instanceof Error ? e.message : String(e)}. Nothing was added, to avoid a duplicate.`);
      }
    }

    const material = await this.findMaterial(grade, userId, token);
    const featureGraph = item.featureGraph as { classification?: { family?: string } } | null | undefined;
    const isSheetMetal = featureGraph?.classification?.family === 'sheet_metal'
      || Number((featureGraph as { summary?: { sheetThicknessMm?: number } } | null | undefined)?.summary?.sheetThicknessMm ?? 0) > 0;
    const usage = deriveMaterialUsage({
      blankSpec: summary.blankSpec,
      isSheetMetal,
      engineGrossKg: liveGross,
      engineNetKg: liveNet,
      itemVolumeMm3: item.volume,
      densityKgM3: material?.densityKgM3 ?? null,
      cadWeightKg: typeof item.weight === 'number' && item.weight > 0 ? item.weight : null,
      castingMetal: summary.castingMetal ?? null,
    });

    // unitCost 0 asks the cost-record service for the grade's price at the location (see its create()).
    const created = await this.costRecords.create(
      {
        bomItemId: item.id,
        ...(material?.id ? { materialId: material.id } : {}),
        materialName: grade,
        materialGroup: material?.materialGroup,
        materialType: material?.materialType,
        materialDescription: material?.materialDescription,
        country: location,
        netUsage: usage.netUsage,
        grossUsage: usage.grossUsage,
        scrap: usage.scrapPct,
        overhead: 5,
        reclaimRate: 0,
        unitCost: 0,
        isActive: true,
      } as never,
      userId,
      token,
      organizationId,
    );

    // No price for the grade in raw_materials: the engine priced the part anyway (its own tables), and that is the figure the record carries.
    if (!(created.unitCost > 0)) {
      const usdPerKg = (summary.materialCostPerKg ?? 0) / (summary.usdToDisplayRate ?? 1);
      if (usdPerKg > 0) {
        this.logger.log(`No raw_materials price for "${grade}" at ${location}: the record carries the engine's ${usdPerKg.toFixed(4)} USD/kg`);
        // The service noted that it found no price and defaulted to 0: say what the record carries now.
        await this.costRecords.update(
          created.id,
          { unitCost: usdPerKg, notes: `No raw_materials price for "${grade}" at ${location}: the unit cost is the cost engine's price per kg (${usdPerKg.toFixed(4)} USD).` } as never,
          userId,
          token,
        );
      }
    }
    return { action: 'replaced', recordId: created.id, usage };
  }

  /** The raw_materials row of the grade: the exact name or grade, else the ranked search's unambiguous best (the ranker the costing engine resolves with). */
  private async findMaterial(grade: string, userId: string, token: string) {
    try {
      const { items } = await this.materials.findAll({ search: grade, limit: 10 } as never, userId, token);
      const exact = (m: { material?: string; materialGrade?: string }) => m.materialGrade === grade || m.material === grade || `${m.material ?? ''} ${m.materialGrade ?? ''}`.trim() === grade;
      return items.find(exact) ?? items.find((m) => m.matchIsBest) ?? null;
    } catch {
      return null; // a failed lookup leaves the record without links, and priced by the service from the name
    }
  }
}
