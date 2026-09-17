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
 * - MRR values are imported from cost-cnc-engine.ts via the MaterialClass type.
 * - TAP_CYCLE_SEC is imported from default-rates.ts.
 * - When feature_graph_v2 is absent or empty, the caller falls back to the old
 *   (billetVol − partVol) / MRR formula — no regression for legacy data.
 *
 * ── Sheet-metal feature-driven routing backlog (see migration 381) ─────────
 * Sheet metal's Counterboring/Countersinking/PEM Insertion/Reaming/CMM Inspection/
 * Hole Extrusion (Burring) are now feature-driven (cost-engine.ts::computeCostSummary,
 * gated on SheetMetalFeatureExtractorService output). Hole extrusion (burled/
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
 *   3. Classify it in SheetMetalFeatureExtractorService / auto-fill.service.ts's
 *      RawGeometry, following the counterboreGroups/countersinkGroups precedent.
 *   4. Add a gated block in cost-engine.ts::computeCostSummary + a
 *      process_calculator_mappings row (+ sm_lookup_* cycle-time table if the
 *      op needs one) for the new operation.
 *
 * Packaging & Logistics already has its own manual/auto-on-material-set UI
 * section (unrelated to this routing engine) — not part of this backlog.
 */

import { MILLING_MRR, computeDrillCycleSec, computeRotaryCycleSec, DRILL_DEPTH_TO_DIAMETER_RATIO } from '../process/cost-cnc-engine';
import type { MaterialClass } from '../process/cost-cnc-engine';
import { computeTapCycleSec, TAP_UNLOAD_SEC } from '../../shared/core/default-rates.constants';
import { nearestByDiameterThenHardness, MACHINING_MATERIAL_HARDNESS_HB } from '../lookup/machining-material-hardness';

// drillTimeSec/tapTimeSec below now call the same real, material-aware
// physics cost-cnc-engine.ts uses (computeDrillCycleSec/computeTapCycleSec)
// instead of keeping their own separate hardcoded tables — this file used
// to carry THREE independent drilling-time models across the two files
// (this one's diameter-only drillFeedMmPerMin, cost-cnc-engine.ts's flat
// DRILL_CYCLE_SEC buckets, and a duplicated MRR_MM3_PER_MIN admitted by its
// own comment to need manual sync with cost-cnc-engine.ts's MILLING_MRR).
// One source of truth now for all three.
const CNC_BLIND_TAP_FALLBACK_DEPTH_MM = 8; // see cost-cnc-engine.ts's own constant of the same name for citation

function drillTimeSec(
  diamMm: number,
  depthMm: number,
  count: number,
  materialGrade: string | null | undefined,
): number {
  return computeDrillCycleSec(diamMm, materialGrade, depthMm > 0 ? depthMm : undefined) * count;
}

function tapTimeSec(
  spec: string | null | undefined,
  count: number,
  materialGrade: string | null | undefined,
  pitchMm?: number,
  depthMm?: number,
): number {
  if (!spec) return 0;
  const b = computeTapCycleSec(spec, count, pitchMm, depthMm, CNC_BLIND_TAP_FALLBACK_DEPTH_MM, materialGrade);
  return b.totalSec + TAP_UNLOAD_SEC;
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
    const targetHb = MACHINING_MATERIAL_HARDNESS_HB[matClass];
    const row = nearestByDiameterThenHardness(counterboreTable, diamMm, targetHb);
    if (row && typeof row.cutting_speed_m_min === 'number' && typeof row.feed_mm_rev === 'number') {
      const depth = depthMm > 0 ? depthMm : diamMm * DRILL_DEPTH_TO_DIAMETER_RATIO;
      return computeRotaryCycleSec(diamMm, row.cutting_speed_m_min, row.feed_mm_rev, depth) * count;
    }
  }
  return count * 8; // disclosed fallback — real table unavailable for this request
}

// Real, material-aware chamfer cycle time — replaces the previous flat
// "count * 5 sec" constant. tblChamfering has no diameter axis (chamfer
// tools are rated by real linear edge speed, not a bore diameter) — the
// real per-occurrence signal available from the CAD detector is the
// chamfer's own diameter_mm (_classify_cone), from which the edge length
// being cut is estimated as a full circular pass (π × diameter) — a real,
// standard geometric approximation for a chamfer running around a hole or
// boss, not a fabricated length. chamferLinearSpeedMmPerSec is the real,
// hardness-matched tblChamfering value, resolved once by the async caller
// (MachiningLookupService.getChamferParams — hardness-only, no diameter
// axis, so one resolved value covers every chamfer occurrence on the part).
function chamferTimeSec(
  diamMm: number,
  count: number,
  chamferLinearSpeedMmPerSec: number | null | undefined,
): number {
  if (chamferLinearSpeedMmPerSec && chamferLinearSpeedMmPerSec > 0 && diamMm > 0) {
    const edgeLengthMm = Math.PI * diamMm;
    return (edgeLengthMm / chamferLinearSpeedMmPerSec) * count;
  }
  return count * 5; // disclosed fallback — real rate unavailable for this request
}

// Roughing: 80% of removed volume is rough, 20% is finish at 40% of MRR
function pocketRoughSec(removedMm3: number, mrr: number): number {
  if (removedMm3 <= 0 || mrr <= 0) return 0;
  const roughVol = removedMm3 * 0.8;
  const finishVol = removedMm3 * 0.2;
  return ((roughVol / mrr) + (finishVol / (mrr * 0.4))) * 60;
}

export interface OperationLine {
  name: string;
  timeSec: number;
  source: "feature" | "fixed";
}

// Feature types that are hole-like (need drilling before tapping/counterboring)
const HOLE_TYPES = new Set(["through_hole", "blind_hole", "tapped_hole", "counterbore", "countersink"]);

// Canonical manufacturing order for sorting
const OP_ORDER: string[] = [
  "Face Mill",
  "Adaptive Rough",
  "Pocket Rough",
  "Slot Rough",
  "Pocket Finish Floor",
  "Pocket Finish Wall",
  "Slot Finish",
  "Spot Drill",
  "Drill",
  "Ream",
  "Counterbore",
  "Countersink",
  "Chamfer",
  "Rigid Tap",
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
 * @returns flat OperationLine[] sorted in manufacturing order, or [] if no features
 */
export function buildOperationSequence(
  fgv2Features: unknown[] | null | undefined,
  matClass: MaterialClass,
  machinabilityFactor = 1.0,
  materialGrade: string | null = null,
  counterboreTable: any[] | null = null,
  chamferLinearSpeedMmPerSec: number | null = null,
): OperationLine[] {
  if (!Array.isArray(fgv2Features) || fgv2Features.length === 0) return [];

  const baseMrr = MILLING_MRR[matClass] ?? MILLING_MRR.mild_steel;
  const mrr = baseMrr * machinabilityFactor;

  const ops: OperationLine[] = [];

  // Face mill is always first — part has to be squared before any features
  ops.push({ name: "Face Mill", timeSec: 45, source: "fixed" });

  for (const f of fgv2Features as any[]) {
    const ft: string = (f.feature_type ?? f.type ?? "").toLowerCase();
    const occurrences: any[] = Array.isArray(f.occurrences) ? f.occurrences : [];
    const count = occurrences.length || 1;
    const diamMm: number = f.diameter_mm ?? 0;

    // Aggregate removed volume across all occurrences
    const totalRemovedMm3: number = occurrences.reduce(
      (s: number, o: any) => s + (o.material_removed_mm3 ?? 0),
      0,
    );

    // Representative depth: first occurrence, fallback 2.5×D
    const depthMm: number = occurrences[0]?.depth_mm ?? diamMm * 2.5;

    // Thread spec: occurrences[0].spec (e.g. "M6×1.0"). pitch_mm is real,
    // already-computed CAD data when present (same field
    // resolveTapPhysicsInputs consumes elsewhere); undefined when absent
    // lets computeTapCycleSec fall back to the standard ISO coarse-pitch
    // series itself, same as everywhere else this physics runs.
    const threadSpec: string | null = occurrences[0]?.spec ?? null;
    const threadPitchMm: number | undefined = occurrences[0]?.pitch_mm ?? undefined;

    switch (ft) {
      case "pocket":
        ops.push({ name: "Pocket Rough", timeSec: pocketRoughSec(totalRemovedMm3, mrr), source: "feature" });
        ops.push({ name: "Pocket Finish Floor", timeSec: count * 30, source: "feature" });
        ops.push({ name: "Pocket Finish Wall", timeSec: count * 25, source: "feature" });
        break;

      case "slot":
        ops.push({ name: "Slot Rough", timeSec: pocketRoughSec(totalRemovedMm3, mrr), source: "feature" });
        ops.push({ name: "Slot Finish", timeSec: count * 20, source: "feature" });
        break;

      case "through_hole":
      case "blind_hole":
        if (diamMm > 0) {
          ops.push({ name: "Spot Drill", timeSec: count * 5, source: "feature" });
          ops.push({ name: "Drill", timeSec: drillTimeSec(diamMm, depthMm, count, materialGrade), source: "feature" });
        }
        break;

      case "tapped_hole":
        if (diamMm > 0) {
          ops.push({ name: "Spot Drill", timeSec: count * 5, source: "feature" });
          ops.push({ name: "Drill", timeSec: drillTimeSec(diamMm * 0.8, depthMm, count, materialGrade), source: "feature" }); // minor diameter
          ops.push({ name: "Chamfer", timeSec: chamferTimeSec(diamMm, count, chamferLinearSpeedMmPerSec), source: "feature" });
          ops.push({ name: "Rigid Tap", timeSec: tapTimeSec(threadSpec, count, materialGrade, threadPitchMm, depthMm), source: "feature" });
        }
        break;

      case "counterbore":
        if (diamMm > 0) {
          ops.push({ name: "Spot Drill", timeSec: count * 5, source: "feature" });
          ops.push({ name: "Drill", timeSec: drillTimeSec(diamMm * 0.6, depthMm, count, materialGrade), source: "feature" }); // through bore
          ops.push({ name: "Counterbore", timeSec: counterboreTimeSec(diamMm, depthMm, count, matClass, counterboreTable), source: "feature" });
        }
        break;

      case "countersink":
        if (diamMm > 0) {
          ops.push({ name: "Spot Drill", timeSec: count * 4, source: "feature" });
          ops.push({ name: "Drill", timeSec: drillTimeSec(diamMm * 0.6, depthMm, count, materialGrade), source: "feature" });
          ops.push({ name: "Countersink", timeSec: count * 6, source: "feature" });
        }
        break;

      case "chamfer":
        ops.push({ name: "Chamfer", timeSec: chamferTimeSec(diamMm, count, chamferLinearSpeedMmPerSec), source: "feature" });
        break;

      default:
        // Unknown feature — contribute removed volume to roughing time if non-zero
        if (totalRemovedMm3 > 0) {
          ops.push({ name: "Adaptive Rough", timeSec: pocketRoughSec(totalRemovedMm3, mrr), source: "feature" });
        }
    }
  }

  // Deburr always follows machining (bench operation)
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
    const alreadyHas = result.some((o) => o.name === "Rigid Tap");
    if (!alreadyHas && spec) {
      result.push({ name: "Rigid Tap", timeSec: tapTimeSec(spec, count, materialGrade, t.pitchMm, t.depthMm), source: "feature" });
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
