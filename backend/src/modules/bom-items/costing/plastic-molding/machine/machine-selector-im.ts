// The press tiers of the Route Comparison. Whether a press is capable is the shared rule in shared/capability/machine-selection/press-checks.ts (clamp,
// shot, tie-bars, daylight), the same one the Cost Summary's press selection uses; this module derives the clamp force the part needs from the
// reference model and groups the presses into size classes.
//
// Which capable press a route uses is decided by cost, not a score: the caller
// runs the cost engine for each capable press in a tier and keeps the cheapest
// (bom-items.service getRouteComparison).

import type { MachineCandidate } from '../../../dto/machine-selection.dto';
import { checkPress } from '../../shared/capability/machine-selection/press-checks';
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

interface IMCandidateEvaluation {
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
  // The clamp the part needs comes from the reference model; whether this press meets it, the shot, tie-bars and daylight are the one shared rule.
  const clamp = requiredClampForce({
    model: req.clampModel, material: req.material, materialLabel: req.materialLabel,
    projectedAreaMm2: req.projectedAreaMm2 ?? 0, cavityCount: req.cavityCount, runner: req.runner,
  });
  const shotRequiredG = req.shotGppsGPerCavity != null ? req.shotGppsGPerCavity * req.cavityCount : null;
  const checks = checkPress(cap, {
    clampTonnageRequired: clamp.derivable ? clamp.requiredTonnes : null,
    clampNotDerivableReason: clamp.derivable ? null : clamp.reason,
    shotGppsG: shotRequiredG,
    partLengthMm: req.partLengthMm,
    partWidthMm: req.partWidthMm,
    estimatedToolHeightMm: req.estimatedToolHeightMm,
  });

  return {
    candidate,
    capable: checks.capable,
    blockReasons: checks.reasons,
    clampRequiredT: checks.clampRequiredT ? Math.round(checks.clampRequiredT) : null,
    clampMachineT: cap.maxTonnage,
    clampUtil: checks.clampUtil,
    shotRequiredG: shotRequiredG != null ? Math.round(shotRequiredG) : null,
    shotMachineG: cap.shotCapacityGrams,
    shotUtil: checks.shotUtil,
  };
}

// ── Tier definitions ──────────────────────────────────────────────────────────
// Three press size classes the route comparison shows side by side (a display
// grouping of the real press pool, not a cost input).
const IM_TIERS = [
  { id: 'small',    label: 'Small Press',    minT: 0,   maxT: 120  },
  { id: 'medium',   label: 'Standard Press', minT: 121, maxT: 350  },
  { id: 'large',    label: 'Large Press',    minT: 351, maxT: 9999 },
] as const;

type IMTierId = typeof IM_TIERS[number]['id'];

interface IMTierResult {
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
