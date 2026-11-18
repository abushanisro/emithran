// 2-Model Machining (memory/"2 Mold Molding", the factory's 2-Model Machining data): a finished part machined from a source component, another
// item of the same BOM (the casting or forging blank). The part is priced on the Machining engine with two differences, decided here (pure):
//   - only the features it machines: an occurrence whose faces all lie on the source (the cad-engine's comparison, two_model/compare.py) is
//     the catalog's "Source Component: As Supplied" and costs nothing;
//   - no bar stock: its material is the source component, at its fully burdened cost (useSourceModelFBCAsMaterialCost) or its piece part
//     cost, shown in its own categories (rollupSourceCostsInCategories).
import type { CostSummaryDto, ProcessLineCost } from '../../dto/cost-breakdown.dto';
import { computeSustainability } from '../shared/core/cost-engine';
import { routeToolingItems } from '../shared/route-tooling';

export const TWO_MODEL_FAMILY = 'two_model';
export const TWO_MODEL_PROCESS_GROUP = '2-Model Machining';

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

type Occurrence = { face_ids?: number[] } & Record<string, unknown>;
type Feature = { id?: string; feature_type?: string; occurrences?: Occurrence[] } & Record<string, unknown>;
type LegacyFeature = { id?: string; type?: string; face_ids?: number[] } & Record<string, unknown>;

/** A feature occurrence is as supplied when every face it has lies on the source; one with no faces is not judged so (it is machined). */
const supplied = (faces: number[] | undefined, asSupplied: ReadonlySet<number>) => !!faces && faces.length > 0 && faces.every((f) => asSupplied.has(f));

/**
 * The part's feature graph with only what it machines: each feature_graph_v2 occurrence (and each machining recognizer feature) whose faces
 * all lie on the source is left out, and a feature with none left is dropped. Returns the graph and the features left as supplied, for the
 * process tree's "Source Component: As Supplied" step.
 */
export function machinedOnlyFeatureGraph(fg: any, asSuppliedFaceIds: readonly number[]): { fg: any; asSupplied: Array<{ featureId: string; featureType: string; occurrenceIndex: number; faceIds: number[] }> } {
  const set = new Set(asSuppliedFaceIds);
  const asSupplied: Array<{ featureId: string; featureType: string; occurrenceIndex: number; faceIds: number[] }> = [];
  const filterV2 = (graph: any) => {
    if (!graph || !Array.isArray(graph.features)) return graph;
    const features = (graph.features as Feature[]).flatMap((f) => {
      const occurrences = f.occurrences ?? [];
      const kept = occurrences.filter((o, i) => {
        if (!supplied(o.face_ids, set)) return true;
        if (graph === fg?.feature_graph_v2 || !fg?.feature_graph_v2) {
          asSupplied.push({ featureId: String(f.id ?? ''), featureType: String(f.feature_type ?? ''), occurrenceIndex: i, faceIds: o.face_ids ?? [] });
        }
        return false;
      });
      return kept.length === 0 ? [] : [{ ...f, occurrences: kept }];
    });
    return { ...graph, features };
  };
  const mf = fg?.machining_features;
  const machining = mf ? {
    ...mf,
    ...(Array.isArray(mf.features) ? { features: (mf.features as LegacyFeature[]).filter((f) => !supplied(f.face_ids, set)) } : {}),
    ...(mf.feature_graph_v2 ? { feature_graph_v2: filterV2(mf.feature_graph_v2) } : {}),
  } : mf;
  return { fg: { ...fg, feature_graph_v2: filterV2(fg?.feature_graph_v2), machining_features: machining }, asSupplied };
}

/** What the source component contributes, in the finished part's (local) currency. */
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
 * The source component's cost from its own Cost Summary (any display currency), in the part's local currency: the summary's money is
 * brought to USD through its own usdToDisplayRate and then to the part's currency. Its tooling per part (dies, molds, patterns) is in USD.
 */
export function sourceComponentCost(input: {
  itemId: string; name: string;
  summary: Pick<CostSummaryDto, 'materialCost' | 'totalProcessCost' | 'totalCost' | 'grossWeightKg' | 'tooling' | 'family' | 'dieTooling' | 'coreboxTooling' | 'patternTooling' | 'forgingDies'> & { usdToDisplayRate?: number };
  fullyBurdened: boolean;
  usdToLocal: number;
}): SourceComponentCost {
  const toLocal = (v: number) => (v / (input.summary.usdToDisplayRate ?? 1)) * input.usdToLocal;
  const tooling = input.fullyBurdened
    ? routeToolingItems(input.summary).reduce((s, t) => s + (t.amortizationParts > 0 ? t.investmentUsd / t.amortizationParts : 0), 0) * input.usdToLocal
    : 0;
  const material = toLocal(input.summary.materialCost);
  const process = toLocal(input.summary.totalProcessCost);
  return {
    itemId: input.itemId, name: input.name, basis: input.fullyBurdened ? 'fully_burdened' : 'piece_part',
    materialCost: material, processCost: process, toolingCost: tooling, totalCost: material + process + tooling,
    massKg: input.summary.grossWeightKg > 0 ? input.summary.grossWeightKg : null,
  };
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
