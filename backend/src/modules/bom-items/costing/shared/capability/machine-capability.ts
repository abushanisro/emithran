// P0.1 superseded this registry as the PRIMARY capability source: real,
// provenance-tagged per-machine capability (mhr_records -> seed registry ->
// class defaults, see checkMachineCapability's realCapability param below) now
// takes priority whenever available, which is every real production call site
// today (see checkMachineCapability's own doc comment). This static,
// commodity-code-keyed registry is what remains: the last-resort fallback for
// when realCapability is genuinely absent (ENABLE_PHYSICS_MACHINE_SELECTION=
// false, or no candidate was ever resolved) -- kept and tested deliberately
// (machine-capability.spec.ts's "falls back to the static registry unchanged
// when no real capability is available"), not forgotten Phase-1 scaffolding.

import type { MachineClass } from '../core/default-rates.constants';
import { estimateBendTonnage, estimateTurretPunchTonnage } from '../core/default-rates.constants';
import type { MachineCapability } from './machine-selection/seed-registry';
import { classifyLaserMaterial, TONNAGE_MARGIN, BED_MARGIN } from './machine-selection/physics';
import { laserThicknessLimit, materialThicknessLimit } from './machine-selection/selector';

export interface MachineCapabilitySpec {
  maxThicknessMm?: number;
  maxBedLengthMm?: number;
  maxBedWidthMm?: number;
  maxTonnage?: number;
}

export interface MachineCapabilityEntry {
  machineClass: MachineClass;
  spec: MachineCapabilitySpec;
}

export const MACHINE_CAPABILITY_REGISTRY: Readonly<
  Record<string, MachineCapabilityEntry>
> = {
  // Fiber Laser
  "SM-LASER-2K": { machineClass: "fiber_laser", spec: { maxThicknessMm: 8,   maxBedLengthMm: 3000, maxBedWidthMm: 1500 } },
  "SM-LASER-4K": { machineClass: "fiber_laser", spec: { maxThicknessMm: 16,  maxBedLengthMm: 4000, maxBedWidthMm: 2000 } },
  "SM-LASER-6K": { machineClass: "fiber_laser", spec: { maxThicknessMm: 25,  maxBedLengthMm: 6000, maxBedWidthMm: 2000 } },
  // Press Brake
  "SM-BRAKE-80T":  { machineClass: "press_brake", spec: { maxThicknessMm: 8,  maxBedLengthMm: 2500, maxTonnage: 80  } },
  "SM-BRAKE-160T": { machineClass: "press_brake", spec: { maxThicknessMm: 12, maxBedLengthMm: 3200, maxTonnage: 160 } },
  "SM-BRAKE-320T": { machineClass: "press_brake", spec: { maxThicknessMm: 20, maxBedLengthMm: 4000, maxTonnage: 320 } },
  // Turret Punch — 30t is a representative job-shop CNC turret punch class,
  // cited from real machine specs researched this session (Amada Pega 357,
  // Amada EMK-3612 M2, Murata Centrum 2000/Magnum 1250 — all real 20-33 ton
  // job-shop turret presses; see migration 414's own citations).
  "SM-PUNCH-CNC": { machineClass: "turret_punch", spec: { maxThicknessMm: 6, maxBedLengthMm: 2500, maxBedWidthMm: 1250, maxTonnage: 30 } },
  // Waterjet — effectively unconstrained for sheet metal range
  "SM-WATERJET":  { machineClass: "waterjet", spec: { maxThicknessMm: 100, maxBedLengthMm: 6000, maxBedWidthMm: 3000 } },
  // Tapping + Deburring — no dimensional constraints
  "SM-TAP-CNC":   { machineClass: "tapping",   spec: {} },
  "BENCH-DEBURR": { machineClass: "deburring",  spec: {} },
};

export interface PartGeometryForCapability {
  sheetThicknessMm: number;
  flatPatternLengthMm: number | null;
  flatPatternWidthMm: number | null;
  // Bend-force inputs (optional — tonnage skipped when absent). bendLengthMm is
  // the longest bend line; the longest flat-pattern edge is a conservative proxy.
  bendLengthMm?: number | null;
  materialUtsMpa?: number | null;
  // Turret-punch force inputs (optional — tonnage skipped when absent).
  // punchCutLengthMm is the same real cut/contour length the turret engine's
  // own nibbling calc already uses (turret-punch-engine.ts) — the "Length Of
  // Cut (Internal & External)" input to the real TPP Manufacturing formula.
  punchCutLengthMm?: number | null;
  materialShearStrengthMpa?: number | null;
  // Raw material grade — used only for laser material-family-specific thickness
  // limits (classifyLaserMaterial) when realCapability is available. Optional:
  // absence just means the generic (non-material-specific) thickness limit is used.
  materialGrade?: string | null;

  // ── CNC (Machining) geometry — deliberately separate from the sheet-metal
  // fields above, never cross-read by either machine class's branch below.
  // partDiameterMm: turning cross-section (chuck swing) — checked against
  // realCapability.maxDiameterMm for cnc_lathe/cnc_lathe_live only.
  // partLengthMm/partWidthMm/partHeightMm: 3D bounding box — checked against
  // realCapability.maxXMm/maxYMm/maxZMm (best-fit orientation, all 3 axes)
  // for the milling classes only. All optional: absent for every non-CNC
  // caller, and checkMachineCapability's CNC branches only run when the
  // real data they need is actually present — never fabricated.
  partDiameterMm?: number | null;
  partLengthMm?: number | null;
  partWidthMm?: number | null;
  partHeightMm?: number | null;
}

export type CapabilityReasonCode =
  | "DIMENSIONS_UNAVAILABLE"
  | "NO_MACHINE_SELECTED"
  | "SPEC_NOT_ON_FILE"
  | "CLASS_THICKNESS_LIMIT"
  | "THICKNESS_EXCEEDED"
  | "BED_LENGTH_EXCEEDED"
  | "BED_WIDTH_EXCEEDED"
  | "TONNAGE_EXCEEDED";

export interface CapabilityCheck {
  capable: boolean;
  confidence: "high" | "medium" | "low";
  reasonCodes: CapabilityReasonCode[];
  reasons: string[];
  estimatedTonnage: number | null;
}

// Class-level constraints — enforced regardless of which instance is selected
const CLASS_CONSTRAINTS: Partial<
  Record<string, (g: PartGeometryForCapability) => Array<{ code: CapabilityReasonCode; message: string }>>
> = {
  turret_punch: (g) =>
    g.sheetThicknessMm > 6
      ? [{ code: "CLASS_THICKNESS_LIMIT", message: `Thickness ${g.sheetThicknessMm}mm exceeds turret punch limit (6mm)` }]
      : [],
};

// Real, granular primary CNC classes (Machining Engine Re-Architecture) —
// the classes this function's turning/milling branches below handle with
// CNC-style geometry (partDiameterMm/partLengthMm/partWidthMm/partHeightMm)
// rather than sheet-metal-style flat-pattern geometry. Replaces a broken
// machineClass.startsWith("cnc_") check: none of these granular class names
// start with "cnc_", so that check silently stopped gating anything the
// moment the coarse cnc_3ax_vmc/cnc_lathe/etc. buckets were deleted —
// caught by machine-capability.spec.ts's real-per-machine-envelope tests.
const CNC_PRIMARY_CLASSES = new Set([
  '2_axis_lathe', '3_axis_lathe', '2_axis_bar_feed_lathe_with_sub_spindle', '3_axis_bar_feed_lathe_with_sub_spindle',
  '3_axis_mill', '4_axis_mill', '5_axis_mill',
]);

export function checkMachineCapability(
  machineClass: string,
  commodityCode: string | null,
  geometry: PartGeometryForCapability,
  // Real, provenance-tagged per-machine capability from machine-selection/
  // selector.ts's DB-first hydration (mhr_records -> seed registry -> class
  // defaults). When present, this is authoritative and the static
  // MACHINE_CAPABILITY_REGISTRY below is skipped entirely — see the P0.1 plan:
  // the registry alone couldn't see a specific machine's real tonnage/thickness
  // limits and silently defaulted to "capable" whenever commodityCode was null
  // or unrecognized, even after the real selector had already proven no machine
  // in the shop could do the job. Absent (undefined/null) only when physics
  // selection is disabled or no candidate was ever resolved -- the registry
  // remains the honest last-resort tier for that case, and for machine classes
  // (waterjet, tapping, deburring) the DB-first selector doesn't yet score.
  realCapability?: MachineCapability | null,
  // Provenance of realCapability, straight from the SAME candidate it was read
  // off (candidate.capability / candidate.capabilitySource are sibling fields
  // on machine-selection/selector.ts's MachineCandidate for the one machine
  // actually selected — see bom-items.service.ts's call sites, which read both
  // off one local `cand`/`candidate` so they can never point at two different
  // machines). 'imported' = real mhr_records data (high confidence); 'seed' =
  // name-matched guess (medium); 'default_class' = conservative class-wide
  // default, no real data on this machine at all (low) — mirrors how
  // selector.ts itself treats these tiers (it caps its own confidence at 40
  // for 'default_class'). Do NOT report "high" confidence for a guess just
  // because it came from the real-capability code path.
  capabilitySource?: "imported" | "seed" | "default_class",
): CapabilityCheck {
  // Bend tonnage — air-bending physics (1.42 × UTS × t² × L / V), press brake only
  const bendTonnage =
    machineClass === "press_brake" &&
    geometry.materialUtsMpa != null &&
    geometry.bendLengthMm != null
      ? estimateBendTonnage(geometry.materialUtsMpa, geometry.sheetThicknessMm, geometry.bendLengthMm)
      : null;
  // Turret punch tonnage — real TPP Manufacturing formula (see
  // estimateTurretPunchTonnage's own doc comment), turret punch only.
  const turretTonnage =
    machineClass === "turret_punch" &&
    geometry.materialShearStrengthMpa != null &&
    geometry.punchCutLengthMm != null
      ? estimateTurretPunchTonnage(geometry.materialShearStrengthMpa, geometry.sheetThicknessMm, geometry.punchCutLengthMm)
      : null;
  const estimatedTonnage = bendTonnage ?? turretTonnage;

  // NULL dimensions — assume capable, low confidence. Gated to sheet-metal-
  // style classes only: flatPatternLengthMm/WidthMm are that geometry's own
  // real fields, always null for a CNC caller (which correctly reports its
  // dimensions via partDiameterMm/partLengthMm/partWidthMm/partHeightMm
  // instead — see PartGeometryForCapability's own doc comment). Without this
  // gate, EVERY CNC check short-circuited to "assumed capable" here before
  // ever reaching the CNC turning/milling branches below — caught by their
  // own test suite (machine-capability.spec.ts) immediately after adding it.
  const isCncClass = CNC_PRIMARY_CLASSES.has(machineClass);
  if (!isCncClass && (geometry.flatPatternLengthMm == null || geometry.flatPatternWidthMm == null)) {
    return {
      capable: true,
      confidence: "low",
      reasonCodes: ["DIMENSIONS_UNAVAILABLE"],
      reasons: ["Dimensions unavailable — capability assumed"],
      estimatedTonnage,
    };
  }

  const failures: Array<{ code: CapabilityReasonCode; message: string }> = [];

  // Class-level constraints (e.g. turret ≤ 6mm)
  const classCheck = CLASS_CONSTRAINTS[machineClass];
  if (classCheck) failures.push(...classCheck(geometry));

  // Real per-machine capability takes priority over the static registry below.
  if (realCapability) {
    const isLaser = machineClass === "fiber_laser" || machineClass === "co2_laser";
    const isShear = machineClass === "shear";
    const thicknessLimit = isLaser
      ? laserThicknessLimit(realCapability, {
          kind: "laser",
          thicknessMm: geometry.sheetThicknessMm,
          materialFamily: classifyLaserMaterial(geometry.materialGrade ?? null),
          materialGrade: geometry.materialGrade ?? null,
          // Non-null: isLaser is never a cnc_* class, so the isCncClass
          // guard above never skips the flatPattern-null early-return for
          // this branch — by the time execution reaches here, both fields
          // are guaranteed non-null.
          bedLengthMm: geometry.flatPatternLengthMm!,
          bedWidthMm: geometry.flatPatternWidthMm!,
        })
      : isShear
      ? materialThicknessLimit(realCapability, classifyLaserMaterial(geometry.materialGrade ?? null))
      : realCapability.maxThicknessMm;
    if (thicknessLimit != null && geometry.sheetThicknessMm > thicknessLimit) {
      failures.push({ code: "THICKNESS_EXCEEDED", message: `Thickness ${geometry.sheetThicknessMm}mm exceeds machine limit (${thicknessLimit}mm)` });
    }

    if (machineClass === "press_brake") {
      // Real bend length (how long a single fold is), not flat-pattern length —
      // matches machine-selection/selector.ts's own press_brake bed comparison.
      const bendLen = geometry.bendLengthMm ?? geometry.flatPatternLengthMm;
      if (realCapability.maxLengthMm != null && bendLen != null && bendLen * BED_MARGIN > realCapability.maxLengthMm) {
        failures.push({ code: "BED_LENGTH_EXCEEDED", message: `Bend length ${bendLen}mm exceeds machine bed (${realCapability.maxLengthMm}mm)` });
      }
    } else if (isShear) {
      // Real shear bed/blade length (machine_library.json's shear_length_mm →
      // MachineCapability.maxLengthMm) vs. the longest edge of the flat
      // pattern — the longest flat-pattern edge is a conservative proxy for
      // the actual cut length, same convention as press_brake's bendLengthMm
      // fallback above.
      const cutLen = geometry.flatPatternLengthMm != null && geometry.flatPatternWidthMm != null
        ? Math.max(geometry.flatPatternLengthMm, geometry.flatPatternWidthMm)
        : geometry.flatPatternLengthMm;
      if (realCapability.maxLengthMm != null && cutLen != null && cutLen * BED_MARGIN > realCapability.maxLengthMm) {
        failures.push({ code: "BED_LENGTH_EXCEEDED", message: `Cut length ${cutLen}mm exceeds machine shear bed (${realCapability.maxLengthMm}mm)` });
      }
    } else if (
      machineClass === "2_axis_lathe" || machineClass === "3_axis_lathe" ||
      machineClass === "2_axis_bar_feed_lathe_with_sub_spindle" || machineClass === "3_axis_bar_feed_lathe_with_sub_spindle"
    ) {
      // Real turning capacity: chuck swing (part cross-section diameter) and
      // bar/part length — genuinely different physical quantities from the
      // XY bed-fit check below (a lathe doesn't have an X/Y bed; it has a
      // spindle bore and a Z-axis travel), staged from the real per-machine
      // limits.maxDiameterMm/maxLengthMm (migration 755).
      if (
        realCapability.maxDiameterMm != null && geometry.partDiameterMm != null &&
        geometry.partDiameterMm * BED_MARGIN > realCapability.maxDiameterMm
      ) {
        failures.push({
          code: "THICKNESS_EXCEEDED", // no CNC-specific reason code exists yet; closest real category (a dimensional capacity exceeded)
          message: `Part diameter ${geometry.partDiameterMm}mm exceeds machine swing capacity (${realCapability.maxDiameterMm}mm)`,
        });
      }
      if (
        realCapability.maxLengthMm != null && geometry.partLengthMm != null &&
        geometry.partLengthMm * BED_MARGIN > realCapability.maxLengthMm
      ) {
        failures.push({
          code: "BED_LENGTH_EXCEEDED",
          message: `Part length ${geometry.partLengthMm}mm exceeds machine turning length (${realCapability.maxLengthMm}mm)`,
        });
      }
    } else if (machineClass === "3_axis_mill" || machineClass === "4_axis_mill" || machineClass === "5_axis_mill") {
      // Real 3-axis work envelope (table travel), staged from the real
      // per-machine limits.travelXAxisMm/travelYAxisMm/travelZAxisMm
      // (migration 755) — the same real columns (max_x_mm/max_y_mm) Sheet
      // Metal's own bed-fit check already reads below, plus the Z-axis this
      // function never checked before (a genuinely 3D part, unlike a flat
      // sheet-metal pattern, can be limited by table height too). Best-fit
      // orientation: length/width may swap to fit the bed (a part can be
      // rotated in X/Y before fixturing); height is checked directly against
      // Z travel, not swappable with X/Y on a 3-axis machine.
      if (
        realCapability.maxXMm != null && realCapability.maxYMm != null &&
        geometry.partLengthMm != null && geometry.partWidthMm != null
      ) {
        const l = geometry.partLengthMm * BED_MARGIN;
        const w = geometry.partWidthMm * BED_MARGIN;
        const fitsXY = (realCapability.maxXMm >= l && realCapability.maxYMm >= w) ||
                       (realCapability.maxXMm >= w && realCapability.maxYMm >= l);
        if (!fitsXY) {
          failures.push({
            code: "BED_LENGTH_EXCEEDED",
            message: `Part ${geometry.partLengthMm}x${geometry.partWidthMm}mm exceeds machine table travel (${realCapability.maxXMm}x${realCapability.maxYMm}mm)`,
          });
        }
      }
      if (
        realCapability.maxZMm != null && geometry.partHeightMm != null &&
        geometry.partHeightMm * BED_MARGIN > realCapability.maxZMm
      ) {
        failures.push({
          code: "BED_WIDTH_EXCEEDED", // no dedicated Z-axis reason code exists yet; closest real category (a bed/travel dimension exceeded)
          message: `Part height ${geometry.partHeightMm}mm exceeds machine Z-axis travel (${realCapability.maxZMm}mm)`,
        });
      }
    } else if (
      realCapability.maxXMm != null && realCapability.maxYMm != null &&
      geometry.flatPatternLengthMm != null && geometry.flatPatternWidthMm != null
    ) {
      const l = geometry.flatPatternLengthMm * BED_MARGIN;
      const w = geometry.flatPatternWidthMm * BED_MARGIN;
      const fits = (realCapability.maxXMm >= l && realCapability.maxYMm >= w) ||
                   (realCapability.maxXMm >= w && realCapability.maxYMm >= l);
      if (!fits) {
        failures.push({
          code: "BED_LENGTH_EXCEEDED",
          message: `Part ${geometry.flatPatternLengthMm}x${geometry.flatPatternWidthMm}mm exceeds machine bed (${realCapability.maxXMm}x${realCapability.maxYMm}mm)`,
        });
      }
    }

    if (estimatedTonnage != null && realCapability.maxTonnage != null && estimatedTonnage * TONNAGE_MARGIN > realCapability.maxTonnage) {
      const forceLabel = machineClass === "turret_punch" ? "Estimated punch force" : "Estimated bend force";
      failures.push({
        code: "TONNAGE_EXCEEDED",
        message: `${forceLabel} ${estimatedTonnage}t exceeds machine capacity (${realCapability.maxTonnage}t, incl. 15% margin)`,
      });
    }

    // Confidence reflects how real the underlying data is — a class-wide
    // default guess must never be reported as confidently as an imported,
    // machine-specific spec, even though both take this same code path.
    const confidence: "high" | "medium" | "low" =
      capabilitySource === "seed" ? "medium" :
      capabilitySource === "default_class" ? "low" :
      "high"; // 'imported', or unspecified (caller vouches for the data)
    const reasons = failures.map((f) => f.message);
    if (capabilitySource === "seed") {
      reasons.push("Capability from model seed data — verify against machine plate");
    } else if (capabilitySource === "default_class") {
      reasons.push("No capability on file for this machine — conservative class defaults applied");
    }

    return {
      capable: failures.length === 0,
      confidence,
      reasonCodes: failures.map((f) => f.code),
      reasons,
      estimatedTonnage,
    };
  }

  // No commodity code → specific machine unknown
  if (!commodityCode) {
    return {
      capable: failures.length === 0,
      confidence: "low",
      reasonCodes: failures.length > 0
        ? failures.map((f) => f.code)
        : ["NO_MACHINE_SELECTED"],
      reasons: failures.length > 0
        ? failures.map((f) => f.message)
        : ["No specific machine selected — assumed capable"],
      estimatedTonnage,
    };
  }

  const entry = MACHINE_CAPABILITY_REGISTRY[commodityCode];

  // Code not in registry — geometry available but no spec on file
  if (!entry) {
    return {
      capable: failures.length === 0,
      confidence: "medium",
      reasonCodes: failures.length > 0
        ? failures.map((f) => f.code)
        : ["SPEC_NOT_ON_FILE"],
      reasons: failures.length > 0
        ? failures.map((f) => f.message)
        : ["Machine spec not on file — assumed capable"],
      estimatedTonnage,
    };
  }

  const { spec } = entry;
  if (spec.maxThicknessMm != null && geometry.sheetThicknessMm > spec.maxThicknessMm) {
    failures.push({ code: "THICKNESS_EXCEEDED", message: `Thickness ${geometry.sheetThicknessMm}mm exceeds machine limit (${spec.maxThicknessMm}mm)` });
  }
  if (spec.maxBedLengthMm != null && geometry.flatPatternLengthMm != null && geometry.flatPatternLengthMm > spec.maxBedLengthMm) {
    failures.push({ code: "BED_LENGTH_EXCEEDED", message: `Part length ${geometry.flatPatternLengthMm}mm exceeds machine bed (${spec.maxBedLengthMm}mm)` });
  }
  if (spec.maxBedWidthMm != null && geometry.flatPatternWidthMm != null && geometry.flatPatternWidthMm > spec.maxBedWidthMm) {
    failures.push({ code: "BED_WIDTH_EXCEEDED", message: `Part width ${geometry.flatPatternWidthMm}mm exceeds machine bed (${spec.maxBedWidthMm}mm)` });
  }
  if (estimatedTonnage != null && spec.maxTonnage != null && estimatedTonnage > spec.maxTonnage) {
    const forceLabel = machineClass === "turret_punch" ? "Estimated punch force" : "Estimated bend force";
    failures.push({
      code: "TONNAGE_EXCEEDED",
      message: `${forceLabel} ${estimatedTonnage}t exceeds machine capacity (${spec.maxTonnage}t)`,
    });
  }

  return {
    capable: failures.length === 0,
    confidence: "high",
    reasonCodes: failures.map((f) => f.code),
    reasons: failures.map((f) => f.message),
    estimatedTonnage,
  };
}
