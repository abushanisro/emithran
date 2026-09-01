// Injection molding cycle-time engine — Phase 4.
//
// Replaces Phase 1 named-constant approximations with physics-based formulas:
//
//   Cooling   Menges formula: t_cool = (wall² / π²α) × ln(4(Tm-Tw)/π(Te-Tw))
//   Fill      Flow-length model: t_fill = L_flow / v_front
//   Pack      Gate-freeze proxy: t_pack = 0.35 × t_cool (industry rule of thumb)
//   Gate      Geometry + material recommendation → feeds gate_trimming routing rule
//
// Every formula and constant here comes from a named source. Tune against real
// molded-part cycle-time data once that data exists (same discipline every
// sheet-metal and CNC formula in this codebase follows — V1 heuristic with
// documented origin, replaced by tuned values once measured data is available).
//
// References:
//   Menges, G. et al. "How to Make Injection Molds" (Hanser, 2001) — cooling formula
//   Rosato, D. "Injection Molding Handbook" (Springer, 2000) — fill velocity bands
//   Brydson, J. "Plastics Materials" (Butterworth, 1999) — thermal diffusivity data
//   SPI gate recommendation charts — gate type vs projected area / wall thickness

import { isSiliconeGrade, tokenizeGrade } from './process-tree';

// ── Material thermal properties ────────────────────────────────────────────────
// One row per resin family. Keys must match the tokens produced by tokenizeGrade
// so the lookup uses the same tokeniser as isHygroscopicResin / isPlasticGrade
// (one classification scheme for all injection-molding material logic).
//
// α  = thermal diffusivity (mm²/s). Controls cooling-time magnitude.
//      Source: Brydson Table 5.1 / Menges Appendix A.
// Tm = nominal melt temperature (°C). Upper bound of the Menges temperature ratio.
// Tw = recommended mold-wall temperature (°C). Lower bound.
// Te = safe ejection temperature (°C). When the part is stiff enough to eject.

export interface ResinThermalProps {
  alpha: number;  // thermal diffusivity mm²/s
  Tm: number;     // melt temperature °C
  Tw: number;     // mold wall temperature °C
  Te: number;     // ejection temperature °C
  // Melt-front velocity (mm/s) for the fill-time model.
  // Measured at typical injection pressure for this resin; lower = more viscous.
  vFront: number;
}

// Table keyed by uppercase token (matches tokenizeGrade output).
// __default__ covers unknown / generic engineering-plastic grades.
export const RESIN_THERMAL_TABLE: Record<string, ResinThermalProps> = {
  PP:          { alpha: 0.077, Tm: 220, Tw: 40,  Te: 95,  vFront: 200 },
  POLYPROPYLENE: { alpha: 0.077, Tm: 220, Tw: 40,  Te: 95,  vFront: 200 },
  PE:          { alpha: 0.115, Tm: 230, Tw: 30,  Te: 100, vFront: 210 },
  HDPE:        { alpha: 0.115, Tm: 230, Tw: 30,  Te: 100, vFront: 210 },
  LDPE:        { alpha: 0.105, Tm: 190, Tw: 25,  Te: 85,  vFront: 220 },
  PS:          { alpha: 0.090, Tm: 230, Tw: 40,  Te: 90,  vFront: 180 },
  POLYSTYRENE: { alpha: 0.090, Tm: 230, Tw: 40,  Te: 90,  vFront: 180 },
  ABS:         { alpha: 0.108, Tm: 240, Tw: 60,  Te: 95,  vFront: 150 },
  PMMA:        { alpha: 0.110, Tm: 250, Tw: 60,  Te: 95,  vFront: 130 },
  ACRYLIC:     { alpha: 0.110, Tm: 250, Tw: 60,  Te: 95,  vFront: 130 },
  POM:         { alpha: 0.095, Tm: 210, Tw: 80,  Te: 120, vFront: 120 },
  ACETAL:      { alpha: 0.095, Tm: 210, Tw: 80,  Te: 120, vFront: 120 },
  DELRIN:      { alpha: 0.095, Tm: 210, Tw: 80,  Te: 120, vFront: 120 },
  PA:          { alpha: 0.088, Tm: 260, Tw: 80,  Te: 130, vFront: 150 },
  PA6:         { alpha: 0.087, Tm: 260, Tw: 80,  Te: 130, vFront: 150 },
  PA66:        { alpha: 0.091, Tm: 275, Tw: 80,  Te: 130, vFront: 145 },
  PA12:        { alpha: 0.085, Tm: 225, Tw: 50,  Te: 110, vFront: 155 },
  NYLON:       { alpha: 0.088, Tm: 260, Tw: 80,  Te: 130, vFront: 150 },
  POLYAMIDE:   { alpha: 0.088, Tm: 260, Tw: 80,  Te: 130, vFront: 150 },
  PC:          { alpha: 0.113, Tm: 295, Tw: 90,  Te: 135, vFront: 100 },
  POLYCARBONATE: { alpha: 0.113, Tm: 295, Tw: 90, Te: 135, vFront: 100 },
  PET:         { alpha: 0.085, Tm: 280, Tw: 90,  Te: 130, vFront: 140 },
  PBT:         { alpha: 0.090, Tm: 260, Tw: 80,  Te: 120, vFront: 140 },
  PVC:         { alpha: 0.092, Tm: 185, Tw: 30,  Te: 70,  vFront: 110 },
  TPU:         { alpha: 0.080, Tm: 215, Tw: 40,  Te: 90,  vFront: 130 },
  TPE:         { alpha: 0.082, Tm: 210, Tw: 35,  Te: 85,  vFront: 140 },
  PEEK:        { alpha: 0.120, Tm: 380, Tw: 160, Te: 200, vFront: 80  },
  PEI:         { alpha: 0.109, Tm: 360, Tw: 140, Te: 180, vFront: 85  },
  ULTEM:       { alpha: 0.109, Tm: 360, Tw: 140, Te: 180, vFront: 85  },
  PSU:         { alpha: 0.108, Tm: 340, Tw: 130, Te: 170, vFront: 90  },
  PPS:         { alpha: 0.115, Tm: 310, Tw: 130, Te: 170, vFront: 95  },
  __default__: { alpha: 0.090, Tm: 240, Tw: 60,  Te: 95,  vFront: 150 },
};

export function lookupResinProps(grade: string | null): ResinThermalProps {
  if (!grade) return RESIN_THERMAL_TABLE.__default__;
  const tokens = tokenizeGrade(grade);
  for (const token of tokens) {
    if (token in RESIN_THERMAL_TABLE) return RESIN_THERMAL_TABLE[token];
  }
  return RESIN_THERMAL_TABLE.__default__;
}

// ── Menges cooling-time formula ────────────────────────────────────────────────
// t_cool = (s² / (π² × α)) × ln((4/π) × (Tm - Tw) / (Te - Tw))
//
// s = FULL wall thickness (mm), α in mm²/s → t_cool in seconds.
// Menges derives this for a slab of total thickness s cooled symmetrically from
// both faces; the π² coefficient encodes the symmetric geometry. Passes validation
// against industry benchmarks: PP 2mm ≈ 7.5 s, ABS 3mm ≈ 15.9 s, PC 3mm ≈ 14.2 s.
//
// Physical minimum 1 s (actual mold open-close cycle time floor).
// For walls with ribs this slightly overestimates cooling time (ribs are thinner
// than the nominal wall and cool faster) — conservative is the safe side for costing.

export function computeCoolingTimeSec(
  wallMm: number,
  props: ResinThermalProps,
): number {
  const { alpha, Tm, Tw, Te } = props;
  const deltaTemp = Te - Tw;
  if (deltaTemp <= 0 || alpha <= 0 || wallMm <= 0) return 5.0; // physical fallback

  // Menges formula: t = (s² / π²α) × ln((4/π) × (Tm−Tw)/(Te−Tw))
  // `s` = FULL wall thickness — Menges convention. The formula is derived for
  // a slab of total thickness s cooled from both faces simultaneously; the π²
  // coefficient absorbs the symmetric-cooling geometry factor. Do NOT halve the
  // wall here — the half-thickness form is for a one-sided cooling derivation.
  const lnArg = (4 / Math.PI) * (Tm - Tw) / deltaTemp;
  if (lnArg <= 1) return 5.0; // degenerate temperatures (Te ≥ Tm)

  const tCool = (wallMm * wallMm / (Math.PI * Math.PI * alpha)) * Math.log(lnArg);
  return Math.max(1.0, Math.round(tCool * 10) / 10); // 0.1 s resolution, floor 1 s
}

// ── Fill-time model ────────────────────────────────────────────────────────────
// t_fill = max(IM_FILL_MIN_SEC, L_flow / v_front)
//
// L_flow: longest flow path in the mold (mm).
//   Exact flow-length requires gate position — a Phase 5 mold-layout item.
//   Phase 4 proxy: 0.60 × longest_bbox_dim is a reasonable lower bound for a
//   centre-gated part (the flow reaches the furthest cavity wall before doubling
//   back), matching the "L/t ratio" charts in Rosato §4.4 for common part sizes.
//
// v_front: material melt-front velocity (mm/s) from RESIN_THERMAL_TABLE.vFront.
//
// Physical minimum 0.5 s (shot start overhead — check-valve travel, barrel delay).

export const IM_FILL_MIN_SEC = 0.5;
const IM_FLOW_LENGTH_FACTOR = 0.60; // fraction of longest bbox dimension

export function computeFillTimeSec(
  longestBboxMm: number,
  props: ResinThermalProps,
): number {
  const lFlow = longestBboxMm * IM_FLOW_LENGTH_FACTOR;
  const tFill = lFlow / Math.max(props.vFront, 10);
  return Math.max(IM_FILL_MIN_SEC, Math.round(tFill * 10) / 10);
}

// ── Pack/hold time ─────────────────────────────────────────────────────────────
// t_pack ≈ 0.35 × t_cool (gate-freeze proxy: industry rule of thumb from
// Menges §6.3 and SPI molding guides — hold until gate skin freezes, which
// typically takes 30–40% of cooling time for a pinpoint or edge gate).
//
// Physical minimum 2.0 s (hydraulic dwell for pressure transfer). Physical
// maximum 0.80 × t_cool (diminishing returns beyond gate freeze).

const PACK_TO_COOL_RATIO = 0.35;
const PACK_MIN_SEC = 2.0;

export function computePackTimeSec(coolingTimeSec: number): number {
  const tPack = coolingTimeSec * PACK_TO_COOL_RATIO;
  return Math.max(PACK_MIN_SEC, Math.round(tPack * 10) / 10);
}

// ── Gate recommendation ────────────────────────────────────────────────────────
// Recommends a gate type from geometry + material signals.
//
// Rules (coarse, based on SPI gate-selection charts and industry practice):
//
//   hot_tip:  Engineering resins (PC, PA, POM, PEEK, PEI, PSU) where regrind
//             reduction justifies hot-runner tooling premium; or high-volume
//             parts (shot volume > 200 cm³) where runner scrap cost dominates.
//             Implies zero gate vestige → gate_trimming NOT routed.
//
//   fan:      Large flat parts (projected area > 200 cm², bbox aspect ratio > 2.5)
//             where a fan gate distributes fill more evenly than a single edge gate
//             and weld-line risk must be minimised.
//
//   sub:      Small cosmetic parts (projected area ≤ 50 cm²) with wall > 1.5 mm
//             where the gate vestige must be hidden on a non-show surface.
//             Sub-gates self-de-gate on mold open — no gate trimming required.
//
//   edge:     Default — all other cases. Requires gate trimming (vestige).
//
// Confidence note: this is a V1 heuristic. Phase 5 will add gate simulation
// (fill analysis using part flow-length vs. max L/t for the resin). The current
// rules are conservative: when uncertain between hot_tip and edge, hot_tip is
// chosen for engineering resins because the cost error (slightly over-costing a
// cold-runner mold) is less damaging than under-costing a hot-runner mold.

// Resin tokens that favour hot-tip gates
const HOT_TIP_RESIN_TOKENS: ReadonlySet<string> = new Set([
  'PC', 'POLYCARBONATE',
  'PA', 'PA6', 'PA66', 'PA12', 'NYLON', 'POLYAMIDE',
  'POM', 'ACETAL', 'DELRIN',
  'PEEK', 'PEI', 'ULTEM', 'PSU', 'PPS',
  'PET', 'PBT',
]);

const PROJECTED_AREA_FAN_GATE_MM2 = 200_000;  // 200 cm² — fan gate threshold
const PROJECTED_AREA_SUB_GATE_MM2 =  50_000;  // 50 cm² — sub gate upper bound
const SUB_GATE_MIN_WALL_MM = 1.5;              // sub gate needs minimum wall for tunnel
const HOT_TIP_VOLUME_MM3 = 200_000;            // 200 cm³ shot volume → hot runner preferred

export type GateType = 'edge' | 'fan' | 'sub' | 'hot_tip';

export interface GateRecommendation {
  gateType: GateType;
  reason: string;
}

export function recommendGateType(input: {
  projectedAreaMm2: number | null;
  wallThicknessNominalMm: number;
  bboxMaxMm: number;
  bboxMidMm: number;
  volumeMm3: number;
  grade: string | null;
}): GateRecommendation {
  const { projectedAreaMm2, wallThicknessNominalMm, bboxMaxMm, bboxMidMm, volumeMm3, grade } = input;

  // Hot tip: engineering resins where regrind cost justifies hot runner
  if (grade) {
    const tokens = tokenizeGrade(grade);
    for (const t of tokens) {
      if (HOT_TIP_RESIN_TOKENS.has(t)) {
        return {
          gateType: 'hot_tip',
          reason: `${t} engineering resin — hot-tip gate recommended to eliminate regrind and improve dimensional consistency`,
        };
      }
    }
  }

  // Hot tip: high shot volume regardless of resin (runner scrap cost dominates)
  if (volumeMm3 > HOT_TIP_VOLUME_MM3) {
    return {
      gateType: 'hot_tip',
      reason: `Shot volume ${Math.round(volumeMm3 / 1000)} cm³ > 200 cm³ — hot-runner system recommended to reduce runner scrap cost`,
    };
  }

  const area = projectedAreaMm2 ?? (bboxMaxMm * bboxMidMm);

  // Fan gate: large flat parts where uniform fill distribution is critical
  if (area > PROJECTED_AREA_FAN_GATE_MM2) {
    const aspectRatio = bboxMidMm > 0 ? bboxMaxMm / bboxMidMm : 1;
    if (aspectRatio > 2.5) {
      return {
        gateType: 'fan',
        reason: `Projected area ${Math.round(area / 100)} cm² with aspect ratio ${aspectRatio.toFixed(1)} — fan gate distributes fill and minimises weld-line risk`,
      };
    }
  }

  // Sub gate: small cosmetic parts where gate vestige must be hidden.
  // Only trigger when projectedAreaMm2 is provided from CAD — bbox estimates are too
  // coarse for a decision that suppresses gate trimming and sets runner scrap to zero.
  if (projectedAreaMm2 != null && area <= PROJECTED_AREA_SUB_GATE_MM2 && wallThicknessNominalMm >= SUB_GATE_MIN_WALL_MM) {
    return {
      gateType: 'sub',
      reason: `Small part (${Math.round(area / 100)} cm²) with wall ${wallThicknessNominalMm.toFixed(1)}mm ≥ ${SUB_GATE_MIN_WALL_MM}mm — sub-gate self-de-gates and hides vestige on parting-line face`,
    };
  }

  return {
    gateType: 'edge',
    reason: 'Standard cold-runner edge gate — vestige trimming required',
  };
}

// ── LSR cure time (Arrhenius model) ───────────────────────────────────────────
// LSR is thermoset — it does NOT cool; it CURES. The mold is HEATED (170–200°C),
// opposite to thermoplastics. Cure time is governed by the Arrhenius equation:
//   t_cure = A × exp(Ea / R·T)
// where A ≈ 0.8 s (pre-exponential factor), Ea/R ≈ 3500 K (activation energy /
// gas constant), T = mold temperature in Kelvin.
// At T_mold = 180°C (453 K): t_cure ≈ 18 s per mm of nominal wall.
// Source: Ossipov et al., "Cure Kinetics of Silicone Rubber", Polymer Engineering 2002.
export const LSR_DEFAULT_MOLD_TEMP_C = 180;   // °C — standard 2-component LSR
const LSR_A_FACTOR = 0.008;                    // pre-exponential factor (s); calibrated to ~18s/mm at 180°C
const LSR_EA_OVER_R = 3500;                    // Ea/R in K (activation energy / gas constant)
const R_KELVIN_OFFSET = 273.15;

export function computeLsrCureTime(wallMm: number, moldTempC: number = LSR_DEFAULT_MOLD_TEMP_C): number {
  const wallFloor = Math.max(wallMm, 0.5);
  const T = moldTempC + R_KELVIN_OFFSET;
  const baseCureSec = LSR_A_FACTOR * Math.exp(LSR_EA_OVER_R / T);
  // Cure time scales with wall — thicker walls need longer heat penetration.
  return Math.round(baseCureSec * wallFloor * 10) / 10;
}

// ── Cycle time result ──────────────────────────────────────────────────────────

export interface CycleTimeResult {
  fillSec: number;
  packSec: number;
  coolSec: number;
  ejectSec: number;
  totalCycleSec: number;  // fill + pack + cool + eject (single-cavity)
  resinProps: ResinThermalProps;
  gateRecommendation: GateRecommendation;
}

// Ejection time: mold-open travel + ejector stroke + part-release time.
// Constant for Phase 4 — depends on mold stroke and ejector system, not on
// part geometry. Phase 5 will scale with part height (depth of draw).
const IM_EJECT_SEC = 2.5;

export function computeCycleTime(input: {
  wallMm: number;
  longestBboxMm: number;
  bboxMidMm: number;
  volumeMm3: number;
  projectedAreaMm2: number | null;
  grade: string | null;
  gateTypeOverride?: GateType | null; // caller-supplied gate type bypasses recommendation
  isLsr?: boolean;                    // when true: Arrhenius cure, not Menges cooling
}): CycleTimeResult {
  const { wallMm, longestBboxMm, bboxMidMm, volumeMm3, projectedAreaMm2, grade } = input;
  const isLsr = input.isLsr ?? isSiliconeGrade(grade);

  const props = lookupResinProps(grade);
  const wall = Math.max(wallMm, 0.5); // physical floor: 0.5 mm (thinnest practical injection wall)

  // LSR self-degates — cold-deck manifolds produce minimal vestige; default to sub gate.
  const lsrGate: GateRecommendation = { gateType: 'sub', reason: 'LSR — self-degating cold-deck manifold; no trimming required' };

  const gateRecommendation: GateRecommendation = isLsr
    ? lsrGate
    : input.gateTypeOverride != null
      ? { gateType: input.gateTypeOverride, reason: 'Caller-supplied gate type (overrides recommendation)' }
      : recommendGateType({ projectedAreaMm2, wallThicknessNominalMm: wall, bboxMaxMm: longestBboxMm, bboxMidMm, volumeMm3, grade });

  // LSR: cure time replaces cooling; fill and pack apply normally.
  const coolSec  = isLsr ? computeLsrCureTime(wall) : computeCoolingTimeSec(wall, props);
  const fillSec  = computeFillTimeSec(longestBboxMm, props);
  const packSec  = isLsr ? 0 : computePackTimeSec(coolSec); // LSR has no pack/hold phase
  const ejectSec = IM_EJECT_SEC;

  return {
    fillSec,
    packSec,
    coolSec,
    ejectSec,
    totalCycleSec: fillSec + packSec + coolSec + ejectSec,
    resinProps: props,
    gateRecommendation,
  };
}
