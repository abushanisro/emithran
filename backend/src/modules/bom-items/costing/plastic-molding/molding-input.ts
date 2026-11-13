// What the plastic engine is given for a part, built in one place. The Cost Summary prices the selected press and the Route Comparison prices every
// press tier; both start from this same part, material and routing-signal input and add the press. Pure: facts in, engine input out.
import { type DraftSummary, undercutCountFromDraftSummary } from './draft-signals';
import type { InjectionMoldingCostInput } from './process/cost-injection-molding-engine';
import { sideActionSignals } from './side-action-signals';
import { ribSignals } from './process/rib-inserts';
import type { PlasticFeatureGraph } from './operation/plastic-catalog-operations.service';

/** The part's three bounding-box sides, longest first. A side CAD did not measure is 0. */
export function partBboxLongestFirst(item: { maxLength?: number | null; maxWidth?: number | null; maxHeight?: number | null }): [number, number, number] {
  const [a = 0, b = 0, c = 0] = [item.maxLength ?? 0, item.maxWidth ?? 0, item.maxHeight ?? 0].sort((x, y) => y - x);
  return [a, b, c];
}

/** The feature graph's summary, as the molding signals read it. */
export type MoldingSummary = DraftSummary & {
  wallThicknessNominalMm?: number | null;
  wallThicknessMinMm?: number | null;
  wallThicknessMaxMm?: number | null;
  ribCount?: number | null;
  ribCountProxy?: number | null;
  blindFeatureCount?: number | null;
  insertCandidateCount?: number | null;
  partingComplexity?: number | null;
  plasticFeatureGraph?: PlasticFeatureGraph | null;
};

const positive = (n: number | null | undefined): number | null => (n != null && n > 0 ? n : null);

/** The measured length of the part's parting line (the PartingLine feature of the plastic feature graph); null when the graph has none. */
function partingLineLengthMm(graph: MoldingSummary['plasticFeatureGraph']): number | null {
  const line = graph?.items.find((f) => f.feature_type === 'PartingLine');
  return positive(Number(line?.attributes?.length_mm));
}

/** Routing signals from the CAD analysis. A signal the analysis did not produce is null: the router then records a warning instead of assuming one. */
export function moldingSignals(summary: MoldingSummary, bbox: readonly [number, number, number]): NonNullable<InjectionMoldingCostInput['signals']> {
  const sideActions = sideActionSignals(summary.plasticFeatureGraph);
  return {
    // The footprint of the two longest sides, when CAD measured both.
    projectedAreaMm2: bbox[0] * bbox[1] > 0 ? bbox[0] * bbox[1] : null,
    wallThicknessMinMm: positive(summary.wallThicknessMinMm),
    wallThicknessMaxMm: positive(summary.wallThicknessMaxMm),
    // Real rib count (antiparallel wall-face pairs); the pocket-floor proxy when the CAD engine predates it.
    ribCount: positive(summary.ribCount) ?? positive(summary.ribCountProxy),
    // Bosses are blind cylindrical features (cap-detected), not every cylinder.
    bossCount: positive(summary.blindFeatureCount),
    // Features that need a side action when the recognised graph can say; else the draft analysis's face count.
    undercutCount: sideActions?.undercutFeatures ?? undercutCountFromDraftSummary(summary),
    slideBundleCount: sideActions?.slideBundles ?? null,
    slideOrLifterBundleCount: sideActions?.slideOrLifterBundles ?? null,
    sideActionBlocks: sideActions?.blocks ?? null,
    maxSlideStrokeMm: sideActions?.maxSlideStrokeMm ?? null,
    ribs: ribSignals(summary.plasticFeatureGraph),
    partingComplexity: summary.partingComplexity ?? null,
    partingLineLengthMm: partingLineLengthMm(summary.plasticFeatureGraph),
    insertCount: positive(summary.insertCandidateCount),
  };
}

/** What is not the press: everything the engine needs about the part, its material, the plant and the scenario. */
export type MoldingCommonInput = Omit<InjectionMoldingCostInput, 'mhrRate' | 'machineClampTonnes' | 'machineShotCapacityG' | 'pressTiming' | 'goodPartYield'>;

export interface MoldingCommonFacts {
  item: { volume?: number | null; surfaceArea?: number | null; maxLength?: number | null; maxWidth?: number | null; maxHeight?: number | null; scenarioOverrides?: Record<string, unknown> | null };
  summary: MoldingSummary;
  grade: string | null;
  family: string;
  material: Pick<InjectionMoldingCostInput, 'materialCostPerKg' | 'materialDensityKgM3' | 'materialSource' | 'materialType' | 'materialStockForm' | 'materialMatlState' | 'materialClamp' | 'realResinInputs'>;
  plasticReference: Pick<InjectionMoldingCostInput, 'plasticReference' | 'plasticReferenceMissing'>;
  location: string;
  currencySymbol: string;
  usdToLocal: number;
  batchSize: number;
  deburrRate: InjectionMoldingCostInput['deburrRate'];
  inspectionRate: InjectionMoldingCostInput['inspectionRate'];
  annualVolume: number | null;
  productionLifeYears: number;
  /** The scenario's cavity count, resolved by the caller (resolveScenarioCavityCount). */
  cavityCountOverride: number | null;
  /** The stored cycle-time calculators by name (calculators/plastic-molding-calculators.json), loaded from the database; the cycle time is computed by them. */
  calculators: InjectionMoldingCostInput['calculators'];
  /** The part's own calculator field values (calculator_field_overrides, migration 1011). */
  calculatorOverrides?: InjectionMoldingCostInput['calculatorOverrides'];
  /** The CAD face count (cadFaceCount below): decides the mold complexity. */
  cadFaceCount?: number | null;
}

/** The CAD face count of an analysed part (feature_graph.face_graph.face_attributes); null when the analysis holds none. */
export function cadFaceCount(featureGraph: unknown): number | null {
  const faces = (featureGraph as { face_graph?: { face_attributes?: unknown } } | null | undefined)?.face_graph?.face_attributes;
  return Array.isArray(faces) && faces.length > 0 ? faces.length : null;
}

export function buildMoldingCommonInput(f: MoldingCommonFacts): MoldingCommonInput {
  const bbox = partBboxLongestFirst(f.item);
  return {
    ...f.plasticReference,
    ...f.material,
    currencySymbol: f.currencySymbol,
    usdToLocal: f.usdToLocal,
    location: f.location,
    volume: f.item.volume ?? 0,
    surfaceArea: f.item.surfaceArea ?? 0,
    // The CAD nominal wall only: without it the cycle time is not derivable and the engine says so (no bounding-box stand-in).
    wallThicknessNominalMm: f.summary.wallThicknessNominalMm ?? 0,
    materialGrade: f.grade,
    batchSize: f.batchSize,
    family: f.family,
    deburrRate: f.deburrRate,
    inspectionRate: f.inspectionRate,
    cavityCountOverride: f.cavityCountOverride,
    calculators: f.calculators,
    calculatorOverrides: f.calculatorOverrides ?? null,
    cadFaceCount: f.cadFaceCount ?? null,
    // Tooling amortisation: both come from the canonical costing-input resolver, never re-read from the item.
    annualVolume: f.annualVolume ?? undefined,
    productionLifeYears: f.productionLifeYears,
    bboxMaxMm: bbox[0],
    bboxMidMm: bbox[1],
    bboxMinMm: bbox[2],
    signals: moldingSignals(f.summary, bbox),
  };
}
