/**
 * Operation Sequencer — Feature → Ordered OperationLine[]
 *
 * Converts feature_graph_v2 features (from CAD engine) into a flat, ordered
 * list of CNC operations with per-feature cycle times. This is the core of
 * Fix 3 + Fix 4: feature-based time instead of (billetVol − partVol) / MRR.
 *
 * All times are in SECONDS. The caller converts to minutes for cost calculation.
 *
 * Design rules:
 * - No DB calls. Pure function — deterministic, testable, zero latency.
 * - MRR values are imported from cost-machining-engine.ts via the MaterialClass type.
 * - TAP_CYCLE_SEC is imported from default-rates.ts.
 * - When feature_graph_v2 is absent or empty, the caller falls back to the old
 *   (billetVol − partVol) / MRR formula — no regression for legacy data.
 *
 * ── Sheet-metal feature-driven routing backlog (see migration 381) ─────────
 * Sheet metal's Counterboring/Countersinking/PEM Insertion/Reaming/CMM Inspection/
 * Hole Extrusion (Burring) are now feature-driven (cost-engine.ts::computeCostSummary,
 * gated on the CAD feature summary counts). Hole extrusion (burled/
 * extruded hole flanges, e.g. drawing callout "2X M3 BURLING BACK CONVEX") was
 * added via a real coaxial-hole-cluster detector in feature_extractors.py
 * (geo_v40+, extruded_flange_count) — previously listed below as undetectable
 * via surface-deviation analysis; the coaxial-cluster approach found it instead.
 * The following requested process types are still deliberately NOT implemented —
 * as of 2026-07-30 the CAD engine (cad-engine/feature_extractors.py) has no
 * detector for them, and inventing a flag that always reads "not present" would
 * be indistinguishable from a real detector silently failing. Each needs real
 * detection work before it can be routed honestly:
 *
 *   Weld seams / spot welds / MIG-TIG-Laser weld — needs a weld-symbol/seam
 *     detector (drawing callout OCR extension to drawing_analyzer.py, or a
 *     seam-geometry detector in feature_extractors.py for multi-body assemblies).
 *   Rivets / clinch features — needs a fastener-pattern detector (hole diameter
 *     + spacing pattern matching, similar approach to sm_lookup_pem_hardware).
 *   Roll forming / hems / return flanges / jog bends — needs bend-topology
 *     classifiers beyond the current radius/angle bend detector (BendFeature
 *     in feature_extractors.py only reports count + radius today).
 *   Louvers / embosses / dimples / beads / coining — needs non-planar
 *     surface-deviation detectors on the dominant flat face (none of these
 *     show up as simple cylindrical/planar/conical faces).
 *   Tabs & slots as assembly features, GD&T-driven CMM beyond the tight-
 *     tolerance case, assembly/packaging triggers — need multi-part assembly
 *     context this per-part extractor doesn't have.
 *
 * Extension recipe for any of the above (same pattern used for counterbore/
 * countersink/PEM):
 *   1. Detect the feature in feature_extractors.py (or add an OCR extractor to
 *      drawing_analyzer.py for callout-based features like welds/threads).
 *   2. Emit it into manufacturing_intelligence.features (or drawing_intelligence).
 *   3. Carry it through auto-fill.service.ts's RawGeometry and feature summary,
 *      following the counterboreGroups/countersinkGroups precedent.
 *   4. Add a gated block in cost-engine.ts::computeCostSummary + a
 *      process_calculator_mappings row (+ sm_lookup_* cycle-time table if the
 *      op needs one) for the new operation.
 *
 * Packaging & Logistics already has its own manual/auto-on-material-set UI
 * section (unrelated to this routing engine) — not part of this backlog.
 */

import { computeDrillCycle, computeTapCycle, computeRotaryCycleSec, DRILL_DEPTH_TO_DIAMETER_RATIO, detectMaterialClass } from '../process/cost-machining-engine';
import type { DrillingTable } from '../lookup/drilling-table';
import { runMachiningCalculator, type CalcSeed, type MachiningCalculators } from '../calculators/machining-calculator';
import type { CalculationTraceStep } from '../../../dto/cost-breakdown.dto';
import type { MaterialClass } from '../process/cost-machining-engine';
import { nearestByDiameterThenHardness, MACHINING_MATERIAL } from '../lookup/machining-material-hardness';

// drillOp/tapOp below call the same calculators cost-machining-engine.ts uses
// (computeDrillCycle / computeTapCycle)
// instead of keeping their own separate hardcoded tables — this file used
// to carry THREE independent drilling-time models across the two files
// (this one's diameter-only drillFeedMmPerMin, cost-machining-engine.ts's flat
// DRILL_CYCLE_SEC buckets, and a duplicated MRR_MM3_PER_MIN admitted by its
// own comment to need manual sync with cost-machining-engine.ts's MILLING_MRR).
// One source of truth now for all three.

// Real drilling time for `count` holes (CAD Ø + CAD depth + tblDrilling), or
// the name of the missing real input — see computeDrillCycle.
function drillOp(
  diamMm: number,
  depthMm: number,
  count: number,
  materialGrade: string | null | undefined,
  drillingTable: DrillingTable | null,
  calculators: MachiningCalculators | null,
): { timeSec: number; missing?: string } {
  const cycle = computeDrillCycle(diamMm, materialGrade, depthMm > 0 ? depthMm : undefined, drillingTable, calculators, count);
  return cycle.sec == null ? { timeSec: 0, missing: cycle.missing.join('; ') } : { timeSec: cycle.sec };
}

// Real tapping time for `count` threads (thread size, pitch, CAD depth +
// tblTapping), or the name of the missing real input — see computeTapCycle.
function tapOp(
  spec: string | null | undefined,
  count: number,
  matClass: MaterialClass,
  pitchMm: number | undefined,
  depthMm: number | undefined,
  tappingTable: any[] | null,
  calculators: MachiningCalculators | null,
): { timeSec: number; missing?: string } {
  if (!spec) return { timeSec: 0, missing: 'a thread size' };
  const cycle = computeTapCycle({ size: spec, count, pitchMm, depthMm: depthMm && depthMm > 0 ? depthMm : undefined }, matClass, tappingTable, calculators);
  return cycle.sec == null ? { timeSec: 0, missing: cycle.missing.join('; ') } : { timeSec: cycle.sec };
}

// Real, material- and diameter-aware counterbore cycle time — replaces the
// previous flat "count * 8 sec" constant (no citation, no diameter or
// material sensitivity at all). counterboreTable is the real tblCounterboring
// data (364 rows, real cutting_speed_m_min/feed_mm_rev/depth_max_mm per
// diameter+hardness), fetched once by the async caller (bom-items.service.ts,
// via MachiningLookupService.getCounterboreTable — this file makes no DB
// calls itself, per its own design rule) and matched here per real
// occurrence diameter. Falls back to the previous flat constant, disclosed
// as a fallback rather than silently identical-looking output, only when
// the table genuinely isn't available (e.g. the DB fetch failed) or has no
// row for this diameter/material at all.
function counterboreTimeSec(
  diamMm: number,
  depthMm: number,
  count: number,
  matClass: MaterialClass,
  counterboreTable: any[] | null | undefined,
): number {
  if (counterboreTable && counterboreTable.length > 0) {
    const targetHb = MACHINING_MATERIAL[matClass];
    const row = nearestByDiameterThenHardness(counterboreTable, diamMm, targetHb);
    if (row && typeof row.cutting_speed_m_min === 'number' && typeof row.feed_mm_rev === 'number') {
      const depth = depthMm > 0 ? depthMm : diamMm * DRILL_DEPTH_TO_DIAMETER_RATIO;
      return computeRotaryCycleSec(diamMm, row.cutting_speed_m_min, row.feed_mm_rev, depth) * count;
    }
  }
  return count * 8; // disclosed fallback — real table unavailable for this request
}

// Every milling operation below is timed by its stored calculator (machining-calculators.json, "Machining - Facing",
// "- Rough Milling", "- Fine Finish Milling", ...): this file states which operation a feature needs and hands the
// calculator the feature's CAD measurements; it holds no time, rate or factor of its own.

/** The finishing cutter of a material class (tblMillingFinishing): the end mill used where a feature forces no smaller one, and how it runs. */
export interface MillingFinishingRow {
  toolDiameterMm: number;
  teeth: number;
  cuttingSpeedMPerMin: number;
  /** Feed per tooth over the tool diameter: the chip load scales with the cutter. */
  feedPerToothPerDiameter: number;
}

interface PocketFinishGroup { toolMm: number; floorMm2: number; wallMm2: number; pockets: number }

/**
 * The finishing passes of a group of pockets, one entry per cutter. A pocket's floor is its CAD length x width and its
 * depth the removed volume over that floor. The cutter is the standard finishing end mill, or the pocket's width when
 * that is narrower; a cutter as wide as the pocket leaves both walls finished, so walls (perimeter x depth) are a
 * separate pass only in a pocket wider than the cutter. null = a pocket has no CAD size.
 */
function pocketFinishGroups(occurrences: any[], standardToolMm: number): PocketFinishGroup[] | null {
  const groups = new Map<number, PocketFinishGroup>();
  for (const o of occurrences) {
    const [lengthMm, widthMm] = (Array.isArray(o.extents_mm) ? o.extents_mm.map(Number) : []).sort((a: number, b: number) => b - a);
    if (!(lengthMm > 0 && widthMm > 0)) return null;
    const toolMm = Math.max(0.1, Math.min(standardToolMm, Math.floor(widthMm * 10) / 10));
    const floorMm2 = lengthMm * widthMm;
    const depthMm = (o.material_removed_mm3 ?? 0) / floorMm2;
    const g = groups.get(toolMm) ?? { toolMm, floorMm2: 0, wallMm2: 0, pockets: 0 };
    g.floorMm2 += floorMm2;
    if (widthMm > standardToolMm) g.wallMm2 += 2 * (lengthMm + widthMm) * depthMm;
    g.pockets += 1;
    groups.set(toolMm, g);
  }
  return [...groups.values()].sort((a, b) => b.toolMm - a.toolMm);
}

/** One operation timed by its calculator: the time and its steps, or the missing inputs named (time 0). */
function calcOp(
  calculators: MachiningCalculators | null,
  operation: string,
  seeds: Record<string, CalcSeed>,
): Pick<OperationLine, 'timeSec' | 'missing' | 'trace'> {
  const run = runMachiningCalculator(calculators, operation, seeds);
  return { timeSec: run.sec ?? 0, trace: run.trace, ...(run.missing.length > 0 ? { missing: run.missing.join('; ') } : {}) };
}

export interface OperationLine {
  name: string;
  timeSec: number;
  source: "feature" | "fixed";
  // Reference CAD feature_type ('SimpleHole'/'MultiStepHole'/'Edge'/
  // 'PocketV2'/'Slot'/...) and diameter this specific op line was generated from, when it came from one feature_graph_v2
  // occurrence group. Carried through so the frontend can trace an operation
  // back to the exact CAD feature for 3D-viewer highlighting (same purpose
  // Sheet Metal's FeatureBreakdown already serves for bends/holes) — a
  // "fixed" op (Face Mill, Deburr) has neither, since it isn't tied to one
  // detected feature.
  cadFeatureType?: string;
  diameterMm?: number;
  // Real number of CAD instances this line covers (holes for a PCD pattern,
  // occurrences otherwise) — carried so the UI never infers a count from time.
  count?: number;
  // feature_graph_v2 ids of the detected feature(s) this op machines, so the
  // UI highlights exactly those occurrences instead of every feature of a type.
  featureIds?: string[];
  // Present when this op could not be priced from real inputs (timeSec is 0
  // for it): names the missing CAD measurement or lookup row. Never replaced
  // by an estimated time.
  missing?: string;
  /** The calculator steps the time came from. */
  trace?: CalculationTraceStep[];
}

// Canonical manufacturing order for sorting. Names are the real
// operation_category strings from memory/machining/operations_full__operations.csv
// (validated at runtime against the live process_taxonomy_operations table
// via resolveOperationName — see buildMachiningFeatureBreakdown in
// bom-items.service.ts), not this file's own former invented vocabulary
// ("Pocket Rough"/"Spot Drill"/"Rigid Tap"/"Corner Round"/... — renamed
// below). Several former distinct names collapse onto the SAME real name
// here (e.g. former "Pocket Rough"/"Slot Rough" both real "Rough Milling";
// former "Contour Mill"/"Profile Mill" both real "Contouring") because the
// real catalog uses one operation name across multiple FeatureTypes —
// that's a real fact about the taxonomy, not a naming collision to avoid.
const OP_ORDER: string[] = [
  "Facing",
  "Bulk Milling",
  "Fine Finish Milling",
  "Contouring",
  "Perimeter Milling",
  "Rough Milling",
  "Slot Milling",
  "Center Drilling",
  "Drilling",
  "Ream",
  "Counterboring",
  "Countersinking",
  "Chamfering",
  "Filleting",
  "Groove Milling",
  "Tapping",
  "Deburr",
];

function opOrderIndex(name: string): number {
  const idx = OP_ORDER.findIndex((o) => name.startsWith(o));
  return idx >= 0 ? idx : OP_ORDER.length;
}

/**
 * Build an ordered operation sequence from feature_graph_v2 features.
 *
 * @param fgv2Features  feature_graph_v2.features array from CAD engine response
 * @param matClass      resolved MaterialClass for MRR lookup
 * @param machinabilityFactor  (machinabilityRating / 75); 1.0 = mild steel baseline
 * @param materialGrade  raw material grade string (e.g. "SS304") for the real
 *   material-family-aware tap/drill physics below — optional; a missing
 *   grade falls back to the mild-steel-family default the same way
 *   resolveDrillingSpeedFeed/resolveTapPhysicsInputs already do.
 * @param counterboreTable  real tblCounterboring rows (MachiningLookupService
 *   .getCounterboreTable(), fetched once by the async caller) for real
 *   per-occurrence diameter+hardness-matched counterbore physics; null/
 *   absent falls back to the previous flat constant, disclosed as such.
 * @param chamferLinearSpeedMmPerSec  real hardness-matched tblChamfering
 *   linear speed (MachiningLookupService.getChamferParams), resolved once
 *   for the whole part (no diameter axis in that table); null/absent falls
 *   back to the previous flat constant, disclosed as such.
 * @param roundingLinearSpeedMmPerSec  real hardness-matched
 *   tblCornerRoundingMill linear speed (MachiningLookupService
 *   .getRoundingParams), resolved once for the whole part (no diameter axis
 *   in that table either); null/absent falls back to the previous flat
 *   constant, disclosed as such.
 * @returns flat OperationLine[] sorted in manufacturing order, or [] if no features
 */
export function buildOperationSequence(
  fgv2Features: unknown[] | null | undefined,
  matClass: MaterialClass,
  machinabilityFactor = 1.0,
  materialGrade: string | null = null,
  counterboreTable: any[] | null = null,
  chamferLinearSpeedMmPerSec: number | null = null,
  roundingLinearSpeedMmPerSec: number | null = null,
  drillingTable: DrillingTable | null = null,
  calculators: MachiningCalculators | null = null,
  tappingTable: any[] | null = null,
  // The material's milling removal rate (tblMillingRemovalRate). Null = not on file: every operation that divides a
  // volume by it is a named gap.
  removalRateMm3PerMin: number | null = null,
  // The material's finishing cutter (tblMillingFinishing). Null = not on file: every finishing pass is a named gap.
  finishing: MillingFinishingRow | null = null,
): OperationLine[] {
  if (!Array.isArray(fgv2Features) || fgv2Features.length === 0) return [];

  const ops: OperationLine[] = [];

  // Face mill is always first — part has to be squared before any features
  // The inputs every volume- or area-based milling calculator shares, and the per-operation calls.
  const mrrSeed: Record<string, CalcSeed> = removalRateMm3PerMin != null && removalRateMm3PerMin > 0 ? {
    'Material Removal Rate': {
      value: removalRateMm3PerMin * machinabilityFactor, lookup: true,
      source: `tblMillingRemovalRate: ${matClass} ${removalRateMm3PerMin} mm^3/min x machinability factor ${machinabilityFactor}`,
      match: { table: 'tblMillingRemovalRate', row: { MaterialClass: matClass } },
    },
  } : {};
  const volumeOp = (operation: string, removedMm3: number) => calcOp(calculators, operation, {
    'Removed Volume': { value: removedMm3, source: 'CAD: volume the features remove' }, ...mrrSeed,
  });
  // A finishing pass is a tool path at the cutter's feed: the cutter and how it runs in this material, from the table.
  const cutterSeeds = (toolMm: number, toolWhy: string): Record<string, CalcSeed> => {
    if (!finishing) return {};
    const fromTable = (value: number, column: string, note = ''): CalcSeed => ({
      value, lookup: true, source: `tblMillingFinishing: ${matClass} ${column}${note}`,
      match: { table: 'tblMillingFinishing', row: { MaterialClass: matClass } },
    });
    return {
      'Tool Diameter': toolMm === finishing.toolDiameterMm
        ? fromTable(toolMm, 'ToolDiameterMm')
        : { value: toolMm, source: toolWhy },
      'Teeth': fromTable(finishing.teeth, 'Teeth'),
      'Cutting Speed': fromTable(finishing.cuttingSpeedMPerMin * machinabilityFactor, 'CuttingSpeedMPerMin', ` ${finishing.cuttingSpeedMPerMin} m/min x machinability factor ${machinabilityFactor}`),
      'Feed per Tooth per Diameter': fromTable(finishing.feedPerToothPerDiameter, 'FeedPerToothPerDiameter'),
    };
  };
  const standardToolMm = finishing?.toolDiameterMm ?? Number.POSITIVE_INFINITY;
  const contourOp = (operation: string, wallMm2: number, surfaceMm2: number, faces: number) => calcOp(calculators, operation, {
    'Wall Area': { value: wallMm2, source: 'CAD: area of the walls' },
    'Surface Area': { value: surfaceMm2, source: 'CAD: area of the free-form surfaces' },
    'Faces': { value: faces, source: 'CAD: faces to contour' },
    ...cutterSeeds(standardToolMm, ''),
  });
  const faceFinishOp = (areaMm2: number, faces: number) => calcOp(calculators, 'Fine Finish Milling', {
    'Floor Area': { value: areaMm2, source: 'CAD: area of the planar faces' },
    'Wall Area': { value: 0, source: 'A planar face has no wall' },
    'Faces': { value: faces, source: 'CAD: planar faces to finish' },
    ...cutterSeeds(standardToolMm, ''),
  });
  const pocketFinishOp = (g: PocketFinishGroup) => calcOp(calculators, 'Fine Finish Milling', {
    'Floor Area': { value: g.floorMm2, source: `CAD: floor of ${g.pockets} pocket(s), length x width` },
    'Wall Area': g.wallMm2 > 0
      ? { value: g.wallMm2, source: 'CAD: pocket perimeter x depth (removed volume over the floor area)' }
      : { value: 0, source: 'The cutter is as wide as the pocket: the walls are finished with the floor' },
    'Faces': { value: g.pockets, source: 'CAD: pockets to finish' },
    ...cutterSeeds(g.toolMm, `CAD: pocket width ${g.toolMm} mm, narrower than the standard finishing cutter`),
  });
  const countOp = (operation: string, field: string, n: number) => calcOp(calculators, operation, { [field]: { value: n, source: 'CAD: feature count' } });
  // An edge with a CAD diameter is timed by its length (pi x D per edge) at the table's edge speed; one without, per edge.
  const edgeOp = (operation: string, table: string, speedMmPerSec: number | null, diameterMm: number, n: number) => {
    const sized = diameterMm > 0;
    return calcOp(calculators, operation, {
      'Edge Length': { value: sized ? Math.PI * diameterMm * n : 0, source: sized ? `CAD: pi x Ø${diameterMm} mm x ${n}` : 'CAD: no sized edge' },
      'Unsized Edges': { value: sized ? 0 : n, source: 'CAD: edges with no diameter' },
      ...(speedMmPerSec && speedMmPerSec > 0
        ? { 'Edge Speed': { value: speedMmPerSec, source: `${table}: edge speed for ${matClass}`, lookup: true } }
        // No sized edge: the speed divides a zero length, so its absence is not a gap.
        : sized ? {} : { 'Edge Speed': { value: 1, source: 'Not used: no sized edge on the part' } }),
    });
  };

  ops.push({ name: "Facing", ...calcOp(calculators, 'Facing', {}), source: "fixed" });

  for (const f of fgv2Features as any[]) {
    // feature_graph_v2 entries carry a reference catalog feature_type
    // (cad-engine/shared/reference_features.json) plus its geometric variant;
    // together they decide the real operation chain below.
    const ft: string = f.feature_type;
    const variant: string = f.variant ?? "default";
    const occurrences: any[] = Array.isArray(f.occurrences) ? f.occurrences : [];
    const count = occurrences.length || 1;
    const diamMm: number = f.diameter_mm ?? 0;

    // Aggregate removed volume across all occurrences
    const totalRemovedMm3: number = occurrences.reduce(
      (s: number, o: any) => s + (o.material_removed_mm3 ?? 0),
      0,
    );

    // Real aggregate classified area (PlanarFace/CurvedWall/CurvedSurface/
    // Cutout regions) -- these carry no material_removed_mm3 of their own
    // (classifying a face does not reveal how much stock sat above it).
    const totalAreaMm2: number = occurrences.reduce(
      (s: number, o: any) => s + (o.area_mm2 ?? 0),
      0,
    );

    // The faces a finishing pass enters: a region with no area is not one.
    const faceCount = occurrences.filter((o: any) => (o.area_mm2 ?? 0) > 0).length;

    // Representative depth: first occurrence, fallback 2.5×D
    const depthMm: number = occurrences[0]?.depth_mm ?? diamMm * 2.5;

    // Thread spec: occurrences[0].spec (e.g. "M6×1.0"). pitch_mm is real
    // CAD data when present; undefined lets computeTapCycleSec fall back to
    // the standard ISO coarse-pitch series.
    const threadSpec: string | null = occurrences[0]?.spec ?? null;
    const threadPitchMm: number | undefined = occurrences[0]?.pitch_mm ?? undefined;

    const firstOpOfFeature = ops.length;
    const instanceCount = variant === "pcd_pattern"
      ? occurrences.reduce((s: number, o: any) => s + (o.hole_count ?? 1), 0)
      : count;

    switch (`${ft}:${variant}`) {
      case "PocketV2:default":
        // "Rough Milling//PocketV2" is the real catalog op; no PocketV2-specific
        // finish row exists, so the real generic "Fine Finish Milling" is reused.
        ops.push({ name: "Rough Milling", ...volumeOp('Rough Milling', totalRemovedMm3), source: "feature", cadFeatureType: ft });
        {
          // One finishing line per cutter the pockets need; a pocket with no CAD size is a named gap.
          const groups = pocketFinishGroups(occurrences, standardToolMm);
          if (!groups) ops.push({ name: "Fine Finish Milling", timeSec: 0, missing: 'the CAD length and width of every pocket', source: "feature", cadFeatureType: ft });
          for (const g of groups ?? []) ops.push({ name: "Fine Finish Milling", ...pocketFinishOp(g), source: "feature", cadFeatureType: ft, count: g.pockets });
        }
        break;

      case "Slot:straight":
      case "Slot:radial":
        ops.push({ name: "Rough Milling", ...volumeOp('Rough Milling', totalRemovedMm3), source: "feature", cadFeatureType: ft });
        ops.push({ name: "Slot Milling", ...countOp('Slot Milling', 'Slots', count), source: "feature", cadFeatureType: ft });
        break;

      case "Keyway:default":
        // A keyway no broach in the reference cuts (keyway-routing.ts): the
        // catalog's "Rough Milling//Keyway" on the mill.
        ops.push({ name: "Rough Milling", ...volumeOp('Rough Milling', totalRemovedMm3), source: "feature", cadFeatureType: ft });
        break;

      case "SimpleHole:through":
      case "SimpleHole:blind":
      case "SimpleHole:cross":
        if (diamMm > 0) {
          ops.push({ name: "Center Drilling", ...countOp('Center Drilling', 'Holes', count), source: "feature", cadFeatureType: ft, diameterMm: diamMm });
          ops.push({ name: "Drilling", ...drillOp(diamMm, depthMm, count, materialGrade, drillingTable, calculators), source: "feature", cadFeatureType: ft, diameterMm: diamMm });
        }
        break;

      case "SimpleHole:pcd_pattern": {
        // One occurrence per pattern; each carries the real number of holes
        // it stands for (hole_count), so drilling is costed per real hole.
        const holes = occurrences.reduce((s: number, o: any) => s + (o.hole_count ?? 1), 0);
        if (diamMm > 0 && holes > 0) {
          ops.push({ name: "Center Drilling", ...countOp('Center Drilling', 'Holes', holes), source: "feature", cadFeatureType: ft, diameterMm: diamMm });
          ops.push({ name: "Drilling", ...drillOp(diamMm, depthMm, holes, materialGrade, drillingTable, calculators), source: "feature", cadFeatureType: ft, diameterMm: diamMm });
        }
        break;
      }

      case "MultiStepHole:stepped": {
        // Each occurrence carries its own real steps[] (3+ coaxial bores). One
        // spot drill per hole assembly; drill time is the same drillTimeSec
        // physics applied per real step.
        let spots = 0;
        let drillSec = 0;
        const stepMissing: string[] = [];
        for (const occ of occurrences) {
          const steps: Array<{ diameter_mm: number; depth_mm: number }> = Array.isArray(occ.steps) ? occ.steps : [];
          if (steps.length === 0) continue;
          spots += 1;
          for (const step of steps) {
            const op = drillOp(step.diameter_mm, step.depth_mm, 1, materialGrade, drillingTable, calculators);
            drillSec += op.timeSec;
            if (op.missing) stepMissing.push(op.missing);
          }
        }
        if (spots > 0 || drillSec > 0) {
          ops.push({ name: "Center Drilling", ...countOp('Center Drilling', 'Holes', spots), source: "feature", cadFeatureType: ft });
          ops.push({ name: "Drilling", timeSec: drillSec, source: "feature", cadFeatureType: ft, ...(stepMissing.length ? { missing: stepMissing.join('; ') } : {}) });
        }
        break;
      }

      case "SimpleHole:threaded":
        if (diamMm > 0) {
          ops.push({ name: "Center Drilling", ...countOp('Center Drilling', 'Holes', count), source: "feature", cadFeatureType: ft, diameterMm: diamMm });
          ops.push({ name: "Drilling", ...drillOp(diamMm * 0.8, depthMm, count, materialGrade, drillingTable, calculators), source: "feature", cadFeatureType: ft, diameterMm: diamMm }); // minor diameter
          ops.push({ name: "Chamfering", ...edgeOp('Chamfering', 'tblChamfering', chamferLinearSpeedMmPerSec, diamMm, count), source: "feature", cadFeatureType: ft, diameterMm: diamMm });
          ops.push({ name: "Tapping", ...tapOp(threadSpec, count, matClass, threadPitchMm, depthMm, tappingTable, calculators), source: "feature", cadFeatureType: ft, diameterMm: diamMm });
        }
        break;

      case "MultiStepHole:counterbore":
        if (diamMm > 0) {
          ops.push({ name: "Center Drilling", ...countOp('Center Drilling', 'Holes', count), source: "feature", cadFeatureType: ft, diameterMm: diamMm });
          ops.push({ name: "Drilling", ...drillOp(diamMm * 0.6, depthMm, count, materialGrade, drillingTable, calculators), source: "feature", cadFeatureType: ft, diameterMm: diamMm }); // through bore
          ops.push({ name: "Counterboring", timeSec: counterboreTimeSec(diamMm, depthMm, count, matClass, counterboreTable), source: "feature", cadFeatureType: ft, diameterMm: diamMm });
        }
        break;

      case "Edge:countersink":
        if (diamMm > 0) {
          ops.push({ name: "Center Drilling", ...countOp('Center Drilling', 'Holes', count), source: "feature", cadFeatureType: ft, diameterMm: diamMm });
          ops.push({ name: "Drilling", ...drillOp(diamMm * 0.6, depthMm, count, materialGrade, drillingTable, calculators), source: "feature", cadFeatureType: ft, diameterMm: diamMm });
          ops.push({ name: "Countersinking", ...countOp('Countersinking', 'Holes', count), source: "feature", cadFeatureType: ft, diameterMm: diamMm });
        }
        break;

      case "Edge:chamfer":
        ops.push({ name: "Chamfering", ...edgeOp('Chamfering', 'tblChamfering', chamferLinearSpeedMmPerSec, diamMm, count), source: "feature", cadFeatureType: ft, diameterMm: diamMm > 0 ? diamMm : undefined });
        break;

      case "Edge:round":
        // Convex toroidal blend. Driven by the real tblCornerRoundingMill
        // linear speed (the Filleting calculator); edge-rounding, not material removal.
        ops.push({ name: "Filleting", ...edgeOp('Filleting', 'tblCornerRoundingMill', roundingLinearSpeedMmPerSec, diamMm, count), source: "feature", cadFeatureType: ft, diameterMm: diamMm > 0 ? diamMm : undefined });
        break;

      case "Slot:groove":
      case "Ring:groove":
        // Concave toroidal recess ("Groove Milling//Slot" on a mill,
        // "Plunging//Ring" on a lathe) -- costed by the same real rounding
        // linear speed, a disclosed stand-in until a groove table exists.
        ops.push({ name: "Groove Milling", ...edgeOp('Groove Milling', 'tblCornerRoundingMill', roundingLinearSpeedMmPerSec, diamMm, count), source: "feature", cadFeatureType: ft, diameterMm: diamMm > 0 ? diamMm : undefined });
        break;

      case "PlanarFace:default":
        ops.push({ name: "Fine Finish Milling", ...faceFinishOp(totalAreaMm2, faceCount), source: "feature", cadFeatureType: ft });
        break;

      case "CurvedWall:default":
      case "CurvedSurface:default":
        // The real catalog uses the same "Contouring" op for both feature types.
        ops.push({ name: "Contouring", ...(ft === 'CurvedWall' ? contourOp('Contouring', totalAreaMm2, 0, faceCount) : contourOp('Contouring', 0, totalAreaMm2, faceCount)), source: "feature", cadFeatureType: ft });
        break;

      case "Cutout:default":
        // Non-circular through-opening: its wall (totalAreaMm2) followed with the side of the cutter.
        ops.push({ name: "Perimeter Milling", ...contourOp('Perimeter Milling', totalAreaMm2, 0, faceCount), source: "feature", cadFeatureType: ft });
        break;

      default:
        // Ring:outer_diameter (turned OD -- costed by the turning engine, not
        // here) and any feature with no milling case contribute their removed
        // volume to "Bulk Milling", the real catalog's generic-removal op.
        if (totalRemovedMm3 > 0) {
          ops.push({ name: "Bulk Milling", ...volumeOp('Bulk Milling', totalRemovedMm3), source: "feature" });
        }
    }
    for (let i = firstOpOfFeature; i < ops.length; i++) {
      ops[i]!.count ??= instanceCount;
      if (typeof f.id === "string" && f.id) ops[i]!.featureIds = [f.id];
    }
  }

  // Deburr always follows machining (bench operation). Left un-renamed
  // deliberately: this op is excluded from the milling line's own cost sum
  // (MILLING_DOUBLE_BILLED_ELSEWHERE) and never validated against THIS
  // process's own operation_category list anyway — its real catalog home is
  // a different real ProcessName ("Manual Deburr"/"Automated Deburr"), which
  // is a real per-part billing already handled elsewhere (bom-items.service.ts's
  // separate, real getDeburrParams()-driven "Deburring" line).
  ops.push({ name: "Deburr", timeSec: 90, source: "fixed" });

  // Sort into canonical manufacturing order
  ops.sort((a, b) => opOrderIndex(a.name) - opOrderIndex(b.name));

  return ops;
}

/**
 * Sum total cycle time (seconds) from an OperationLine array.
 */
export function totalCycleTimeSec(ops: OperationLine[]): number {
  return ops.reduce((s, o) => s + o.timeSec, 0);
}

/**
 * Inject drawing intelligence overrides into an existing operation list.
 *
 * Rules applied (Fix 5):
 *  - Ra < 1.6 μm → scale any Finish* operation +30%, or add a Finish Pass
 *  - Tight tolerance < 0.05 mm → add CMM Inspect (60 s/feature)
 *  - Thread callouts → ensure Rigid Tap exists for each thread size
 *
 * Surface treatment (anodize, powder coat) is handled at a higher level via
 * computeSurfaceTreatmentLine() because it needs surfaceArea + batchSize.
 * This function only modifies machine-time ops.
 */
export function injectDrawingIntelligence(
  ops: OperationLine[],
  di: Record<string, any> | null | undefined,
  materialGrade: string | null = null,
  tappingTable: any[] | null = null,
  calculators: MachiningCalculators | null = null,
): OperationLine[] {
  if (!di) return ops;

  const result = [...ops];

  // Ra finish pass
  const raValue = di.surfaceFinishRa?.value ?? di.surface_finish_ra ?? null;
  const raMicron = typeof raValue === "number" ? raValue : parseFloat(raValue ?? "");
  if (isFinite(raMicron) && raMicron < 1.6 && raMicron > 0) {
    const finishIdx = result.findIndex((o) =>
      o.name.includes("Finish") || o.name.includes("Rough"),
    );
    if (finishIdx >= 0) {
      result[finishIdx] = { ...result[finishIdx], timeSec: result[finishIdx].timeSec * 1.3 };
    } else {
      result.push({ name: "Finish Pass", timeSec: 120, source: "feature" });
    }
  }

  // Thread callouts — add tapping if not already present
  const threads: any[] = Array.isArray(di.threads) ? di.threads : [];
  for (const t of threads) {
    const spec = t.spec ?? t.size ?? null;
    const count = t.count ?? 1;
    const alreadyHas = result.some((o) => o.name === "Tapping");
    if (!alreadyHas && spec) {
      result.push({ name: "Tapping", ...tapOp(spec, count, detectMaterialClass(materialGrade), t.pitchMm, t.depthMm, tappingTable, calculators), source: "feature" });
    }
  }

  // Tight tolerance → CMM
  const tightest = di.tolerances?.tightest ?? di.tightest_tolerance_mm ?? null;
  const tightestMm = typeof tightest === "number" ? tightest : parseFloat(tightest ?? "");
  const hasCmm = result.some((o) => o.name.toLowerCase().includes("cmm"));
  if (isFinite(tightestMm) && tightestMm < 0.05 && !hasCmm) {
    result.push({ name: "CMM Inspect", timeSec: 300, source: "feature" });
  }

  result.sort((a, b) => opOrderIndex(a.name) - opOrderIndex(b.name));
  return result;
}
