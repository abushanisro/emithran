// The cost drivers of a molded part, read from the CAD analysis: every quantity the molding cost model or its routing reads about the part's geometry, plus the
// features the model knows are required but does not price yet. Each says what the cost model does with it, so the Cost Drivers panel is a statement of the model,
// not a list of numbers. Pure: facts in, drivers out. A driver the analysis did not measure is left out (never shown as 0).
import { type MoldingSummary, moldingSignals, partBboxLongestFirst } from './molding-input';
import { sideActionSignals } from './side-action-signals';

/** What the cost model does with a driver. */
export type CostDriverUse =
  | 'priced'      // changes a priced line (material, cycle time, press, mold)
  | 'not_priced'  // the operation it needs is required but not priced yet (the cost view names it)
  | 'dfm';        // recorded or shown as a finding; no price reads it

export interface PlasticCostDriver {
  name: string;
  unit: string;
  value: number;
  quantity: number;
  group: 'Material and shot' | 'Cycle time' | 'Press and mold' | 'Side actions and inserts' | 'Holes and features' | 'Draft and parting';
  use: CostDriverUse;
  /** One line: what the cost model does with it. */
  feeds: string;
  /** The CAD measurement key whose faces show where it was measured (cad-evidence), when the analysis records them. */
  evidence?: string;
}

export interface PlasticCostDriverFacts {
  volumeMm3: number | null | undefined;
  surfaceAreaMm2: number | null | undefined;
  boundingBox: { length?: number | null; width?: number | null; height?: number | null } | null | undefined;
  summary: MoldingSummary & {
    holeCount?: number | null;
    holeDiameters?: number[] | null;
    filletCount?: number | null;
    wallThicknessStdDevMm?: number | null;
    thinWallViolationCount?: number | null;
    thickWallViolationCount?: number | null;
    throughHoleCount?: number | null;
    undraftedFaceCount?: number | null;
    draftedFaceCount?: number | null;
    avgDraftAngleDeg?: number | null;
  };
}

const positive = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;

export function plasticCostDrivers(f: PlasticCostDriverFacts): PlasticCostDriver[] {
  const out: PlasticCostDriver[] = [];
  const add = (d: Omit<PlasticCostDriver, 'quantity'>) => out.push({ ...d, quantity: d.value });
  const s = f.summary;
  const bbox = partBboxLongestFirst({ maxLength: f.boundingBox?.length, maxWidth: f.boundingBox?.width, maxHeight: f.boundingBox?.height });
  const signals = moldingSignals(s, bbox);
  const side = sideActionSignals(s.plasticFeatureGraph);

  if (positive(f.volumeMm3)) add({ name: 'Part volume', unit: 'mm³', value: f.volumeMm3, group: 'Material and shot', use: 'priced', feeds: 'Part weight and material cost; shot volume and fill time', evidence: 'part_volume' });
  if (positive(f.surfaceAreaMm2)) add({ name: 'Surface area', unit: 'mm²', value: f.surfaceAreaMm2, group: 'Material and shot', use: 'priced', feeds: 'Visual inspection (memory/Secondary process visualInspectTimeStandard per m²) and the mold cavity machining and polish; finishing hours (finishingHrsPerSqMeter) and gate trimming are not priced yet' });

  if (positive(s.wallThicknessNominalMm)) add({ name: 'Nominal wall thickness', unit: 'mm', value: s.wallThicknessNominalMm, group: 'Cycle time', use: 'priced', feeds: 'Cooling and pack time of the cycle-time calculator', evidence: 'wall_thickness' });
  if (positive(s.wallThicknessMinMm)) add({ name: 'Thinnest wall', unit: 'mm', value: s.wallThicknessMinMm, group: 'Cycle time', use: 'dfm', feeds: 'Recorded with the route; not a cycle-time input' });
  if (positive(s.wallThicknessMaxMm)) add({ name: 'Thickest wall', unit: 'mm', value: s.wallThicknessMaxMm, group: 'Cycle time', use: 'dfm', feeds: 'Recorded with the route; not a cycle-time input' });
  if (positive(f.summary.wallThicknessStdDevMm)) add({ name: 'Wall thickness spread (std dev)', unit: 'mm', value: f.summary.wallThicknessStdDevMm, group: 'Cycle time', use: 'dfm', feeds: 'Manufacturability finding; the cost model does not read it' });

  if (signals.projectedAreaMm2 != null) add({ name: 'Footprint (two longest sides)', unit: 'mm²', value: signals.projectedAreaMm2, group: 'Press and mold', use: 'priced', feeds: 'Clamp force, press size and mold base area; it is the bounding-box footprint, not the true projected area' });

  if (side) {
    add({ name: 'Undercut features', unit: 'pcs', value: side.undercutFeatures, group: 'Side actions and inserts', use: 'priced', feeds: 'Mold class (more than 2 raises it); slide and lifter hardware is required but not priced yet' });
    if (side.slideBundles > 0) add({ name: 'Slide bundles', unit: 'pcs', value: side.slideBundles, group: 'Side actions and inserts', use: 'priced', feeds: 'The slide movement in each shot (slideCycleRate, F-32) and the slide blocks in the mold tooling (F-28)' });
    if (side.slideOrLifterBundles > 0) add({ name: 'Slide-or-lifter bundles', unit: 'pcs', value: side.slideOrLifterBundles, group: 'Side actions and inserts', use: 'priced', feeds: 'Costed as lifters: their blocks in the mold tooling (F-28); a lifter rides on the ejection and adds no cycle time' });
  } else if (signals.undercutCount != null) {
    add({ name: 'Undercut faces', unit: 'pcs', value: signals.undercutCount, group: 'Side actions and inserts', use: 'priced', feeds: 'Mold class; side-action hardware is not priced yet' });
  }
  if (positive(signals.insertCount)) add({ name: 'Insert candidates', unit: 'pcs', value: signals.insertCount, group: 'Side actions and inserts', use: 'not_priced', feeds: 'Insert loading and installation are required but not priced yet' });

  if (positive(s.holeCount)) add({ name: 'Holes', unit: 'pcs', value: s.holeCount, group: 'Holes and features', use: 'dfm', feeds: 'The cost model does not read hole counts yet' });
  const sizes = new Set((s.holeDiameters ?? []).filter(positive).map((d) => d.toFixed(2)));
  if (sizes.size > 0) add({ name: 'Distinct hole sizes', unit: 'sizes', value: sizes.size, group: 'Holes and features', use: 'dfm', feeds: 'The cost model does not read hole sizes yet' });
  if (positive(signals.ribCount)) add({ name: 'Ribs', unit: 'pcs', value: signals.ribCount, group: 'Holes and features', use: 'dfm', feeds: 'Recorded with the route; not a priced input' });
  if (positive(signals.bossCount)) add({ name: 'Bosses (blind features)', unit: 'pcs', value: signals.bossCount, group: 'Holes and features', use: 'dfm', feeds: 'Recorded with the route; not a priced input' });
  if (positive(s.filletCount)) add({ name: 'Fillets', unit: 'pcs', value: s.filletCount, group: 'Holes and features', use: 'dfm', feeds: 'Manufacturability finding; the cost model does not read it' });

  if (signals.partingComplexity != null) add({ name: 'Parting complexity', unit: '0-1', value: signals.partingComplexity, group: 'Draft and parting', use: 'priced', feeds: 'Mold class (above 0.6 raises it) and the deflashing decision' });
  if (positive(s.undraftedFaceCount)) add({ name: 'Undrafted faces', unit: 'pcs', value: s.undraftedFaceCount, group: 'Draft and parting', use: 'dfm', feeds: 'Manufacturability finding; the cost model does not read it' });
  if (typeof s.avgDraftAngleDeg === 'number' && Number.isFinite(s.avgDraftAngleDeg)) add({ name: 'Average draft angle', unit: '°', value: s.avgDraftAngleDeg, group: 'Draft and parting', use: 'dfm', feeds: 'Manufacturability finding; the cost model does not read it' });
  return out;
}
