import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';

import { RawMaterialsService } from '../../raw-materials/raw-materials.service';
import { RawMaterialCostService } from '../../raw-materials/services/raw-material-cost.service';
import type { BOMItemResponseDto } from '../dto/bom-item-response.dto';
import type { CostSummaryResponseDto } from '../dto/cost-breakdown.dto';
import { deriveMaterialUsage, type DeriveMaterialUsageInput, type MaterialUsage } from '../costing/shared/material-usage';
import { explainMaterialUsage, type MaterialUsageExplanation } from '../costing/shared/material-usage-explanation';
import { TWO_MODEL_FAMILY } from '../costing/two-model/two-model-cost';

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

/** The material record's name for a source component: what the Cost tab lists as the part's material. */
export const sourceComponentMaterialName = (sourceName: string) => `Source component: ${sourceName}`;

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
    const { liveGross, liveNet } = liveWeights(summary);

    const active = (await this.costRecords.findAll({ bomItemId: item.id, isActive: true, page: 1, limit: 10 } as never, userId, token)).records ?? [];

    // 2-Model Machining: the material is the source component, one piece at its cost, never the grade's stock by the kg (the summary's weights are
    // the source's mass, so a stock record would price a casting as raw metal). A 2-Model part that could not be costed (no source linked) gets
    // no record at all: the Apply is refused at its route, and a stock record would put the bar stock back in the part's total.
    if (summary.family === TWO_MODEL_FAMILY) {
      return summary.sourceComponent ? this.ensureSourceComponent(input, active) : { action: 'kept', recordId: null, usage: null };
    }

    const existing = active.find((r) => (r.totalCost ?? 0) > 0 && r.materialName === grade);
    const staleAgainstNesting = !!existing && (
      (liveGross !== null && relDiff(Number(existing.grossUsage ?? 0), liveGross) > STALE_RELATIVE_DIFFERENCE)
      || (liveNet !== null && relDiff(Number(existing.netUsage ?? 0), liveNet) > STALE_RELATIVE_DIFFERENCE)
    );
    // The geometry does not change with the Digital Factory, the price per kg does.
    const staleAgainstLocation = !!existing && (existing.country ?? '') !== location;
    // The blank the engine sized, as it describes it ("59×50×49 billet"): what the Part Summary shows as the stock.
    const stockLabel = summary.blankSpec?.sizeLabel?.trim() || undefined;
    if (existing && !staleAgainstNesting && !staleAgainstLocation) {
      // A kept record written before the stock was recorded, or for a blank since resized within tolerance, takes the current label.
      if (stockLabel && existing.stockLabel !== stockLabel) await this.costRecords.update(existing.id, { stockLabel } as never, userId, token);
      return { action: 'kept', recordId: existing.id, usage: null };
    }

    // Retire every active record first; one that cannot be retired stops the apply (a second active record doubles the material cost).
    for (const r of active) {
      try {
        await this.costRecords.update(r.id, { isActive: false } as never, userId, token);
      } catch (e: unknown) {
        throw new InternalServerErrorException(`Could not retire the existing material cost record ${r.id}: ${e instanceof Error ? e.message : String(e)}. Nothing was added, to avoid a duplicate.`);
      }
    }

    const material = await this.findMaterial(grade, userId, token);
    const usage = deriveMaterialUsage(usageInput(item, summary, material?.densityKgM3 ?? null));

    // unitCost 0 asks the cost-record service for the grade's price at the location (see its create()).
    const created = await this.costRecords.create(
      {
        bomItemId: item.id,
        ...(material?.id ? { materialId: material.id } : {}),
        materialName: grade,
        materialGroup: material?.materialGroup,
        materialType: material?.materialType,
        materialDescription: material?.materialDescription,
        ...(stockLabel ? { stockLabel } : {}),
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

    // The record carries the engine's own price per kg: the price the quote was built on, so the applied material cost is the quoted one.
    // An engine prices a bar, tube or sheet at its stock form's price (material_stock_prices) and a casting at its alloy's; the service's
    // lookup takes the grade's base price from the first row of that name in any process group (a Bar and Tube part's rectangular bar at
    // 7.011 USD/kg was recorded at 5.38, the Die Casting row's, so the applied total was not the quote). The looked-up price stays when the
    // engine has none, or took only a default; with no looked-up price the engine's is used whatever its source.
    const usdPerKg = (summary.materialCostPerKg ?? 0) / (summary.usdToDisplayRate ?? 1);
    const looked = created.unitCost > 0;
    const differs = Math.abs(usdPerKg - created.unitCost) > 1e-6 * Math.max(usdPerKg, 1e-9);
    if (usdPerKg > 0 && differs && (!looked || summary.materialSource === 'db')) {
      const notes = looked
        ? `The unit cost is the cost engine's price per kg (${usdPerKg.toFixed(4)} USD), the price the quote used; raw_materials lists ${created.unitCost.toFixed(4)} USD for "${grade}" at ${location}.`
        : `No raw_materials price for "${grade}" at ${location}: the unit cost is the cost engine's price per kg (${usdPerKg.toFixed(4)} USD).`;
      this.logger.log(`Material record for "${grade}" at ${location}: the engine's ${usdPerKg.toFixed(4)} USD/kg${looked ? ` (raw_materials ${created.unitCost.toFixed(4)})` : ''}`);
      await this.costRecords.update(created.id, { unitCost: usdPerKg, notes } as never, userId, token);
    }
    return { action: 'replaced', recordId: created.id, usage };
  }

  /**
   * The part's material record when it is machined from a source component: one piece (uom PC) of it, at its cost in USD (the summary's money is in
   * the display currency: usdToDisplayRate), no scrap, overhead or reclaim (they are inside the source's own cost). Kept when the active record is
   * this source at this cost and location; otherwise every active record is retired first, as for stock.
   */
  private async ensureSourceComponent(input: MaterialSnapshotInput, active: Array<{ id: string; materialName?: string | null; totalCost?: number | null; country?: string | null }>): Promise<MaterialSnapshotResult> {
    const { item, location, summary, userId, organizationId, token } = input;
    const source = summary.sourceComponent!;
    const usd = source.totalCost / (summary.usdToDisplayRate ?? 1);
    const name = sourceComponentMaterialName(source.name);
    const existing = active.find((r) => r.materialName === name && (r.country ?? '') === location && Math.abs((r.totalCost ?? 0) - usd) <= Math.max(0.005, usd * STALE_RELATIVE_DIFFERENCE));
    if (existing && active.length === 1) return { action: 'kept', recordId: existing.id, usage: null };
    for (const r of active) {
      try {
        await this.costRecords.update(r.id, { isActive: false } as never, userId, token);
      } catch (e: unknown) {
        throw new InternalServerErrorException(`Could not retire the existing material cost record ${r.id}: ${e instanceof Error ? e.message : String(e)}. Nothing was added, to avoid a duplicate.`);
      }
    }
    const created = await this.costRecords.create(
      {
        bomItemId: item.id,
        materialName: name,
        materialDescription: `2-Model Machining: machined from ${source.name}, at its ${source.basis === 'fully_burdened' ? 'fully burdened' : 'piece part'} cost (material ${source.materialCost.toFixed(2)}, process ${source.processCost.toFixed(2)}, tooling ${source.toolingCost.toFixed(2)}).`,
        country: location,
        uom: 'PC',
        netUsage: 1,
        grossUsage: 1,
        scrap: 0,
        overhead: 0,
        reclaimRate: 0,
        unitCost: usd,
        isActive: true,
      } as never,
      userId,
      token,
      organizationId,
    );
    return { action: 'replaced', recordId: created.id, usage: null };
  }

  /**
   * The usage Apply would record for the part at this cost summary, with the working behind each figure (the calculator that ran, or the rule, and every
   * value it read). Nothing is written: the Raw Material dialog shows it and fills its fields from it.
   */
  async explain(item: BOMItemResponseDto, grade: string, summary: CostSummaryResponseDto, userId: string, token: string): Promise<MaterialUsageExplanation> {
    const material = grade ? await this.findMaterial(grade, userId, token) : null;
    return explainMaterialUsage({ ...usageInput(item, summary, material?.densityKgM3 ?? null), calculatorRuns: summary.calculatorRuns ?? null, runnerSystem: summary.injectionMolding?.runnerSystemType ?? null });
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

/** The engine's live per-part weights; null where it reported none. */
function liveWeights(summary: CostSummaryResponseDto): { liveGross: number | null; liveNet: number | null } {
  return {
    liveGross: (summary.grossWeightKg ?? 0) > 0 ? summary.grossWeightKg : null,
    liveNet: (summary.blankSpec?.netWeightKg ?? 0) > 0 ? summary.blankSpec!.netWeightKg : null,
  };
}

/** What the usage of a part is derived from: the engine's results in the cost summary, the part's geometry and the material's density. */
function usageInput(item: BOMItemResponseDto, summary: CostSummaryResponseDto, densityKgM3: number | null): DeriveMaterialUsageInput {
  const { liveGross, liveNet } = liveWeights(summary);
  const featureGraph = item.featureGraph as { classification?: { family?: string }; summary?: { sheetThicknessMm?: number } } | null | undefined;
  const family = summary.family ?? featureGraph?.classification?.family;
  return {
    blankSpec: summary.blankSpec,
    isSheetMetal: featureGraph?.classification?.family === 'sheet_metal' || Number(featureGraph?.summary?.sheetThicknessMm ?? 0) > 0,
    engineGrossKg: liveGross,
    engineNetKg: liveNet,
    itemVolumeMm3: item.volume,
    densityKgM3,
    cadWeightKg: typeof item.weight === 'number' && item.weight > 0 ? item.weight : null,
    castingMetal: summary.castingMetal ?? null,
    moldingGrossKg: family === 'plastic_molded' ? liveGross : null,
  };
}
