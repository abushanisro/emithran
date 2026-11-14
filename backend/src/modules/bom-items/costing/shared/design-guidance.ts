// The Design Guidance of a part: what in its design drives its cost, read from what the engines already measured.
//
// A projection, like the Part Summary: nothing is priced and no limit is decided here. Every number is one of
//   - a measurement of the CAD analysis (feature_graph_v2 occurrences: tool axes, diameters, radii, walls),
//   - a limit of the staged reference data (the DFM rule tables, the wall tables, the setup-axis variables),
//   - a value of the applied cost (the cost table), or
//   - a row of the material library (price and density of the materials the process draws from).
// A value none of them holds is null, with its reason in `notModelled`: a panel never shows a guessed number.
//
// The panels are the ones a costing engineer reviews a design by: cost drivers, material, thickness, special mold
// tooling, machining, tolerances, machining setups, holes and fillets. A panel that does not apply to the part's
// process is null (a machined part has no mold tooling; a molded part with no machining has no setups).

import { partSetups, type SetupAxisRule } from '../machining/setup-axis-rule';

export type GuidanceSeverity = 'critical' | 'major' | 'minor';

/** Something to look at on the model: the feature instances and faces it points at (what the viewer highlights). */
export interface ReviewItem {
  label: string;
  detail: string | null;
  severity: GuidanceSeverity | null;
  occurrences: Array<{ featureId: string; occurrenceIndex: number }>;
  faces: number[];
}

/** A value and where it sits among the comparable materials (min and max of the same quantity over them). */
export interface RangedValue { value: number | null; min: number | null; max: number | null }

export type GuidanceGap =
  | 'costDrivers' | 'materialRange' | 'materialValue' | 'thicknessMeasured' | 'thicknessRecommendedMin' | 'thicknessRecommendedMax'
  | 'lifters' | 'cores' | 'routing' | 'machiningScrap' | 'machinedFeatures' | 'tolerances' | 'drivingMachining' | 'drivingFinishing'
  | 'setups' | 'nonStandardTools';

export interface DesignGuidance {
  family: string;
  processGroup: string | null;
  costDrivers: { count: number | null; items: ReviewItem[] };
  material: {
    name: string | null;
    /** The currency of the library prices compared (the factory location's price column). */
    currency: string;
    /** Price x density, per cm3: what a unit of the part's volume costs in this material. */
    costPerCm3: RangedValue;
    /** The part's volume in this material, and in the lightest and the heaviest comparable material. */
    massKg: RangedValue;
    /** How many library materials the range spans, and the material groups they are (the groups the process draws from). */
    comparedWith: number;
    comparedGroups: string[];
  };
  thickness: {
    recommendedMinMm: number | null;
    recommendedMaxMm: number | null;
    partMinMm: number | null;
    partMaxMm: number | null;
    maxMinRatio: number | null;
    /** The table the recommended limits were read from. */
    source: string | null;
    items: ReviewItem[];
  };
  /** Null on a process with no mold or die. */
  moldTooling: { slides: number | null; lifters: number | null; cores: number | null; items: ReviewItem[] } | null;
  /** Null when the part has no machining. */
  machining: { routing: string | null; scrapPct: number | null; machinedFeatures: number | null; items: ReviewItem[] } | null;
  tolerances: {
    withTolerances: number | null; drivingMachining: number | null; drivingFinishing: number | null;
    items: ReviewItem[]; machiningItems: ReviewItem[]; finishingItems: ReviewItem[];
  };
  /** Null when the part has no machined features. */
  setups: { count: number | null; perpendicular: number | null; oblique: number | null; fewFeatureSetups: number | null; fewFeatureLimit: number; items: ReviewItem[] } | null;
  /** Null when the part has no machined features. */
  holesAndFillets: {
    holeDiametersMm: number[]; filletRadiiMm: number[]; nonStandardTools: number | null;
    holeItems: ReviewItem[]; filletItems: ReviewItem[]; nonStandardItems: ReviewItem[];
  } | null;
  notModelled: Partial<Record<GuidanceGap, string>>;
}

/** A feature of the analysis (feature_graph_v2), as far as the guidance reads it. */
export interface GuidanceFeature {
  id: string;
  feature_type: string;
  variant?: string | null;
  diameter_mm?: number | null;
  occurrences?: Array<{
    face_ids?: number[]; tool_axis?: number[] | null; tool_axis_bidirectional?: boolean | null;
    radius_mm?: number | null; min_wall_mm?: number | null;
  }>;
  /** Set by the builder on a part that is not machined: which instances its primary process leaves to machining. Absent = all. */
  inScope?: boolean[];
}

export interface DesignGuidanceInput {
  family: string;
  processGroup: string | null;
  /** Machined features of the analysis; empty when the part has none. */
  features: readonly GuidanceFeature[];
  /** Whether the part's primary process is machining (its features are all machined, and its scrap is the chips). */
  machined: boolean;
  /** The DFM findings of the part's process; null when the process has no DFM engine or it could not run (why in findingsReason). */
  findings: ReviewItem[] | null;
  findingsReason: string | null;
  material: {
    name: string | null;
    currency: string;
    /** The part's material in the library: price per kg (the location's column) and density. Null when it is not one library row. */
    row: { pricePerKg: number | null; densityKgM3: number | null } | null;
    volumeMm3: number | null;
    comparables: ReadonlyArray<{ pricePerKg: number | null; densityKgM3: number | null }>;
    comparedGroups: string[];
  };
  thickness: {
    partMinMm: number | null; partMaxMm: number | null;
    recommendedMinMm: number | null; recommendedMaxMm: number | null;
    source: string | null;
    /** Why a limit is missing, by which limit. */
    reasons: Partial<Record<'measured' | 'min' | 'max', string>>;
    items: ReviewItem[];
  };
  moldTooling: { slides: number | null; lifters: number | null; cores: number | null; liftersReason?: string; coresReason?: string; items: ReviewItem[] } | null;
  /** The applied machining process rows, in order; null when no cost is applied. */
  routing: string[] | null;
  /** The applied material utilization (%); null when no cost is applied. */
  utilizationPct: number | null;
  /** On a part whose primary process is not machining: the features that need machining after it; null when that was not assessed (why in the reason). */
  secondaryMachining: { items: ReviewItem[]; finishingItems: ReviewItem[] } | null;
  secondaryMachiningReason: string | null;
  /** The features carrying a tolerance requirement; null when they could not be read. */
  toleranced: ReviewItem[] | null;
  setupRule: SetupAxisRule | null;
  /** The holes no standard drill makes (the machining DFM check); null when the check did not run. */
  nonStandardHoles: ReviewItem | null | 'none';
}

/**
 * A setup that reaches fewer features than this is worth a second look: the part is re-fixtured for little work. The
 * count is the review convention of the panel (the reference data sets no limit), so it is reported with the number
 * and is never a pass or a fail.
 */
export const FEW_FEATURE_SETUP_LIMIT = 5;

const HOLE_TYPES = new Set(['SimpleHole', 'MultiStepHole']);
const positive = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;
const distinct = (values: number[]) => [...new Set(values.map((v) => round(v, 2)))].sort((a, b) => a - b);

function ranged(value: number | null, others: number[], digits: number): RangedValue {
  const all = others.filter((v) => Number.isFinite(v) && v > 0);
  return {
    value: value != null ? round(value, digits) : null,
    min: all.length ? round(Math.min(...all), digits) : null,
    max: all.length ? round(Math.max(...all), digits) : null,
  };
}

const inScope = (f: GuidanceFeature, i: number) => f.inScope?.[i] !== false;
const occurrencesOf = (f: GuidanceFeature) => (f.occurrences ?? []).flatMap((_, occurrenceIndex) => (inScope(f, occurrenceIndex) ? [{ featureId: f.id, occurrenceIndex }] : []));
const facesOf = (f: GuidanceFeature) => (f.occurrences ?? []).flatMap((o, i) => (inScope(f, i) ? o.face_ids ?? [] : []));
const countOf = (f: GuidanceFeature) => occurrencesOf(f).length;

const axisLabel = (a: readonly number[]) => {
  const names = ['X', 'Y', 'Z'];
  const i = a.findIndex((c) => Math.abs(Math.abs(c) - 1) < 1e-3);
  return i >= 0 ? `${a[i]! > 0 ? '+' : '-'}${names[i]}` : `(${a.map((c) => round(c, 2)).join(', ')})`;
};

export function buildDesignGuidance(input: DesignGuidanceInput): DesignGuidance {
  const { material, thickness } = input;
  const notModelled: DesignGuidance['notModelled'] = {};
  // The features that are machined: all of a machined part's, and on any other part the instances its primary process leaves to machining. The setups, the
  // hole sizes and the fillets are read from these alone: a molded hole is not a drill, and a cast face needs no setup.
  const needed = new Set((input.secondaryMachining?.items ?? []).flatMap((i) => i.occurrences.map((o) => `${o.featureId}:${o.occurrenceIndex}`)));
  const features: GuidanceFeature[] = input.machined
    ? [...input.features]
    : input.features
        .map((f) => ({ ...f, occurrences: (f.occurrences ?? []).map((o, i) => (needed.has(`${f.id}:${i}`) ? o : null)) }))
        .filter((f) => f.occurrences.some((o) => o != null))
        .map((f) => ({ ...f, occurrences: f.occurrences.map((o) => o ?? {}), inScope: f.occurrences.map((o) => o != null) }));
  const hasFeatures = features.length > 0;

  // ── Cost drivers: the findings of the process's own DFM checks ─────────────────────────────────────────────────
  if (input.findings == null) notModelled.costDrivers = input.findingsReason ?? 'The part\'s process has no design check on file.';

  // ── Material: price x density per unit volume, and the mass, among the materials the process draws from ────────
  const perCm3 = (r: { pricePerKg: number | null; densityKgM3: number | null }) =>
    positive(r.pricePerKg) != null && positive(r.densityKgM3) != null ? (r.pricePerKg! * r.densityKgM3!) / 1e6 : null;
  const volumeMm3 = positive(material.volumeMm3);
  const massOf = (densityKgM3: number | null) => (volumeMm3 != null && positive(densityKgM3) != null ? (volumeMm3 * densityKgM3!) / 1e9 : null);
  const costs = material.comparables.flatMap((r) => { const c = perCm3(r); return c != null ? [c] : []; });
  const masses = material.comparables.flatMap((r) => { const m = massOf(r.densityKgM3); return m != null ? [m] : []; });
  if (material.comparables.length === 0) notModelled.materialRange = `No library material is linked to ${input.processGroup ?? 'the part\'s process'}: there is nothing to compare with.`;
  if (!material.row) notModelled.materialValue = material.name ? `"${material.name}" is not one row of the material library: its price and density are not read.` : 'The part has no material.';

  // ── Thickness ──────────────────────────────────────────────────────────────────────────────────────────────────
  const partMin = positive(thickness.partMinMm);
  const partMax = positive(thickness.partMaxMm);
  if (partMin == null || partMax == null) notModelled.thicknessMeasured = thickness.reasons.measured ?? 'The analysis did not measure the wall thickness.';
  if (thickness.recommendedMinMm == null) notModelled.thicknessRecommendedMin = thickness.reasons.min ?? 'No minimum wall is staged for this process and material.';
  if (thickness.recommendedMaxMm == null) notModelled.thicknessRecommendedMax = thickness.reasons.max ?? 'No maximum wall is staged for this process and material.';

  // ── Special mold tooling ───────────────────────────────────────────────────────────────────────────────────────
  if (input.moldTooling) {
    if (input.moldTooling.lifters == null) notModelled.lifters = input.moldTooling.liftersReason ?? 'Lifters are not counted for this process.';
    if (input.moldTooling.cores == null) notModelled.cores = input.moldTooling.coresReason ?? 'Cores are not counted for this process.';
  }

  // ── Machining ──────────────────────────────────────────────────────────────────────────────────────────────────
  const anyMachining = input.machined || (input.secondaryMachining?.items.length ?? 0) > 0;
  let machining: DesignGuidance['machining'] = null;
  if (anyMachining) {
    const machinedItems: ReviewItem[] = input.machined
      ? features.map((f) => ({
          label: `${f.feature_type}${f.variant && f.variant !== 'default' ? ` (${f.variant})` : ''} × ${countOf(f)}`,
          detail: null, severity: null, occurrences: occurrencesOf(f), faces: facesOf(f),
        }))
      : input.secondaryMachining?.items ?? [];
    const machinedFeatures = input.machined
      ? features.reduce((n, f) => n + countOf(f), 0)
      : input.secondaryMachining ? input.secondaryMachining.items.length : null;
    if (machinedFeatures == null) notModelled.machinedFeatures = input.secondaryMachiningReason ?? 'Which features need machining after the primary process was not assessed.';
    if (input.routing == null) notModelled.routing = 'No cost is applied: apply the scenario to record the routing.';
    else if (input.routing.length === 0) notModelled.routing = 'The applied cost has no machining operation.';
    const scrapPct = input.machined && input.utilizationPct != null ? round(100 - input.utilizationPct, 1) : null;
    if (scrapPct == null) {
      notModelled.machiningScrap = input.machined
        ? 'No cost is applied: the stock, and so the share of it cut away, is recorded when the scenario is applied.'
        : 'The material cut away by machining after the primary process is not recorded as a share of the part.';
    }
    machining = { routing: input.routing && input.routing.length > 0 ? input.routing.join(' → ') : null, scrapPct, machinedFeatures, items: machinedItems };
  }

  // ── Tolerances ─────────────────────────────────────────────────────────────────────────────────────────────────
  if (input.toleranced == null) notModelled.tolerances = 'The tolerance requirements of the features could not be read.';
  if (input.secondaryMachining == null) {
    const why = input.machined
      ? 'Every feature of a machined part is machined: a tolerance changes how it is finished, which the Validation checks under these panels report, not whether it is machined.'
      : input.secondaryMachiningReason ?? 'Which tolerances the primary process cannot hold was not assessed.';
    notModelled.drivingMachining = why;
    notModelled.drivingFinishing = input.machined ? 'Which tolerances need grinding or honing beyond the cutting operations is not modelled for machined parts.' : why;
  }

  // ── Machining setups: the directions the features are reached from, with the features in each ──────────────────
  let setups: DesignGuidance['setups'] = null;
  if (hasFeatures) {
    if (!input.setupRule) {
      notModelled.setups = 'The setup-axis variables of the machining reference are not staged.';
      setups = { count: null, perpendicular: null, oblique: null, fewFeatureSetups: null, fewFeatureLimit: FEW_FEATURE_SETUP_LIMIT, items: [] };
    } else {
      const list = partSetups(features, input.setupRule);
      if (list.length === 0) {
        notModelled.setups = 'The analysis carries no tool axis for the features, so the setups are not derived.';
        setups = { count: null, perpendicular: null, oblique: null, fewFeatureSetups: null, fewFeatureLimit: FEW_FEATURE_SETUP_LIMIT, items: [] };
      } else {
        const byId = new Map(features.map((f) => [f.id, f]));
        const items = list.map((s, i): ReviewItem => {
          const members = s.members.flatMap((m) => (m.featureId ? [{ featureId: m.featureId, occurrenceIndex: m.occurrenceIndex }] : []));
          return {
            label: `Setup ${i + 1}: ${axisLabel(s.axis)} · ${s.members.length} feature${s.members.length === 1 ? '' : 's'}`,
            detail: s.principal ? 'Perpendicular setup' : 'Oblique setup: not square to the part\'s main directions',
            severity: s.principal ? null : 'major',
            occurrences: members,
            faces: members.flatMap((m) => byId.get(m.featureId)?.occurrences?.[m.occurrenceIndex]?.face_ids ?? []),
          };
        });
        const perpendicular = list.filter((s) => s.principal).length;
        setups = {
          count: list.length, perpendicular, oblique: list.length - perpendicular,
          fewFeatureSetups: list.filter((s) => s.members.length < FEW_FEATURE_SETUP_LIMIT).length,
          fewFeatureLimit: FEW_FEATURE_SETUP_LIMIT, items,
        };
      }
    }
  }

  // ── Holes and fillets: each distinct size is a tool to stock and a tool change ─────────────────────────────────
  let holesAndFillets: DesignGuidance['holesAndFillets'] = null;
  if (hasFeatures) {
    const holes = features.filter((f) => HOLE_TYPES.has(f.feature_type) && positive(f.diameter_mm) != null);
    const holeDiametersMm = distinct(holes.map((f) => f.diameter_mm!));
    const holeItems = holeDiametersMm.map((d): ReviewItem => {
      const group = holes.filter((f) => round(f.diameter_mm!, 2) === d);
      const n = group.reduce((s, f) => s + countOf(f), 0);
      return { label: `Ø${d} mm × ${n}`, detail: null, severity: null, occurrences: group.flatMap(occurrencesOf), faces: group.flatMap(facesOf) };
    });
    const rounds = features.filter((f) => f.feature_type === 'Edge' && f.variant === 'round')
      .flatMap((f) => (f.occurrences ?? []).flatMap((o, occurrenceIndex) => (inScope(f, occurrenceIndex) && positive(o.radius_mm) != null ? [{ r: round(o.radius_mm!, 2), ref: { featureId: f.id, occurrenceIndex }, faces: o.face_ids ?? [] }] : [])));
    const filletRadiiMm = distinct(rounds.map((x) => x.r));
    const filletItems = filletRadiiMm.map((r): ReviewItem => {
      const group = rounds.filter((x) => x.r === r);
      return { label: `R${r} mm × ${group.length}`, detail: null, severity: null, occurrences: group.map((x) => x.ref), faces: group.flatMap((x) => x.faces) };
    });
    let nonStandardTools: number | null = null;
    let nonStandardItems: ReviewItem[] = [];
    if (input.nonStandardHoles == null) notModelled.nonStandardTools = 'The standard drill chart check did not run on this part.';
    else if (input.nonStandardHoles === 'none') nonStandardTools = 0;
    else {
      const ids = new Set(input.nonStandardHoles.occurrences.map((o) => o.featureId));
      nonStandardTools = distinct(holes.filter((f) => ids.has(f.id)).map((f) => f.diameter_mm!)).length;
      nonStandardItems = [input.nonStandardHoles];
    }
    holesAndFillets = { holeDiametersMm, filletRadiiMm, nonStandardTools, holeItems, filletItems, nonStandardItems };
  }

  const ownCost = material.row ? perCm3(material.row) : null;
  const ownMass = material.row ? massOf(material.row.densityKgM3) : null;
  return {
    family: input.family,
    processGroup: input.processGroup,
    costDrivers: { count: input.findings ? input.findings.length : null, items: input.findings ?? [] },
    material: {
      name: material.name, currency: material.currency,
      costPerCm3: ranged(ownCost, costs, 4),
      massKg: ranged(ownMass, masses, 4),
      comparedWith: material.comparables.length, comparedGroups: material.comparedGroups,
    },
    thickness: {
      recommendedMinMm: thickness.recommendedMinMm, recommendedMaxMm: thickness.recommendedMaxMm,
      partMinMm: partMin != null ? round(partMin, 3) : null, partMaxMm: partMax != null ? round(partMax, 3) : null,
      maxMinRatio: partMin != null && partMax != null ? round(partMax / partMin, 3) : null,
      source: thickness.source, items: thickness.items,
    },
    moldTooling: input.moldTooling
      ? { slides: input.moldTooling.slides, lifters: input.moldTooling.lifters, cores: input.moldTooling.cores, items: input.moldTooling.items }
      : null,
    machining,
    tolerances: {
      withTolerances: input.toleranced ? input.toleranced.length : null,
      drivingMachining: input.secondaryMachining ? input.secondaryMachining.items.length : null,
      drivingFinishing: input.secondaryMachining ? input.secondaryMachining.finishingItems.length : null,
      items: input.toleranced ?? [], machiningItems: input.secondaryMachining?.items ?? [], finishingItems: input.secondaryMachining?.finishingItems ?? [],
    },
    setups,
    holesAndFillets,
    notModelled,
  };
}
