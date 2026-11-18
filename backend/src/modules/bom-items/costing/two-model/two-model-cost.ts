// 2-Model Machining (memory/"2 Mold Molding", the factory's 2-Model Machining data): a finished part machined from a cast or forged blank,
// its source component. The blank is derived from the part's own model (derived-blank.ts, user decision 2026-11-18): its cost is the part's
// material, at its fully burdened cost (useSourceModelFBCAsMaterialCost) or its piece part cost, shown in its own categories
// (rollupSourceCostsInCategories); the part's machining is what the blank's casting cannot hold. Pure.
import type { CostSummaryDto, ProcessLineCost } from '../../dto/cost-breakdown.dto';
import { computeSustainability } from '../shared/core/cost-engine';

export const TWO_MODEL_FAMILY = 'two_model';
export const TWO_MODEL_PROCESS_GROUP = '2-Model Machining';
/** The staged 2-Model Machining data (memory/"2 Mold Molding", migration 823): useSourceModelFBCAsMaterialCost. */
export const TWO_MODEL_SOURCE_VERSION = '2026-2MoldMolding';

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** What the source component (the derived blank) contributes, in the summary's currency. */
export interface SourceComponentCost {
  itemId: string;
  name: string;
  /** 'fully_burdened': material + process + its tooling per part; 'piece_part': material + process. */
  basis: 'fully_burdened' | 'piece_part';
  materialCost: number;
  processCost: number;
  toolingCost: number;
  totalCost: number;
  /** The source's mass (kg): what the part is machined from. */
  massKg: number | null;
}

/**
 * The machined part's summary with the source component as its material: no bar stock (its blank and waste are gone), the source's cost in
 * its own categories, and the total from them. The machining lines are the engine's, for the machined features only.
 */
export function withSourceComponent<T extends CostSummaryDto>(
  summary: T, source: SourceComponentCost,
  extra: {
    asSuppliedCount: number; removedVolumeMm3: number | null; warnings: string[];
    /** The part's machining when it is not the summary's own lines (a derived blank: its machining-after-casting lines). */
    lines?: ProcessLineCost[];
    derived?: { blankProcess: string; allowanceVolumeMm3: number; asSuppliedFaceIds: number[] };
  },
): T {
  const { blankSpec: _blank, ...rest } = summary as T & { blankSpec?: unknown };
  const processLines = extra.lines ?? summary.processLines;
  const totalProcessCost = extra.lines ? extra.lines.reduce((s, l) => s + l.totalCost, 0) : summary.totalProcessCost;
  const materialCost = source.totalCost;
  const total = materialCost + totalProcessCost;
  return {
    ...rest,
    processLines,
    totalProcessCost: r2(totalProcessCost),
    family: 'two_model',
    materialCost: r2(materialCost),
    materialCostPerKg: source.massKg ? materialCost / source.massKg : summary.materialCostPerKg,
    grossWeightKg: source.massKg != null ? r3(source.massKg) : summary.grossWeightKg,
    totalCost: r2(total),
    ...(source.massKg != null ? { castingMetal: { partKg: summary.grossWeightKg, chargedKg: source.massKg } } : {}),
    sourceComponent: {
      itemId: source.itemId, name: source.name, basis: source.basis,
      materialCost: r2(source.materialCost), processCost: r2(source.processCost), toolingCost: r2(source.toolingCost), totalCost: r2(source.totalCost),
      asSuppliedFeatures: extra.asSuppliedCount, removedVolumeMm3: extra.removedVolumeMm3,
      ...(extra.derived ? { derived: true, blankProcess: extra.derived.blankProcess, allowanceVolumeMm3: Math.round(extra.derived.allowanceVolumeMm3), asSuppliedFaceIds: extra.derived.asSuppliedFaceIds } : {}),
    },
    warnings: [
      `2-Model Machining: machined from ${source.name}, its ${source.basis === 'fully_burdened' ? 'fully burdened cost (material, process and tooling per part, useSourceModelFBCAsMaterialCost)' : 'piece part cost (material and process)'} is the material; ${extra.asSuppliedCount} feature${extra.asSuppliedCount === 1 ? '' : 's'} left as supplied cost nothing.`,
      ...extra.warnings,
      ...summary.warnings.filter((w) => !/billet|bar stock|stock allowance/i.test(w)),
    ],
  } as T;
}

/** A 2-Model part that cannot be costed: one named, uncosted line saying what is missing; never priced from bar stock instead. */
export function twoModelGapSummary(reason: string, base: { materialGrade: string | null; batchSize: number; ratesSource: string }): CostSummaryDto {
  const line: ProcessLineCost = {
    process: TWO_MODEL_PROCESS_GROUP, processGroup: TWO_MODEL_PROCESS_GROUP, processRoute: TWO_MODEL_PROCESS_GROUP, operation: TWO_MODEL_PROCESS_GROUP,
    setupCost: 0, runCost: 0, totalCost: 0, cycleTimeMin: 0, hourlyRate: 0, rateSource: 'no_db_rate',
    machineClass: 'two_model', machineName: null, commodityCode: null, labourRate: null,
    physicsGap: { gapType: 'unsupported_operation', process: TWO_MODEL_PROCESS_GROUP, machineClass: 'two_model', reason: `2-Model Machining cannot be costed: ${reason}` },
  };
  return {
    materialCost: 0, materialGrade: base.materialGrade ?? 'Unknown', grossWeightKg: 0, materialCostPerKg: 0, materialSource: 'default',
    processLines: [line], totalProcessCost: 0, totalCost: 0,
    cycleTimes: { laserMin: 0, pressBrakeMin: 0, tappingMin: 0, deburrMin: 0, totalMin: 0 },
    batchSize: base.batchSize, family: 'two_model',
    sustainability: computeSustainability(base.materialGrade, 0, 0, 0, base.batchSize, [line]),
    warnings: [`2-Model Machining cannot be costed: ${reason}`],
    ratesSource: base.ratesSource,
  };
}
