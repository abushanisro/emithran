// Formula registry (plastic-molding/formula-registry.ts): F-31 (rib inserts and their EDM). Change a rule here -> bump its version there.
// A rib too tall to machine into the mold plate (taller than machinedRibThreshold) is made as an insert, burnt by EDM. Which insert size class a rib
// needs is not on file: the approved rule is its footprint (length x thickness) against the class insert areas (small/medium/largeInsertArea),
// the smallest that holds it. A rib the CAD engine did not measure, or one no class holds, is a gap, never a guessed class.
import type { PlasticFeatureGraph } from '../operation/plastic-catalog-operations.service';

export type InsertClass = 'small' | 'medium' | 'large';
const CLASSES: readonly InsertClass[] = ['small', 'medium', 'large'];
const MM2_PER_IN2 = 645.16;

export interface MeasuredRib { heightMm: number; lengthMm: number; thicknessMm: number }
/** The ribs of the CAD feature graph: those measured along the pull, and how many it found but did not measure. */
export interface RibSignals { measured: MeasuredRib[]; unmeasured: number }

/** What memory/Plastic Modeling says a rib insert takes (plastic-reference.ts). */
export interface RibInsertReference {
  /** variables machinedRibThreshold (mm). */
  thresholdMm: number;
  /** variables {small,medium,large}InsertArea (in2), {small,medium,large}CalcRibInsertElectrodeSize (in3), num{Small,Medium,Large}InsertsBurns, cmDesignHrsRibInsert*. */
  areaIn2: Record<InsertClass, number>;
  electrodeIn3: Record<InsertClass, number>;
  burns: Record<InsertClass, number>;
  designHours: Record<InsertClass, number>;
  /** variables cutterPathHrsPerInsert, spottingHrsPerInsert; cmToolAssemblyTimes Rib Insert. */
  cutterPathHours: number;
  spottingHours: number;
  assemblyHours: number;
  /** variables edmElectrodeVolumeBurn: the share of an electrode's volume burnt. */
  electrodeBurnFraction: number;
  /** digital_factory_settings_usa edmMaterialCostCarbonUsdPerIn3: graphite, the approved electrode material. */
  electrodeUsdPerIn3: number;
  /** cmToolMachiningRates EDM Electrode Burn and Insert Pocket Machining (mm3/min); cmToolMachiningSetups Insert Pocket (setups x hours). */
  burnRateMm3PerMin: number;
  pocketRateMm3PerMin: number;
  pocketSetupHours: number;
}

/** Null when the graph has no plastic features to read. */
export function ribSignals(graph: PlasticFeatureGraph | null | undefined): RibSignals | null {
  if (!graph || graph.schema !== 'plastic_feature_graph_v1' || !Array.isArray(graph.items)) return null;
  const measured: MeasuredRib[] = [];
  let unmeasured = 0;
  for (const f of graph.items) {
    if (f.feature_type !== 'Rib') continue;
    const ribs = (f.attributes?.ribs ?? []).filter((r) => r.height_mm > 0 && r.length_mm > 0 && r.thickness_mm > 0);
    measured.push(...ribs.map((r) => ({ heightMm: r.height_mm, lengthMm: r.length_mm, thicknessMm: r.thickness_mm })));
    unmeasured += Math.max(0, (f.attributes?.count ?? 0) - ribs.length);
  }
  return { measured, unmeasured };
}

export interface RibInsertPlan {
  counts: Record<InsertClass, number>;
  /** Tall ribs whose footprint no insert class holds. */
  oversize: number;
  unmeasured: number;
  /** Every rib measured and every tall one classed: the inserts are the whole of it. */
  priced: boolean;
}

export function planRibInserts(ribs: RibSignals | null, ref: RibInsertReference): RibInsertPlan {
  const counts: Record<InsertClass, number> = { small: 0, medium: 0, large: 0 };
  let oversize = 0;
  for (const r of ribs?.measured ?? []) {
    if (!(r.heightMm > ref.thresholdMm)) continue;
    const footprintIn2 = (r.lengthMm * r.thicknessMm) / MM2_PER_IN2;
    const cls = CLASSES.find((c) => footprintIn2 <= ref.areaIn2[c]);
    if (cls) counts[cls] += 1;
    else oversize += 1;
  }
  const unmeasured = ribs?.unmeasured ?? 0;
  return { counts, oversize, unmeasured, priced: ribs != null && unmeasured === 0 && oversize === 0 };
}

/** The calculator's rib insert quantities: summed over the inserts, with the per-class breakdown for the source. */
export function ribInsertQuantities(plan: RibInsertPlan, ref: RibInsertReference) {
  const sum = (per: (c: InsertClass) => number) => CLASSES.reduce((t, c) => t + plan.counts[c] * per(c), 0);
  const breakdown = CLASSES.filter((c) => plan.counts[c] > 0).map((c) => `${plan.counts[c]} ${c}`).join(' + ') || 'none';
  return {
    inserts: sum(() => 1),
    areaIn2: sum((c) => ref.areaIn2[c]),
    electrodeIn3: sum((c) => ref.electrodeIn3[c] * ref.burns[c]),
    burnedIn3: sum((c) => ref.electrodeIn3[c] * ref.burns[c] * ref.electrodeBurnFraction),
    designHours: sum((c) => ref.designHours[c]),
    breakdown,
  };
}
