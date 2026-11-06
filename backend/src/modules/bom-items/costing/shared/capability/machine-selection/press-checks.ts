// Formula registry (plastic-molding/formula-registry.ts): F-11. Change a formula or its constants -> bump its version there.
// Whether an injection press can run a part: the ONE rule. The shared machine selector (isCapable, which picks the press for the Cost Summary) and the
// plastic tier evaluator (which prices a press per size class in the Route Comparison) both call checkPress, so a press is capable in one view exactly
// when it is capable in the other. The reason text lives here too, so what the user is told is what was tested.
//
//   1. Clamp:    the press's tonnage covers the reference clamp force (which already carries its safety factor)
//   2. Shot:     the press's shot size (GPPS grams) covers one cavity's shot
//   3. Tie-bars: part + runner allowance fits between the tie-bars, the mold may be turned 90 degrees
//   4. Daylight: the mold height fits between the press's minimum and maximum (skipped when the tool height is not estimated)
// A need that cannot be derived, or a press value that is not on file, is not capable: nothing is passed unchecked.
import { IM_TIEBAR_ADDEND_MM } from './physics';

/** What the part asks of a press. `null` means not derivable. */
export interface PressNeeds {
  /** Reference clamp force for the cavities, tonnes. */
  clampTonnageRequired: number | null;
  clampNotDerivableReason: string | null;
  /** The shot the cavities need, in GPPS grams (the unit a press's shot size is rated in). */
  shotGppsG: number | null;
  partLengthMm: number | null;
  partWidthMm: number | null;
  /** Estimated tool height; null skips the daylight check. */
  estimatedToolHeightMm: number | null;
}

/** The press values the rule reads (a subset of the machine's capability). */
export interface PressCapability {
  maxTonnage: number | null;
  shotCapacityGrams: number | null;
  tieBarXMm: number | null;
  tieBarYMm: number | null;
  minMoldHeightMm: number | null;
  maxMoldHeightMm: number | null;
}

/** The mold is estimated as the part's longest side plus this tooling allowance (conservative); unknown when the part's size is. */
export const IM_TOOL_HEIGHT_ALLOWANCE_MM = 100;
export function estimatedToolHeightMm(largestSideMm: number): number | null {
  return largestSideMm > 0 ? largestSideMm + IM_TOOL_HEIGHT_ALLOWANCE_MM : null;
}

export const SHOT_NOT_DERIVABLE_REASON = 'Shot size not derivable: the material has no reference melt density (migration 831).';

export interface PressChecks {
  capable: boolean;
  /** Why not, one entry per failed check, in the order above. Empty when capable. */
  reasons: string[];
  /** The clamp force the part needs and how much of the press it uses (0-1); null when not derivable or the press is too small. */
  clampRequiredT: number | null;
  clampUtil: number | null;
  shotRequiredG: number | null;
  shotUtil: number | null;
}

export function checkPress(cap: PressCapability, need: PressNeeds): PressChecks {
  const reasons: string[] = [];

  let clampUtil: number | null = null;
  if (need.clampTonnageRequired == null) {
    reasons.push(need.clampNotDerivableReason ?? 'Clamp force not derivable.');
  } else if (cap.maxTonnage == null || cap.maxTonnage < need.clampTonnageRequired) {
    reasons.push(`Clamp: need ${need.clampTonnageRequired.toFixed(0)}T, machine has ${cap.maxTonnage ?? '?'}T`);
  } else {
    clampUtil = need.clampTonnageRequired / cap.maxTonnage;
  }

  let shotUtil: number | null = null;
  if (need.shotGppsG == null) {
    reasons.push(SHOT_NOT_DERIVABLE_REASON);
  } else if (cap.shotCapacityGrams == null) {
    reasons.push('Shot: the press has no shot size on file.');
  } else if (cap.shotCapacityGrams < need.shotGppsG) {
    reasons.push(`Shot: need ${need.shotGppsG.toFixed(0)}g, machine has ${cap.shotCapacityGrams}g`);
  } else {
    shotUtil = need.shotGppsG / cap.shotCapacityGrams;
  }

  // Required clearance: part footprint + runner allowance + platen-to-tie-bar clearance (additive: the runner is the same thickness whatever the part).
  if (cap.tieBarXMm != null && cap.tieBarYMm != null && need.partLengthMm != null && need.partWidthMm != null) {
    const reqL = need.partLengthMm + IM_TIEBAR_ADDEND_MM;
    const reqW = need.partWidthMm + IM_TIEBAR_ADDEND_MM;
    const fitsNormal = reqL <= cap.tieBarXMm && reqW <= cap.tieBarYMm;
    const fitsRotated = reqL <= cap.tieBarYMm && reqW <= cap.tieBarXMm;
    if (!fitsNormal && !fitsRotated) reasons.push(`Tie-bar: part + runner ${reqL.toFixed(0)}×${reqW.toFixed(0)}mm exceeds machine ${cap.tieBarXMm}×${cap.tieBarYMm}mm`);
  }

  if (need.estimatedToolHeightMm != null) {
    if (cap.minMoldHeightMm != null && need.estimatedToolHeightMm < cap.minMoldHeightMm) {
      reasons.push(`Daylight: tool ${need.estimatedToolHeightMm}mm < machine min ${cap.minMoldHeightMm}mm`);
    }
    if (cap.maxMoldHeightMm != null && need.estimatedToolHeightMm > cap.maxMoldHeightMm) {
      reasons.push(`Daylight: tool ${need.estimatedToolHeightMm}mm > machine max ${cap.maxMoldHeightMm}mm`);
    }
  }

  return {
    capable: reasons.length === 0,
    reasons,
    clampRequiredT: need.clampTonnageRequired,
    clampUtil,
    shotRequiredG: need.shotGppsG,
    shotUtil,
  };
}
