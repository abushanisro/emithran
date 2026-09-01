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

import type { MaterialClass } from '../process/cost-cnc-engine';
import { TAP_CYCLE_SEC } from '../../shared/core/default-rates.constants';

// MRR values (mm³/min) — must stay in sync with MILLING_MRR in cost-cnc-engine.ts
const MRR_MM3_PER_MIN: Record<MaterialClass, number> = {
  aluminum: 60_000,
  mild_steel: 12_000,
  stainless: 5_000,
  titanium: 3_000,
  copper_alloy: 40_000,
  tool_steel: 3_000,
  plastic: 150_000,
};

// Feed rates for drilling (mm/min) by nominal diameter range
function drillFeedMmPerMin(diamMm: number): number {
  if (diamMm < 3) return 200;
  if (diamMm < 6) return 350;
  if (diamMm < 10) return 500;
  if (diamMm < 16) return 600;
  if (diamMm < 25) return 700;
  return 500; // large bores — peck drilling, slower
}

function drillTimeSec(
  diamMm: number,
  depthMm: number,
  count: number,
): number {
  const depthSafe = depthMm > 0 ? depthMm : diamMm * 2.5; // fallback: 2.5×D
  const cyclePerHole = (depthSafe / drillFeedMmPerMin(diamMm)) * 60;
  // 30% overhead for peck cycles, retract, coolant dwell
  return cyclePerHole * 1.3 * count;
}

function tapTimeSec(spec: string | null | undefined, count: number): number {
  const key = (spec ?? "").toUpperCase().replace(/\s/g, "");
  // Normalise "M6×1.0" → "M6"
  const baseKey = key.replace(/[×X×].*$/, "");
  return (TAP_CYCLE_SEC[baseKey] ?? TAP_CYCLE_SEC[key] ?? 10) * count;
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
 * @returns flat OperationLine[] sorted in manufacturing order, or [] if no features
 */
export function buildOperationSequence(
  fgv2Features: unknown[] | null | undefined,
  matClass: MaterialClass,
  machinabilityFactor = 1.0,
): OperationLine[] {
  if (!Array.isArray(fgv2Features) || fgv2Features.length === 0) return [];

  const baseMrr = MRR_MM3_PER_MIN[matClass] ?? MRR_MM3_PER_MIN.mild_steel;
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

    // Thread spec: occurrences[0].spec (e.g. "M6×1.0")
    const threadSpec: string | null = occurrences[0]?.spec ?? null;

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
          ops.push({ name: "Drill", timeSec: drillTimeSec(diamMm, depthMm, count), source: "feature" });
        }
        break;

      case "tapped_hole":
        if (diamMm > 0) {
          ops.push({ name: "Spot Drill", timeSec: count * 5, source: "feature" });
          ops.push({ name: "Drill", timeSec: drillTimeSec(diamMm * 0.8, depthMm, count), source: "feature" }); // minor diameter
          ops.push({ name: "Chamfer", timeSec: count * 4, source: "feature" });
          ops.push({ name: "Rigid Tap", timeSec: tapTimeSec(threadSpec, count), source: "feature" });
        }
        break;

      case "counterbore":
        if (diamMm > 0) {
          ops.push({ name: "Spot Drill", timeSec: count * 5, source: "feature" });
          ops.push({ name: "Drill", timeSec: drillTimeSec(diamMm * 0.6, depthMm, count), source: "feature" }); // through bore
          ops.push({ name: "Counterbore", timeSec: count * 8, source: "feature" });
        }
        break;

      case "countersink":
        if (diamMm > 0) {
          ops.push({ name: "Spot Drill", timeSec: count * 4, source: "feature" });
          ops.push({ name: "Drill", timeSec: drillTimeSec(diamMm * 0.6, depthMm, count), source: "feature" });
          ops.push({ name: "Countersink", timeSec: count * 6, source: "feature" });
        }
        break;

      case "chamfer":
        ops.push({ name: "Chamfer", timeSec: count * 5, source: "feature" });
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
      result.push({ name: "Rigid Tap", timeSec: tapTimeSec(spec, count), source: "feature" });
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
