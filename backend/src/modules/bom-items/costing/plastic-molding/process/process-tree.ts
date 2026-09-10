// Injection molding process tree — the structural vocabulary of the family.
//
// Level 1: family (plastic_molding) → Level 2: primary process operations
// (drying → setup → injection → packing → cooling → ejection) → Level 3:
// secondary operations (gate trimming, deflashing, inserts, welding, marking)
// → Level 4: inspection (visual, dimensional, weight, CMM, leak, ...).
//
// This file is pure data + types: which operations EXIST and how they are
// organized. WHICH operations a given part gets is the routing engine's job
// (routing-engine.ts); WHAT each costs is the cost engine's job
// (cost-injection-molding-engine.ts). Same layering as sheet metal and CNC:
// route first, cost the route.

// ── Operation identifiers ─────────────────────────────────────────────────────

export type IMOperationId =
  // Level 2 — primary process (injection molding cycle + machine-side work)
  | 'material_drying'
  | 'lsr_compound_dosing'  // LSR: A+B metering + mixing head purge (replaces material_drying)
  | 'mold_setup'
  | 'injection'
  | 'packing'
  | 'cooling'
  | 'lsr_curing'           // LSR: thermoset cure hold (Arrhenius, heated mold 170–200°C)
  | 'ejection'
  | 'regrind_handling'
  | 'secondary_cure_oven'  // LSR: post-mold oven cure (200°C, 4h, batch-amortized)
  // Level 3 — secondary operations
  | 'gate_trimming'
  | 'degating'
  | 'deflashing'
  | 'side_action'           // Phase 3: slide/lifter actuation for undercut features
  | 'core_unscrewing'       // helical internal threads — hydraulic core rotation per shot
  | 'ultrasonic_welding'
  | 'heat_staking'
  | 'insert_loading'        // in-mold insert placement before shot (insert molding)
  | 'insert_installation'   // legacy: post-mold press/heat-stake (kept for backward compat)
  | 'insert_inspection'     // post-mold pull test / torque check
  | 'pad_printing'
  | 'laser_marking'
  | 'assembly'
  | 'surface_treatment'
  | 'packaging'
  // Level 4 — inspection
  | 'visual_inspection'
  | 'dimensional_inspection'
  | 'weight_check'
  | 'functional_inspection'
  | 'leak_test'
  | 'cmm_inspection'
  | 'color_inspection'
  | 'material_verification';

export type IMOperationLevel = 'primary' | 'secondary' | 'inspection';

export interface IMOperationDef {
  id: IMOperationId;
  label: string;          // display name, e.g. "Gate Trimming"
  level: IMOperationLevel;
  // Operations inside the molding cycle happen while the machine is closed and
  // running — they are priced as machine time on the IMM, not as separate
  // labour stations. Everything else is a bench/station operation.
  inCycle: boolean;
}

// ── Operation registry ────────────────────────────────────────────────────────
// One row per operation the family knows about. Routing picks a subset; new
// operations are added HERE first, then given a selection rule, then a cost
// model — never inline in the cost engine.

export const IM_OPERATION_REGISTRY: Record<IMOperationId, IMOperationDef> = {
  // Level 2 — primary
  material_drying:      { id: 'material_drying',      label: 'Material Drying',           level: 'primary',   inCycle: false },
  lsr_compound_dosing:  { id: 'lsr_compound_dosing',  label: 'LSR Compound Dosing',       level: 'primary',   inCycle: false },
  mold_setup:           { id: 'mold_setup',           label: 'Mold Setup',                level: 'primary',   inCycle: false },
  injection:            { id: 'injection',            label: 'Injection',                 level: 'primary',   inCycle: true },
  packing:              { id: 'packing',              label: 'Packing/Holding',           level: 'primary',   inCycle: true },
  cooling:              { id: 'cooling',              label: 'Cooling',                   level: 'primary',   inCycle: true },
  lsr_curing:           { id: 'lsr_curing',           label: 'LSR Curing (Thermoset)',    level: 'primary',   inCycle: true },
  ejection:             { id: 'ejection',             label: 'Ejection',                  level: 'primary',   inCycle: true },
  regrind_handling:     { id: 'regrind_handling',     label: 'Regrind Handling',          level: 'primary',   inCycle: false },
  secondary_cure_oven:  { id: 'secondary_cure_oven',  label: 'Secondary Cure Oven',       level: 'primary',   inCycle: false },
  // Level 3 — secondary
  gate_trimming:        { id: 'gate_trimming',        label: 'Gate Trimming',             level: 'secondary', inCycle: false },
  degating:             { id: 'degating',             label: 'Degating',                  level: 'secondary', inCycle: false },
  deflashing:           { id: 'deflashing',           label: 'Deflashing',                level: 'secondary', inCycle: false },
  // Side action runs IN cycle during mold open/close.
  side_action:          { id: 'side_action',          label: 'Side Action (Slide/Lifter)', level: 'secondary', inCycle: true },
  // Unscrewing core: hydraulic rack-and-pinion or servo rotation — in cycle.
  core_unscrewing:      { id: 'core_unscrewing',      label: 'Core Unscrewing',           level: 'secondary', inCycle: true },
  ultrasonic_welding:   { id: 'ultrasonic_welding',   label: 'Ultrasonic Welding',        level: 'secondary', inCycle: false },
  heat_staking:         { id: 'heat_staking',         label: 'Heat Staking',              level: 'secondary', inCycle: false },
  // insert_loading: in-mold placement (insert molding — before shot).
  insert_loading:       { id: 'insert_loading',       label: 'Insert Loading (In-Mold)',  level: 'secondary', inCycle: false },
  // insert_inspection: post-mold pull test / torque check.
  insert_inspection:    { id: 'insert_inspection',    label: 'Insert Pull Test',          level: 'inspection', inCycle: false },
  // insert_installation: legacy post-mold press/heat-stake (kept for backward compat).
  insert_installation:  { id: 'insert_installation',  label: 'Insert Installation',       level: 'secondary', inCycle: false },
  pad_printing:         { id: 'pad_printing',         label: 'Pad Printing',              level: 'secondary', inCycle: false },
  laser_marking:        { id: 'laser_marking',        label: 'Laser Marking',             level: 'secondary', inCycle: false },
  assembly:             { id: 'assembly',             label: 'Assembly',                  level: 'secondary', inCycle: false },
  surface_treatment:    { id: 'surface_treatment',    label: 'Surface Treatment',         level: 'secondary', inCycle: false },
  packaging:            { id: 'packaging',            label: 'Packaging',                 level: 'secondary', inCycle: false },
  // Level 4 — inspection
  visual_inspection:      { id: 'visual_inspection',      label: 'Visual Inspection',      level: 'inspection', inCycle: false },
  dimensional_inspection: { id: 'dimensional_inspection', label: 'Dimensional Inspection', level: 'inspection', inCycle: false },
  weight_check:           { id: 'weight_check',           label: 'Weight Check',           level: 'inspection', inCycle: false },
  functional_inspection:  { id: 'functional_inspection',  label: 'Functional Inspection',  level: 'inspection', inCycle: false },
  leak_test:              { id: 'leak_test',              label: 'Leak Test',              level: 'inspection', inCycle: false },
  cmm_inspection:         { id: 'cmm_inspection',         label: 'CMM Inspection',         level: 'inspection', inCycle: false },
  color_inspection:       { id: 'color_inspection',       label: 'Color Inspection',       level: 'inspection', inCycle: false },
  material_verification:  { id: 'material_verification',  label: 'Material Verification',  level: 'inspection', inCycle: false },
};

// ── Routed tree types ─────────────────────────────────────────────────────────

export interface IMRoutedOperation {
  id: IMOperationId;
  label: string;
  level: IMOperationLevel;
  // Why the routing engine included this operation — every op carries its own
  // audit trail so a cost engineer can challenge the route line by line.
  reason: string;
}

// Molding subtype — auto-derived from material grade + signals; caller can override.
// Controls which process path the routing engine and cost engine follow.
export type MoldingSubtype =
  | 'standard'      // default thermoplastic injection molding
  | 'lsr'           // liquid silicone rubber (thermoset, heated mold, Arrhenius cure)
  | 'insert'        // in-mold metal insert placement before shot
  | 'overmold'      // two-shot with substrate (manual signal; stub path only)
  | 'gas_assisted'  // GAIM hollow-core (manual signal; stub path only)
  | 'two_shot'      // multi-material / 2K (manual signal; stub path only)
  | 'unscrewing';   // helical internal threads requiring core rotation

export interface IMProcessTree {
  family: 'plastic_molding';
  process: 'injection_molding';
  moldingSubtype: MoldingSubtype;
  operations: IMRoutedOperation[];
  // Route-level notes: signals that were missing/proxied, rules that could not
  // evaluate (e.g. gate type unknown → conservative default applied).
  routingWarnings: string[];
  routingVersion: string; // bump when selection rules change (audit/debug)
}

// ── Material behaviour tables ─────────────────────────────────────────────────
// Data, not logic (CLAUDE.md: physics values live in named lookup tables).
// Hygroscopic resins absorb atmospheric moisture and MUST be dried before
// molding or the part gets splay/voids/brittleness. Non-hygroscopic commodity
// resins (PP, PE, PS) mold straight from the bag.
//
// Keys are TOKENS matched against the tokenized grade string (see
// tokenizeGrade below) — token matching, not substring, because "PC" is a
// substring of the steel grade "SPCC" and "PP"/"PE" are substrings of
// "COPPER"; substring matching against material grades is how a copper part
// ends up with a resin dryer on its route.

export const HYGROSCOPIC_RESIN_TOKENS: ReadonlySet<string> = new Set([
  'PA', 'PA6', 'PA66', 'PA12', 'NYLON', 'POLYAMIDE',
  'PC', 'POLYCARBONATE',
  'PET', 'PBT',
  'ABS', // mildly hygroscopic — dried in practice for cosmetic parts
  'PMMA', 'ACRYLIC',
  'PEI', 'ULTEM', 'PSU', 'PES',
  'TPU',
  'PEEK',
]);

// All thermoplastic tokens the platform recognizes — superset of the
// hygroscopic table. Used by isPlasticGradeToken/isPlasticGrade to decide
// whether a material can be injection molded at all.
export const THERMOPLASTIC_TOKENS: ReadonlySet<string> = new Set([
  ...HYGROSCOPIC_RESIN_TOKENS,
  'POM', 'ACETAL', 'DELRIN',
  'PP', 'POLYPROPYLENE',
  'PE', 'HDPE', 'LDPE', 'POLYETHYLENE',
  'PS', 'POLYSTYRENE',
  'PVC',
  'PPS', 'LCP',
  'TPE', 'TPV',
  'SAN', 'ASA',
  'PLASTIC', 'POLYMER', 'RESIN',
]);

// Tokenize a material grade the same way classifyLaserMaterial does: split
// letter/digit boundaries so "PA66-GF30" → [PA, 66, GF, 30], "ABS+PC" →
// [ABS, PC], "SPCC" → [SPCC] (no false PC match).
export function tokenizeGrade(grade: string): Set<string> {
  return new Set(
    grade
      .toUpperCase()
      .replace(/([A-Z])(\d)/g, '$1 $2')
      .replace(/(\d)([A-Z])/g, '$1 $2')
      .split(/[^A-Z0-9]+/)
      .filter(Boolean),
  );
}

// LSR / silicone-rubber tokens — thermoset, requires Arrhenius cure model.
// LSR is NOT a thermoplastic and must NOT go through isPlasticGrade / THERMOPLASTIC_TOKENS.
export const SILICONE_TOKENS: ReadonlySet<string> = new Set([
  'LSR', 'LIQUID', 'SILICONE', 'VMQ', 'PDMS', 'SILASTIC', 'MVQ', 'FVMQ', 'PVMQ',
]);

// Returns true for any LSR / liquid-silicone-rubber grade.
// Token match prevents false positives on names like "SILICON CARBIDE" (SiC).
export function isSiliconeGrade(grade: string | null): boolean {
  if (!grade) return false;
  const tokens = tokenizeGrade(grade);
  // "LSR" alone is definitive; "SILICONE" + "LIQUID" combination is also definitive.
  // "SILICONE" without "LIQUID" is still silicone rubber (e.g. general-purpose silicone).
  for (const t of tokens) if (SILICONE_TOKENS.has(t)) return true;
  return false;
}

export function isPlasticGrade(grade: string | null): boolean {
  if (!grade) return false;
  const tokens = tokenizeGrade(grade);
  for (const t of tokens) if (THERMOPLASTIC_TOKENS.has(t)) return true;
  return false;
}

export function isHygroscopicResin(grade: string | null): boolean {
  if (!grade) return false;
  const tokens = tokenizeGrade(grade);
  for (const t of tokens) if (HYGROSCOPIC_RESIN_TOKENS.has(t)) return true;
  return false;
}
