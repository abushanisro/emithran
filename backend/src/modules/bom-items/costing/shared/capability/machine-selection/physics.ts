// Pure physics — no I/O and no material lookup of any kind. Each function
// converts part geometry + an already-resolved material property into the
// physical minimum a machine must meet (MachineRequirement) for one process.
// Callers resolve real material properties ONCE from the raw_materials DB
// (see BOMItemsService.resolveMaterialForFamily) and pass plain numbers in —
// this file never sees a grade string or does its own classification/lookup,
// so machine selection and $ costing can never silently diverge onto two
// different material values for the same part.
// Formulas: press brake tonnage per Diebold/Bosch air-bend formula; envelope and
// lathe margins per the ×1.2 rule; laser thickness limits are material-specific
// and resolved against the machine's per-material columns by the selector.

import { recommendedBendTonnage, estimateBurlTonnage, estimateTurretPunchTonnage } from '../../core/default-rates.constants';

// ── Material factor tables ────────────────────────────────────────────────────
// Baseline MRR (cm³/min) at 100% rigidity — used to size VMC spindle demand
export const MATERIAL_MRR_CM3_MIN: Record<string, number> = {
  MS: 60,
  SS: 30,
  AL: 150,
  CU: 45,
  OTHER: 60,
};

export type LaserMaterialFamily = 'MS' | 'SS' | 'AL' | 'CU' | 'OTHER';

// Envelope safety margin: machine axis must exceed part dimension by 20%
// (fixturing, clamp clearance, tool approach). Bed margin for flat stock is 10%.
export const ENVELOPE_MARGIN = 1.2;
export const BED_MARGIN = 1.1;
export const TONNAGE_MARGIN = 1.15;

// IM tie-bar clearance: part footprint + runner allowance + platen-edge clearance.
// Additive (not proportional) — a 20mm runner is 20mm regardless of part size.
const IM_TIEBAR_RUNNER_ALLOWANCE_MM = 20;  // cold-runner edge on mold face
const IM_TIEBAR_PLATEN_CLEARANCE_MM = 25;  // platen edge to tie-bar inner face
export const IM_TIEBAR_ADDEND_MM = IM_TIEBAR_RUNNER_ALLOWANCE_MM + IM_TIEBAR_PLATEN_CLEARANCE_MM; // = 45mm

export function classifyLaserMaterial(grade: string | null): LaserMaterialFamily {
  if (!grade) return 'OTHER';
  // Split letter/digit boundaries so compact codes tokenize: "SS304" → "SS 304",
  // "AL6061-T6" → "AL 6061 T 6", "IS2062" → "IS 2062"
  const tokens = new Set(
    grade
      .toUpperCase()
      .replace(/([A-Z])(\d)/g, '$1 $2')
      .replace(/(\d)([A-Z])/g, '$1 $2')
      .split(/[^A-Z0-9]+/)
      .filter(Boolean),
  );
  const has = (...keys: string[]) => keys.some((k) => tokens.has(k));

  if (has('SS', 'STAINLESS', 'INOX', '304', '316', '321', '410', '430')) return 'SS';
  if (has('AL', 'ALU', 'ALUMINIUM', 'ALUMINUM', '6061', '6063', '5052', '7075', '2024')) return 'AL';
  // CUZN/CW are the EN designations for brass (e.g. CuZn39Pb3 = CW614N, free-
  // cutting brass). Found by the same audit as the JIS steel gap below: the
  // sibling classifier normaliseLaserMaterial already matches /BRASS|CUZ|CW/,
  // so one live BOM grade ("Generic CuZn39Pb3") was Brass for the cut-speed
  // lookup and OTHER for capability gating at the same time. The letter/digit
  // tokenizer above splits "CuZn39Pb3" into CUZN / 39 / PB / 3, which is why a
  // bare 'CU' token never matched it.
  if (has('CU', 'CUZN', 'COPPER', 'BRASS', 'BRONZE')
      || /C\s?(110|260)|CU\s?ZN|CW\s?\d{3}/.test(grade.toUpperCase())) return 'CU';
  // JIS carbon-steel sheet family. SPCC (G3141) was already here; its own
  // sibling and galvanized grades were not, so real mild steel fell through to
  // OTHER. Found live: SECC is the most common grade in this deployment (9 of
  // the 22 BOM items carry it) and classified as OTHER, while CRCA and SPCC --
  // the same material class -- classified as MS.
  //
  //   G3141 cold-rolled:            SPCC, SPCD, SPCE
  //   G3313 electro-galvanized:     SECC, SECD, SECE   (the zinc-coated G3141 grades)
  //   G3302 hot-dip galvanized:     SGCC, SGCD
  //
  // Sourced, not inferred: the coating does not change the base steel, and the
  // live raw_materials row for SECC carries uts_mpa 270 / shearing_strength 216
  // -- mild-steel values, not stainless or aluminium.
  //
  // Impact is explainability plus a latent mis-gate, NOT a live cost error:
  // materialFamily is consumed only through materialThicknessLimit, whose OTHER
  // branch reads max_thickness_mm before max_thickness_ms_mm (MS reads them the
  // other way round). No USA machine row currently has both columns set to
  // different values -- verified, 10 rows have both, 0 disagree -- so the two
  // paths resolve to the same number today. What the user actually saw was a
  // capability reason reading "Thickness 1.5 mm (OTHER)" for a mild-steel part.
  if (has('MS', 'CRCA', 'HRC', 'HR', 'CR', 'MILD', 'STEEL', '2062', '513',
          'SPCC', 'SPCD', 'SPCE', 'SECC', 'SECD', 'SECE', 'SGCC', 'SGCD') ||
      /IS\s?(2062|513)|EN\s?(8|1A)|Q\s?235|S\s?(235|355)|DC\s?0[1-6]|E\s?(250|350)/.test(grade.toUpperCase())) return 'MS';
  return 'OTHER';
}

// ── Requirement types ─────────────────────────────────────────────────────────

interface PressBrakeRequirement {
  kind: 'press_brake';
  tonnage: number;        // recommended force (theoretical × 1.25) — already the margin
  bendLengthMm: number;
  thicknessMm: number;
}

interface HoleFormingRequirement {
  kind: 'hole_forming';
  tonnage: number;        // tons required incl. no margin (selector applies TONNAGE_MARGIN)
  holeDiameterMm: number;
  thicknessMm: number;
}

export interface LaserRequirement {
  kind: 'laser';
  thicknessMm: number;
  materialFamily: LaserMaterialFamily;
  materialGrade: string | null;  // raw grade, checked against cuttable_materials
  bedLengthMm: number;           // flat pattern length
  bedWidthMm: number;            // flat pattern width
  // Minimum laser power that can cut this material/thickness, from the laser
  // cut table (sm_lookup_laser_cut). Absent when the table has no rows for
  // this material — the machine's own thickness limits then decide alone.
  power?: LaserPowerRequirement;
}

// From sm_lookup_laser_cut (memory/Sheetmetal/Lookup_Table_5_Laser_Cutting_Data.md):
// a power with no row for a material/thickness cannot cut it ("-" in the
// source). The part's thickness is rounded UP to the next tabulated
// thickness, so the requirement is never understated.
export interface LaserPowerRequirement {
  material: string;                 // table material, e.g. 'Carbon Steel'
  tableThicknessMm: number | null;  // tabulated thickness used; null = thicker than any row
  requiredW: number | null;         // lowest power with a row; null = no laser in the table cuts it
}

interface VmcRequirement {
  kind: 'vmc';
  xMm: number;            // part bbox — selector applies ENVELOPE_MARGIN
  yMm: number;
  zMm: number;
  weightKg: number;
  mrrCm3PerMin: number;
}

interface LatheRequirement {
  kind: 'lathe';
  diameterMm: number;     // part max diameter — selector applies ENVELOPE_MARGIN
  lengthMm: number;
}

interface GenericRequirement {
  kind: 'generic';        // deburring, tapping — no dimensional gate
}

// Real machine_library.json "Shearing Machine" data is per-material thickness
// (max_thickness_steel_mm/_stainless_steel_mm/_aluminum_mm/_copper_mm) plus a
// shear/bed length (shear_length_mm) — no tonnage field at all (unlike
// press_brake/turret_punch/hole_forming, a shear's rated capacity IS its
// per-material thickness limit, not a separately-derived force). Same
// material-family shape as LaserRequirement, reusing classifyLaserMaterial —
// one classification scheme, not a second one invented for this class.
export interface ShearRequirement {
  kind: 'shear';
  thicknessMm: number;
  materialFamily: LaserMaterialFamily;
  materialGrade: string | null;   // raw grade, kept for reasons/diagnostics
  cutLengthMm: number;            // longest cut (shear operates in straight strokes across the blank)
}

// Real machine_library.json "Plasma Cutting Machine" data has NO thickness
// field at all (unlike shear/laser) — only power_watts (100W-100,000W
// across 13 real machines) and bed_length_mm/bed_width_mm. Thickness
// feasibility for a given power is already handled, more precisely, by the
// real per-part nestingCutRate table (sheet-metal-lookup.service.ts's
// getPlasmaCutParams — nearest-power + nearest-thickness match against real
// data, honest $0/no-data when nothing matches) at COST time — inventing a
// second, cruder power→thickness formula here risks disagreeing with that
// real table. Gate on bed size only (real, sourced); thickness stays
// informational, not a pass/fail dimension, until a real synchronous
// power→thickness capability table is sourced.
export interface PlasmaCutRequirement {
  kind: 'plasma_cut';
  bedLengthMm: number;
  bedWidthMm: number;
}

// Real machine_library.json "Laser Punch / Punch Press" data is the richest
// of this backlog: real press_force_kn (a genuine punching-force capacity,
// unused by laser-punch-engine.ts's own real cost formula — a real,
// sourced, previously-unused capability gap, not a duplicate of an existing
// formula), real per-material thickness (max_thickness_steel_mm/
// _aluminum_mm/_stainless_steel_mm/_copper_mm — same MS/SS/AL/CU shape as
// shear), and real bed size (max_sheet_length_mm/max_sheet_width_mm).
// Required tonnage reuses estimateTurretPunchTonnage — the same real
// shearing-force-through-sheet-metal physics this codebase already
// validated for turret punching, not a new formula invented for this class.
export interface LaserPunchRequirement {
  kind: 'laser_punch';
  tonnage: number;        // required, incl. no margin (selector applies TONNAGE_MARGIN)
  thicknessMm: number;
  materialFamily: LaserMaterialFamily;
  materialGrade: string | null;
  bedLengthMm: number;
  bedWidthMm: number;
}

// P0.4: turret punch and waterjet used to be assigned the SAME LaserRequirement
// as fiber/CO2 laser (they're registered in the same sheet_metal_cutting
// engine family) — meaning ranking checked thickness+bed only, never tonnage,
// so a tonnage-incapable turret machine could score identically to a capable
// one. These two kinds give each its own real physical requirement instead.
export interface PunchingRequirement {
  kind: 'turret_punch';
  tonnage: number;        // tons required incl. no margin (selector applies TONNAGE_MARGIN)
  thicknessMm: number;
  bedLengthMm: number;    // flat pattern length
  bedWidthMm: number;     // flat pattern width
}

// Waterjet isn't force-limited the way punching is (confirmed: waterjet-
// engine.ts has no tonnage/force formula at all) — thickness + bed only.
export interface WaterjetRequirement {
  kind: 'waterjet';
  thicknessMm: number;
  bedLengthMm: number;
  bedWidthMm: number;
}

interface InjectionMoldingRequirement {
  kind: 'injection_molding';
  // Reference clamp force for one cavity (plastic-molding/clamp-force.ts), which
  // already includes clampForceSafetyFactor: the selector applies no further
  // margin. null = not derivable (material has no reference clamp properties):
  // no press is capable, and the reason says why.
  clampTonnageRequired: number | null;
  clampNotDerivableReason: string | null;
  projectedAreaMm2: number;
  // Full IMM sizing criteria: clamp force, shot weight, tie-bar spacing vs
  // part dims. Only clamp tonnage has capability data in mhr_records today
  // (max_tonnage, migration 324); shot weight and part dims are carried on
  // the requirement so the selector can gate on them the day shot-capacity /
  // tie-bar columns exist — and can already explain them in reasons.
  shotWeightG: number | null;    // part + runner mass per shot; null = volume/density unknown
  partLengthMm: number;          // largest bbox dim — future tie-bar spacing check
  partWidthMm: number;           // second bbox dim
}

// Real machine_library.json "Standard Press"/"Tandem Press"/"Progressive Die
// Press" data (staged sm_reference_data, migrations 508/585): real
// press_force_kn, real bed size (max_part_length_mm/_width_mm for Standard/
// Tandem; press_table_length_mm/_width_mm for Progressive Die — same real
// quantity, different real field name per source table), and real per-
// material thickness (all 5 materials for Standard/Tandem; aluminum ONLY for
// Progressive Die — the source migration's own note discloses the other 4
// were illegible in the source photos and were never fabricated to fill the
// gap; this requirement's thickness gate is therefore only meaningfully
// checked for AL parts on Progressive Die machines, same non-fail-closed
// ungated-on-null policy as every other class with partial real data).
// Required tonnage reuses estimateTurretPunchTonnage (the same real
// shearing-force formula already validated for Turret Punch/Laser Punch)
// against the part's real blanking perimeter — blanking is the dominant,
// worst-case tonnage driver for a stamping die. This does NOT separately
// account for a combined bend+blank hit's true tonnage, or differentiate
// in-die bending capability from blank-only — no real per-machine die-
// station/bending-capability data exists anywhere in the sourced reference
// data to build that distinction from (see CLAUDE.md's Cost checklist,
// "Press-family... double-charge bending" entry — a separate, disclosed,
// NOT-fixed gap this requirement does not touch).
export interface PressRequirement {
  kind: 'press_forming';
  tonnage: number;        // required, incl. no margin (selector applies TONNAGE_MARGIN)
  thicknessMm: number;
  materialFamily: LaserMaterialFamily;
  materialGrade: string | null;
  bedLengthMm: number;
  bedWidthMm: number;
}

// Real machine_library.json "2/3/4 Roll Bender" data (staged sm_reference_data,
// migration 505): real roll_working_length_mm (the roll's real feed-length
// capacity) and real steel_thickness_mm (mild-steel ONLY — no other real
// material breakdown exists for this class anywhere in the sourced reference
// data; a few individual machines additionally carry real min/max_single/
// multi_pass_diameter_mm fields, inconsistently present across the fleet —
// not consumed here since a MachineCapability-wide single-pass/multi-pass
// distinction doesn't exist as a mhr_records column yet, real gap, not
// fabricated). Thickness gate is therefore only meaningfully checked against
// mild/carbon steel parts; ungated (non-fail-closed) for anything else or
// for a machine with no real thickness data on file, same policy as Shear.
export interface RollBendingRequirement {
  kind: 'roll_bending';
  thicknessMm: number;
  rollLengthMm: number;
}

export type MachineRequirement =
  | PressBrakeRequirement
  | HoleFormingRequirement
  | LaserRequirement
  | PunchingRequirement
  | WaterjetRequirement
  | VmcRequirement
  | LatheRequirement
  | GenericRequirement
  | InjectionMoldingRequirement
  | ShearRequirement
  | PlasmaCutRequirement
  | LaserPunchRequirement
  | PressRequirement
  | RollBendingRequirement
  | DeburrRequirement;

// Burr removal on a cut sheet part. The burr / slag sits on the cut edge, so
// the burr edge length is the part's cut length. Two real machine families
// can do it, each with its own sourced time per mm of edge:
//   Deslag machine (class 'deburring') — its own perimeter_allowance_s_per_mm
//     (machine library, memory/Sheetmetal/machine/machine_library.csv)
//   Manual Deburr (class 'manual_deburr') — 1 / tblDeburring linear speed for
//     the material (memory/Machining/lookup/tblDeburring)
// The selector ranks them by cost per part (rate × time); costing prices the
// picked machine with the same deburrSecPerMm, so the two never disagree.
export interface DeburrRequirement {
  kind: 'deburr';
  burrEdgeLengthMm: number;
  deslagSecPerMmByMachine: Record<string, number>;   // lower-cased machine name -> s/mm
  manualDeburr: { secPerMm: number; source: string } | null;
}

export const DEBURR_MACHINE_CLASSES = ['deburring', 'manual_deburr'] as const;

/** The candidate's own time per mm of burr edge, with its source; null = not on file. */
export function deburrSecPerMm(
  candidate: { machineClass: string; machineName: string | null },
  req: DeburrRequirement,
): { secPerMm: number; source: string } | null {
  if (candidate.machineClass === 'manual_deburr') return req.manualDeburr;
  const s = req.deslagSecPerMmByMachine[(candidate.machineName ?? '').trim().toLowerCase()];
  return s != null && s > 0
    ? { secPerMm: s, source: `"${candidate.machineName}" perimeter allowance (machine library)` }
    : null;
}

/** Deburr cycle seconds for this candidate, or null when its time rate is not on file. */
export function deburrCycleSec(
  candidate: { machineClass: string; machineName: string | null },
  req: DeburrRequirement,
): number | null {
  const rate = deburrSecPerMm(candidate, req);
  return rate && req.burrEdgeLengthMm > 0 ? req.burrEdgeLengthMm * rate.secPerMm : null;
}

// ── Requirement builders ──────────────────────────────────────────────────────

// Press-brake requirement = the Bending calculator's Recommended Force
// (theoretical × 1.25, see recommendedBendTonnage), sized to the one longest
// bend — the SAME number the cost engine and the calculator popup show, so
// selection and the displayed tonnage never disagree. That factor is the
// margin: the selector adds no TONNAGE_MARGIN on top for this kind.
export function pressBrakeRequirement(input: {
  bendLengthMm: number;
  thicknessMm: number;
  utsMpa: number | null;
}): PressBrakeRequirement {
  const { bendLengthMm, thicknessMm, utsMpa } = input;
  const t = Math.max(thicknessMm, 0);
  const tonnage = recommendedBendTonnage(utsMpa, t, Math.max(bendLengthMm, 0)) ?? 0;
  return { kind: 'press_brake', tonnage, bendLengthMm, thicknessMm: t };
}

// Hole-extrusion (burl/flange) forming tonnage — real drawing/forming force
// formula, see estimateBurlTonnage's own doc comment in default-rates.ts for
// derivation. Same pattern as pressBrakeRequirement above: machine SELECTION
// and the displayed/costed tonnage share this one formula, so they can never
// silently disagree.
export function holeFormingRequirement(input: {
  holeDiameterMm: number;
  thicknessMm: number;
  utsMpa: number | null;
}): HoleFormingRequirement {
  const { holeDiameterMm, thicknessMm, utsMpa } = input;
  const t = Math.max(thicknessMm, 0);
  const tonnage = estimateBurlTonnage(utsMpa, t, Math.max(holeDiameterMm, 0)) ?? 0;
  return { kind: 'hole_forming', tonnage, holeDiameterMm, thicknessMm: t };
}

export function laserRequirement(input: {
  thicknessMm: number;
  materialGrade: string | null;
  bedLengthMm: number;
  bedWidthMm: number;
  power?: LaserPowerRequirement | null;
}): LaserRequirement {
  return {
    kind: 'laser',
    thicknessMm: Math.max(input.thicknessMm, 0),
    materialFamily: classifyLaserMaterial(input.materialGrade),
    materialGrade: input.materialGrade,
    bedLengthMm: Math.max(input.bedLengthMm, 0),
    bedWidthMm: Math.max(input.bedWidthMm, 0),
    ...(input.power ? { power: input.power } : {}),
  };
}

// TPP Manufacturing punching force formula — the SAME estimateTurretPunchTonnage
// already used by machine-capability.ts's post-selection TONNAGE_EXCEEDED check
// (fed by the identical cutLengthMm/materialShearStrengthMpa/thicknessMm), so
// machine SELECTION and the post-selection capability verdict can never
// silently disagree.
export function punchingRequirement(input: {
  cutLengthMm: number;
  materialShearStrengthMpa: number;
  thicknessMm: number;
  bedLengthMm: number;
  bedWidthMm: number;
}): PunchingRequirement {
  const t = Math.max(input.thicknessMm, 0);
  const tonnage = estimateTurretPunchTonnage(input.materialShearStrengthMpa, t, Math.max(input.cutLengthMm, 0)) ?? 0;
  return {
    kind: 'turret_punch',
    tonnage,
    thicknessMm: t,
    bedLengthMm: Math.max(input.bedLengthMm, 0),
    bedWidthMm: Math.max(input.bedWidthMm, 0),
  };
}

export function waterjetRequirement(input: {
  thicknessMm: number;
  bedLengthMm: number;
  bedWidthMm: number;
}): WaterjetRequirement {
  return {
    kind: 'waterjet',
    thicknessMm: Math.max(input.thicknessMm, 0),
    bedLengthMm: Math.max(input.bedLengthMm, 0),
    bedWidthMm: Math.max(input.bedWidthMm, 0),
  };
}

export function shearRequirement(input: {
  thicknessMm: number;
  materialGrade: string | null;
  cutLengthMm: number;
}): ShearRequirement {
  return {
    kind: 'shear',
    thicknessMm: Math.max(input.thicknessMm, 0),
    materialFamily: classifyLaserMaterial(input.materialGrade),
    materialGrade: input.materialGrade,
    cutLengthMm: Math.max(input.cutLengthMm, 0),
  };
}

export function laserPunchRequirement(input: {
  cutLengthMm: number;
  materialShearStrengthMpa: number;
  thicknessMm: number;
  materialGrade: string | null;
  bedLengthMm: number;
  bedWidthMm: number;
}): LaserPunchRequirement {
  const t = Math.max(input.thicknessMm, 0);
  const tonnage = estimateTurretPunchTonnage(input.materialShearStrengthMpa, t, Math.max(input.cutLengthMm, 0)) ?? 0;
  return {
    kind: 'laser_punch',
    tonnage,
    thicknessMm: t,
    materialFamily: classifyLaserMaterial(input.materialGrade),
    materialGrade: input.materialGrade,
    bedLengthMm: Math.max(input.bedLengthMm, 0),
    bedWidthMm: Math.max(input.bedWidthMm, 0),
  };
}

export function plasmaCutRequirement(input: {
  bedLengthMm: number;
  bedWidthMm: number;
}): PlasmaCutRequirement {
  return {
    kind: 'plasma_cut',
    bedLengthMm: Math.max(input.bedLengthMm, 0),
    bedWidthMm: Math.max(input.bedWidthMm, 0),
  };
}

export function pressFormingRequirement(input: {
  cutLengthMm: number;
  materialShearStrengthMpa: number;
  thicknessMm: number;
  materialGrade: string | null;
  bedLengthMm: number;
  bedWidthMm: number;
}): PressRequirement {
  const t = Math.max(input.thicknessMm, 0);
  const tonnage = estimateTurretPunchTonnage(input.materialShearStrengthMpa, t, Math.max(input.cutLengthMm, 0)) ?? 0;
  return {
    kind: 'press_forming',
    tonnage,
    thicknessMm: t,
    materialFamily: classifyLaserMaterial(input.materialGrade),
    materialGrade: input.materialGrade,
    bedLengthMm: Math.max(input.bedLengthMm, 0),
    bedWidthMm: Math.max(input.bedWidthMm, 0),
  };
}

export function rollBendingRequirement(input: {
  thicknessMm: number;
  rollLengthMm: number;
}): RollBendingRequirement {
  return {
    kind: 'roll_bending',
    thicknessMm: Math.max(input.thicknessMm, 0),
    rollLengthMm: Math.max(input.rollLengthMm, 0),
  };
}

export function vmcRequirement(input: {
  bboxXMm: number;
  bboxYMm: number;
  bboxZMm: number;
  finishedWeightKg: number;
  materialMrrCm3PerMin: number;
}): VmcRequirement {
  // Normalise bbox so X ≥ Y (part can be rotated on the table; Z is fixed)
  const [x, y] = [Math.max(input.bboxXMm, input.bboxYMm), Math.min(input.bboxXMm, input.bboxYMm)];
  return {
    kind: 'vmc',
    xMm: Math.max(x, 0),
    yMm: Math.max(y, 0),
    zMm: Math.max(input.bboxZMm, 0),
    weightKg: Math.max(input.finishedWeightKg, 0),
    mrrCm3PerMin: Math.max(input.materialMrrCm3PerMin, 0),
  };
}

export function latheRequirement(input: {
  maxDiameterMm: number;
  maxLengthMm: number;
}): LatheRequirement {
  return {
    kind: 'lathe',
    diameterMm: Math.max(input.maxDiameterMm, 0),
    lengthMm: Math.max(input.maxLengthMm, 0),
  };
}

// ── Injection molding ──────────────────────────────────────────────────────────
// Clamp tonnage is the reference clamp force (plastic-molding/clamp-force.ts),
// resolved by the caller and passed in as a number, per this file's contract
// (it never sees a grade string or does its own material lookup). Phase 1
// approximates projected area with the part's bbox footprint.

export function injectionMoldingRequirement(input: {
  projectedAreaMm2: number;
  /** Reference clamp force, one cavity, tonnes (clamp-force.ts); null = not derivable. */
  clampTonnageRequired: number | null;
  clampNotDerivableReason: string | null;
  // Cavity count is not yet known at machine-selection time (it is itself
  // partly a function of the selected machine's clamp tonnage — see
  // recommendCavityCount, cost-injection-molding-engine.ts) — this remains a
  // single-cavity-basis requirement. Route comparison's im-*-tier routes size
  // cavities against each tier's real press.
  shotWeightG?: number | null;
  partLengthMm?: number;
  partWidthMm?: number;
}): InjectionMoldingRequirement {
  return {
    kind: 'injection_molding',
    clampTonnageRequired: input.clampTonnageRequired,
    clampNotDerivableReason: input.clampNotDerivableReason,
    projectedAreaMm2: Math.max(input.projectedAreaMm2, 0),
    shotWeightG: input.shotWeightG ?? null,
    partLengthMm: Math.max(input.partLengthMm ?? 0, 0),
    partWidthMm: Math.max(input.partWidthMm ?? 0, 0),
  };
}
