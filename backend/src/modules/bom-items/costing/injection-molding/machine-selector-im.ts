// IM machine selection — aPriori-style 4-constraint algorithm.
// Constraints evaluated in order; failure at any constraint = reject.
// 1. Clamp force:  requiredClamp = projectedAreaCm2 × cavityCount × materialClampFactor × 1.15
// 2. Shot capacity: requiredShot = (partWeightG + runnerWeightG) × cavityCount × 1.10
// 3. Tie-bar spacing: (partLength + 45mm) ≤ tieBarX && (partWidth + 45mm) ≤ tieBarY; 90° rotation allowed
// 4. Daylight:     minMoldHeight ≤ estimatedToolHeight ≤ maxMoldHeight (skip if no data)
//
// Scoring (0–1): 0.5 × clampUtil + 0.3 × shotUtil + 0.2 × costScore
// Target: clampUtil 60–85%, shotUtil 30–80%.
// Returns top 3 by score; always returns at least one (cheapest capable fallback).

import type { MachineCandidate } from '../../dto/machine-selection.dto';
import { IM_TIEBAR_ADDEND_MM } from '../machine-selection/physics';

// ── Clamp factors ─────────────────────────────────────────────────────────────
// Mid-point of the range from the user specification + industry data.
// Keys must be uppercase substrings of common grade tokens.
// Sources: SPI/PLASTICS industry guide, Rosato "Injection Molding Handbook" 3rd ed.,
// Brydson "Plastics Materials" 7th ed., Griff "Plastics Extrusion Technology".
// All values = mid-point of published range; safety margin of 1.15 applied at call site.
// Order matters — most specific / longest tokens MUST come before substrings they contain.
// Rule: if token A is a substring of token B, token B's entry must appear first.
// Examples: PA66GF > PA66 > PA6 > PA; PP GF > PP; PBT GF > PBT; PC GF > PC.
const IM_CLAMP_FACTORS: Array<{ tokens: string[]; factor: number }> = [
  // ── Glass / mineral filled (FIRST — these contain their base polymer as substring) ──
  { tokens: ['PA66GF', 'PA66 GF', 'PA 66 GF', 'PA66-GF', 'NYLON GF', 'PA GF', 'PAGF'], factor: 0.90 },
  { tokens: ['PBT GF', 'PBTGF', 'PBT+GF', 'PBT GF30', 'PBT-GF'],                    factor: 0.80 },
  { tokens: ['PC GF', 'PCGF', 'PC+GF', 'PC-GF30'],                                   factor: 0.80 },
  { tokens: ['PP GF', 'PPGF', 'PP+GF', 'PP-GF'],                                      factor: 0.58 },
  { tokens: ['GF30', 'GF15', 'GF20', 'GF40', 'GLASS FILLED', 'GLASS REINFORCED'],    factor: 0.78 },

  // ── Thermoset / elastomers (unique tokens, no base-polymer overlap) ──────────
  { tokens: ['LSR', 'LIQUID SILICONE', 'SILICONE', 'VMQ', 'MVQ', 'FVMQ', 'SILASTIC'], factor: 0.28 },
  { tokens: ['TPU', 'TPE', 'TPV', 'SANTOPRENE', 'HYTREL', 'PEBAX'],                   factor: 0.35 },

  // ── Polyolefins ───────────────────────────────────────────────────────────────
  { tokens: ['PP', 'POLYPROPYLENE', 'HDPE', 'LDPE', 'LLDPE', 'MDPE'],                 factor: 0.40 },
  { tokens: ['PE', 'POLYETHYLENE'],                                                     factor: 0.40 },

  // ── Styrenics / commodity ─────────────────────────────────────────────────────
  { tokens: ['ABS', 'CYCOLAC', 'TERLURAN'],                                            factor: 0.52 },
  { tokens: ['HIPS', 'GPPS', 'SAN', 'AS RESIN'],                                      factor: 0.48 },
  { tokens: ['PS', 'POLYSTYRENE'],                                                      factor: 0.48 },

  // ── PVC variants (UPVC/FPVC before generic PVC) ───────────────────────────────
  { tokens: ['UPVC', 'RPVC', 'RIGID PVC'],                                             factor: 0.65 },
  { tokens: ['FPVC', 'FLEXIBLE PVC', 'SPVC', 'PVCA'],                                 factor: 0.45 },
  { tokens: ['PVC', 'POLYVINYL'],                                                       factor: 0.60 },

  // ── Engineering polymers — more specific before substrings ────────────────────
  // PA66 before PA6 (PA66 contains "PA6"); PA6 before generic PA.
  { tokens: ['PA66', 'PA 66', 'NYLON66', 'NYLON 66', 'ZYTEL', 'ULTRAMID A'],          factor: 0.65 },
  { tokens: ['PA6', 'NYLON 6', 'NYLON6', 'POLYAMIDE 6', 'PA-6'],                      factor: 0.60 },
  { tokens: ['PA', 'NYLON', 'POLYAMIDE'],                                               factor: 0.62 },
  { tokens: ['POM', 'ACETAL', 'DELRIN', 'HOSTAFORM', 'CELCON'],                       factor: 0.62 },
  { tokens: ['PC', 'POLYCARBONATE', 'LEXAN', 'MAKROLON', 'CALIBRE'],                  factor: 0.68 },
  { tokens: ['PBT', 'POLYBUTYLENE TEREPHTHALATE', 'VALOX', 'CELANEX'],                factor: 0.68 },
  { tokens: ['PET', 'POLYETHYLENE TEREPHTHALATE', 'RYNITE'],                           factor: 0.68 },
  { tokens: ['PMMA', 'ACRYLIC', 'PLEXIGLAS', 'PERSPEX'],                              factor: 0.55 },
  { tokens: ['PPO', 'PPE', 'NORYL'],                                                    factor: 0.60 },

  // ── High-performance / specialty ──────────────────────────────────────────────
  { tokens: ['PEI', 'ULTEM', 'POLYETHERIMIDE'],                                        factor: 0.90 },
  { tokens: ['PEEK', 'POLYETHER ETHER KETONE', 'VICTREX'],                             factor: 0.90 },
  { tokens: ['PPS', 'POLYPHENYLENE SULFIDE', 'RYTON', 'FORTRON'],                     factor: 0.90 },
  { tokens: ['LCP', 'LIQUID CRYSTAL POLYMER', 'VECTRA', 'XYDAR'],                     factor: 0.95 },
  { tokens: ['PSU', 'POLYSULFONE', 'UDEL'],                                            factor: 0.75 },
  { tokens: ['PES', 'POLYETHERSULFONE'],                                                factor: 0.75 },
];

export function resolveMaterialClampFactor(grade: string | null): number {
  const g = (grade ?? '').toUpperCase();
  for (const entry of IM_CLAMP_FACTORS) {
    if (entry.tokens.some((t) => g.includes(t))) return entry.factor;
  }
  return 0.65; // mid-range engineering plastic default (matches cost-engine pressure factor)
}

export interface IMSelectionRequirements {
  projectedAreaMm2: number | null;      // null = unknown, skip clamp check
  cavityCount: number;
  partVolumeMm3: number;
  runnerVolumeMm3: number;              // estimated; 0 = hot runner
  materialDensityKgM3: number;
  materialGrade: string | null;
  partLengthMm: number | null;          // bbox largest dimension (tie-bar long axis)
  partWidthMm: number | null;           // bbox second dimension (tie-bar short axis)
  partHeightMm: number | null;          // bbox third dimension (min) — not used for tie-bar
  estimatedToolHeightMm: number | null; // null = skip daylight check
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
  score: number;                        // 0–1 composite
}

export function evaluateIMCandidate(
  candidate: MachineCandidate,
  req: IMSelectionRequirements,
): IMCandidateEvaluation {
  const cap = candidate.capability;
  const blockReasons: string[] = [];

  // ── 1. Clamp force ────────────────────────────────────────────────────────
  const materialFactor = resolveMaterialClampFactor(req.materialGrade);
  let clampRequiredT: number | null = null;
  let clampUtil: number | null = null;
  if (req.projectedAreaMm2 != null && req.projectedAreaMm2 > 0) {
    const projAreaCm2 = req.projectedAreaMm2 / 100;
    clampRequiredT = projAreaCm2 * req.cavityCount * materialFactor * 1.15;
    const machineClampT = cap.maxTonnage;
    if (machineClampT == null || machineClampT < clampRequiredT) {
      blockReasons.push(
        `Clamp: need ${clampRequiredT.toFixed(0)}T, machine has ${machineClampT ?? '?'}T`,
      );
    } else {
      clampUtil = clampRequiredT / machineClampT;
    }
  }

  // ── 2. Shot capacity ──────────────────────────────────────────────────────
  const densityGcm3 = req.materialDensityKgM3 / 1000;
  const partVolumeCm3 = req.partVolumeMm3 / 1000;
  const runnerVolumeCm3 = req.runnerVolumeMm3 / 1000;
  const partWeightG = partVolumeCm3 * densityGcm3;
  const runnerWeightG = runnerVolumeCm3 * densityGcm3;
  const shotRequiredG = (partWeightG + runnerWeightG) * req.cavityCount * 1.10;
  let shotUtil: number | null = null;
  const machineShotG = cap.shotCapacityGrams;
  if (machineShotG != null) {
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

  // ── Scoring ───────────────────────────────────────────────────────────────
  // Target: clampUtil 60-85% (sweet spot 0.725), shotUtil 30-80% (sweet spot 0.55).
  // Machines far above or below are penalised; best score at sweet spot.
  function utilScore(util: number | null, sweetSpot: number): number {
    if (util == null) return 0.5; // unknown = neutral
    // Gaussian-like: peak at sweetSpot, falls toward 0 at extremes
    const dev = Math.abs(util - sweetSpot);
    return Math.max(0, 1 - dev * 2);
  }

  const clampScore = utilScore(clampUtil, 0.725);
  const shotScore  = utilScore(shotUtil, 0.55);
  const maxRate = 500; // normalise cost: rates > 500 score near 0
  const costScore = Math.max(0, 1 - candidate.hourlyRate / maxRate);

  const score = capable
    ? 0.5 * clampScore + 0.3 * shotScore + 0.2 * costScore
    : 0;

  return {
    candidate,
    capable,
    blockReasons,
    clampRequiredT: clampRequiredT ? Math.round(clampRequiredT) : null,
    clampMachineT: cap.maxTonnage,
    clampUtil,
    shotRequiredG: Math.round(shotRequiredG),
    shotMachineG: machineShotG,
    shotUtil,
    score,
  };
}

// ── Tier definitions ──────────────────────────────────────────────────────────
// Three size classes used for route comparison. Each tier picks the best-scoring
// DB machine within its tonnage range; falls back to a synthetic class record
// (built by the caller) when no DB machine exists in that tier.
export const IM_TIERS = [
  { id: 'small',    label: 'Small Press',    minT: 0,   maxT: 120  },
  { id: 'medium',   label: 'Standard Press', minT: 121, maxT: 350  },
  { id: 'large',    label: 'Large Press',    minT: 351, maxT: 9999 },
] as const;

export type IMTierId = typeof IM_TIERS[number]['id'];

export interface IMTierResult {
  tierId: IMTierId;
  tierLabel: string;
  evaluation: IMCandidateEvaluation | null;  // null = no DB machine for this tier
  syntheticTonnageT: number;                 // canonical tonnage to use if DB is absent
}

export function selectIMmachinesByTier(
  pool: MachineCandidate[],
  req: IMSelectionRequirements,
): IMTierResult[] {
  const imCandidates = pool.filter((c) => c.machineClass === 'injection_molding');
  const evaluated = imCandidates.map((c) => evaluateIMCandidate(c, req));

  return IM_TIERS.map((tier) => {
    const inTier = evaluated
      .filter((e) => {
        const t = e.candidate.capability.maxTonnage;
        return t != null && t >= tier.minT && t <= tier.maxT;
      })
      .sort((a, b) => {
        // Capable machines first, then by score desc
        if (a.capable !== b.capable) return a.capable ? -1 : 1;
        return b.score - a.score;
      });

    // Canonical fallback tonnage = midpoint of tier, rounded to nearest 50T
    const syntheticTonnageT =
      tier.id === 'small'  ? 100  :
      tier.id === 'medium' ? 200  : 500;

    return {
      tierId: tier.id,
      tierLabel: tier.label,
      evaluation: inTier[0] ?? null,
      syntheticTonnageT,
    };
  });
}

// Legacy flat selector — kept for callers that don't need tier structure
export function selectIMmachines(
  pool: MachineCandidate[],
  req: IMSelectionRequirements,
): IMCandidateEvaluation[] {
  const tiers = selectIMmachinesByTier(pool, req);
  const result = tiers
    .map((t) => t.evaluation)
    .filter((e): e is IMCandidateEvaluation => e !== null);

  if (result.length === 0) {
    // No DB machines at all — return empty so caller triggers synthetic fallback
    return [];
  }
  return result;
}
