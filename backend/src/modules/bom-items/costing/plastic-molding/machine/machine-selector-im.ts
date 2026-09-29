// IM press capability — the physical constraints a press must meet for a part.
// Failure at any constraint = not capable (the reasons say which).
// 1. Clamp force:   the reference clamp model (clamp-force.ts): projected area × cavities ×
//                   cavity pressure (flow class of the material) × clampForceSafetyFactor
// 2. Shot capacity: GPPS-equivalent grams per cavity × cavities (shot-size.ts) ≤ the
//                   press shot size (rated in GPPS grams)
// 3. Tie-bar spacing: (partLength + 45mm) ≤ tieBarX && (partWidth + 45mm) ≤ tieBarY; 90° rotation allowed
// 4. Daylight:     minMoldHeight ≤ estimatedToolHeight ≤ maxMoldHeight (skip if no data)
//
// Which capable press a route uses is decided by cost, not a score: the caller
// runs the cost engine for each capable press in a tier and keeps the cheapest
// (bom-items.service getRouteComparison).

import type { MachineCandidate } from '../../../dto/machine-selection.dto';
import { IM_TIEBAR_ADDEND_MM } from '../../shared/capability/machine-selection/physics';
import { requiredClampForce, type MaterialClampProperties, type RunnerSystem } from '../clamp-force';
import type { ClampModel } from '../plastic-reference';

export interface IMSelectionRequirements {
  projectedAreaMm2: number | null;      // null = no clamp force derivable: the machine is not sized
  cavityCount: number;
  /** GPPS-equivalent grams one cavity needs (shot-size.ts); null = not derivable. */
  shotGppsGPerCavity: number | null;
  /** The material's reference clamp properties and label (for the reason text). */
  material: MaterialClampProperties;
  materialLabel: string;
  runner: RunnerSystem;
  partLengthMm: number | null;          // bbox largest dimension (tie-bar long axis)
  partWidthMm: number | null;           // bbox second dimension (tie-bar short axis)
  partHeightMm: number | null;          // bbox third dimension (min) — not used for tie-bar
  estimatedToolHeightMm: number | null; // null = skip daylight check
  /** Staged clamp model (plastic-reference.ts). */
  clampModel: ClampModel;
}

export interface IMCandidateEvaluation {
  candidate: MachineCandidate;
  capable: boolean;
  blockReasons: string[];
  clampRequiredT: number | null;
  clampMachineT: number | null;
  clampUtil: number | null;             // requiredClamp / machineClamp, 0–1
  shotRequiredG: number | null;
  shotMachineG: number | null;
  shotUtil: number | null;
}

export function evaluateIMCandidate(
  candidate: MachineCandidate,
  req: IMSelectionRequirements,
): IMCandidateEvaluation {
  const cap = candidate.capability;
  const blockReasons: string[] = [];

  // ── 1. Clamp force (reference model; not derivable = not sized) ─────────
  let clampRequiredT: number | null = null;
  let clampUtil: number | null = null;
  const clamp = requiredClampForce({
    model: req.clampModel, material: req.material, materialLabel: req.materialLabel,
    projectedAreaMm2: req.projectedAreaMm2 ?? 0, cavityCount: req.cavityCount, runner: req.runner,
  });
  if (!clamp.derivable) {
    blockReasons.push(clamp.reason);
  } else {
    clampRequiredT = clamp.requiredTonnes;
    const machineClampT = cap.maxTonnage;
    if (machineClampT == null || machineClampT < clampRequiredT) {
      blockReasons.push(
        `Clamp: need ${clampRequiredT.toFixed(0)}T, machine has ${machineClampT ?? '?'}T`,
      );
    } else {
      clampUtil = clampRequiredT / machineClampT;
    }
  }

  // ── 2. Shot capacity (GPPS-equivalent grams, shot-size.ts) ─────────────────
  const shotRequiredG = req.shotGppsGPerCavity != null ? req.shotGppsGPerCavity * req.cavityCount : null;
  let shotUtil: number | null = null;
  const machineShotG = cap.shotCapacityGrams;
  if (shotRequiredG == null) {
    blockReasons.push('Shot size not derivable: the material has no reference melt density (migration 831).');
  } else if (machineShotG == null) {
    blockReasons.push('Shot: the press has no shot size on file.');
  } else {
    if (machineShotG < shotRequiredG) {
      blockReasons.push(
        `Shot: need ${shotRequiredG.toFixed(0)}g, machine has ${machineShotG}g`,
      );
    } else {
      shotUtil = shotRequiredG / machineShotG;
    }
  }

  // ── 3. Tie-bar spacing ────────────────────────────────────────────────────
  // Required clearance = part footprint + runner allowance + platen-to-tie-bar clearance.
  // Additive (+45mm total), not proportional — runner thickness is fixed regardless of part size.
  // Mold can be rotated 90° on the platen — accept either orientation.
  const hasTieBars = cap.tieBarXMm != null && cap.tieBarYMm != null;
  const hasFootprint = req.partLengthMm != null && req.partWidthMm != null;
  if (hasTieBars && hasFootprint) {
    const reqL = req.partLengthMm! + IM_TIEBAR_ADDEND_MM;
    const reqW = req.partWidthMm!  + IM_TIEBAR_ADDEND_MM;
    const tieX = cap.tieBarXMm!;
    const tieY = cap.tieBarYMm!;
    const fitsNormal  = reqL <= tieX && reqW <= tieY;
    const fitsRotated = reqL <= tieY && reqW <= tieX;
    if (!fitsNormal && !fitsRotated) {
      blockReasons.push(
        `Tie-bar: part + runner ${reqL.toFixed(0)}×${reqW.toFixed(0)}mm exceeds machine ${tieX}×${tieY}mm`,
      );
    }
  }

  // ── 4. Daylight / mold height ─────────────────────────────────────────────
  if (req.estimatedToolHeightMm != null) {
    if (cap.minMoldHeightMm != null && req.estimatedToolHeightMm < cap.minMoldHeightMm) {
      blockReasons.push(
        `Daylight: tool ${req.estimatedToolHeightMm}mm < machine min ${cap.minMoldHeightMm}mm`,
      );
    }
    if (cap.maxMoldHeightMm != null && req.estimatedToolHeightMm > cap.maxMoldHeightMm) {
      blockReasons.push(
        `Daylight: tool ${req.estimatedToolHeightMm}mm > machine max ${cap.maxMoldHeightMm}mm`,
      );
    }
  }

  const capable = blockReasons.length === 0;

  return {
    candidate,
    capable,
    blockReasons,
    clampRequiredT: clampRequiredT ? Math.round(clampRequiredT) : null,
    clampMachineT: cap.maxTonnage,
    clampUtil,
    shotRequiredG: shotRequiredG != null ? Math.round(shotRequiredG) : null,
    shotMachineG: machineShotG,
    shotUtil,
  };
}

// ── Tier definitions ──────────────────────────────────────────────────────────
// Three press size classes the route comparison shows side by side (a display
// grouping of the real press pool, not a cost input).
export const IM_TIERS = [
  { id: 'small',    label: 'Small Press',    minT: 0,   maxT: 120  },
  { id: 'medium',   label: 'Standard Press', minT: 121, maxT: 350  },
  { id: 'large',    label: 'Large Press',    minT: 351, maxT: 9999 },
] as const;

export type IMTierId = typeof IM_TIERS[number]['id'];

export interface IMTierResult {
  tierId: IMTierId;
  tierLabel: string;
  /** Every real press in the tier: capable ones first, then by clamp tonnage, largest first. */
  candidates: IMCandidateEvaluation[];
}

export function selectIMmachinesByTier(
  pool: MachineCandidate[],
  req: IMSelectionRequirements,
): IMTierResult[] {
  const evaluated = pool.filter((c) => c.machineClass === 'injection_molding').map((c) => evaluateIMCandidate(c, req));
  return IM_TIERS.map((tier) => ({
    tierId: tier.id,
    tierLabel: tier.label,
    candidates: evaluated
      .filter((e) => {
        const t = e.candidate.capability.maxTonnage;
        return t != null && t >= tier.minT && t <= tier.maxT;
      })
      .sort((a, b) => (a.capable !== b.capable ? (a.capable ? -1 : 1) : (b.candidate.capability.maxTonnage ?? 0) - (a.candidate.capability.maxTonnage ?? 0))),
  }));
}
