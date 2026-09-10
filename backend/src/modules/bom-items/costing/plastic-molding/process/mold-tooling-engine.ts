// Injection Molding mold-tooling cost — the real replacement for
// SPI_MOLD_CLASSES.baseCostUsd's uncited flat per-class dollar figures
// ($50,000/$25,000/$12,000/$5,000/$1,500), found during the 2026-09-10
// architecture audit to have no DB/migration/literature citation anywhere
// (unlike lifeShotRating on the same table, cited to migration 682 /
// tblSpiType.json).
//
// SAME PATTERN AS progressive-die-tooling-engine.ts (Sheet Metal's own
// hard-tooling cost fix) — deliberately reused rather than reinvented:
//   (1) price the real, catalogued, purchased-component BOM;
//   (2) compute the real design/machining/assembly HOURS a real mold build
//       needs, from real per-area/per-component figures;
//   (3) never convert (2) into a dollar figure — verified (same check
//       progressive-die-tooling-engine.ts already did for Sheet Metal:
//       mhr_records, lhr_records, lhr_benchmark_rates, wage_grade) that NO
//       toolroom/moldmaker labor rate exists anywhere in this platform for
//       any location. Multiplying real hours by an invented $/hr would
//       produce a dollar figure with no more real backing than a straight
//       guess.
//
// SOURCE DATA (memory/plastic modeling/lookup/, staged by migrations
// 654-660 — a real, licensed Digital Factory reference export; embedded
// here as TS constants rather than a live DB lookup, the same pattern this
// file's own RESIN_THERMAL_TABLE/IM_CLAMP_FACTORS already use):
//   cmStandardToolingComponents — real per-component unit cost + quantity
//   cmToolAssemblyTimes         — real per-component assembly hours
//   cmToolAssemblyNumOperators  — real operator count by mold-base area
//   cmMoldBaseDesignHours       — real design hours by mold-base area
//   cmToolMachiningRates        — real cavity/core plate machining rate
//   cmToolMachiningSetups       — real setup hours for plate machining
//
// WHAT THIS DELIBERATELY DOES NOT PRICE OR MODEL
//
// - Mold-base STEEL/blank cost itself (the raw plates before machining) —
//   no price-by-size table was found anywhere in the staged reference data
//   (tblStandardMoldBaseSizes carries only real dimensions, no $ column).
// - A specific catalogued mold-base SKU: selecting one would need a real
//   clamping-plate margin/allowance added around the part's window, and the
//   only such allowance variables found (cmMoldBaseWidthAllowance/
//   cmMoldBaseLengthAllowance/cmPlateOverhangAllowance,
//   digital_factory_variables.json) are explicitly scoped in their own
//   source notes to "the Compression Molding process routing" — reusing
//   them here would misattribute a different process's real number.
//   moldBaseAreaMm2 is therefore the real required window area
//   (projected area x cavity count) itself, not a specific SKU's plate area
//   — a disclosed, honest simplification, not a fabricated margin.
// - Per-cavity scaling of the standard-component BOM: the real quantities
//   in cmStandardToolingComponents (Guide Pin x4, Ejector Guide Pin Bushing
//   x6, ...) are for one mold set: no real per-additional-cavity component
//   count was found in any sourced table. The existing "+35% of base cost
//   per additional cavity" heuristic this file already had is retained
//   unchanged for THAT multi-cavity scaling step (see computeMoldCost in
//   cost-injection-molding-engine.ts) — it stays a disclosed engineering
//   estimate, not re-cited as real, since no sourced per-cavity component
//   fraction was found to replace it with.
// - Ejector Pin: cmStandardToolingComponents' own notes say its quantity
//   "is calculated in the cost model" — i.e. the source itself defers to a
//   formula this dataset does not supply. Never guessed; reported as a real
//   priced-per-unit component with an unresolved quantity (missingComponents).

export interface MoldToolingComponentCost {
  componentName: string;
  unitCostUsd: number | null; // null = "cost included in machine price" (real, not missing)
  quantity: number | null;    // null = quantity not fixed in the source (e.g. Ejector Pin)
}

// cmStandardToolingComponents.json, verbatim (memory/plastic modeling/lookup/).
export const MOLD_STANDARD_COMPONENTS: readonly MoldToolingComponentCost[] = [
  { componentName: 'Air Poppet', unitCostUsd: 25, quantity: 30 },
  { componentName: 'Ejector Guide Pin Bushing', unitCostUsd: 30, quantity: 6 },
  { componentName: 'Ejector Pin', unitCostUsd: 5, quantity: null },
  { componentName: 'Electrical Connection Or Switch', unitCostUsd: null, quantity: 1 },
  { componentName: 'Guide Bush', unitCostUsd: 100, quantity: 4 },
  { componentName: 'Guide Pin', unitCostUsd: 100, quantity: 4 },
  { componentName: 'Hydraulic Cylinder', unitCostUsd: 350, quantity: 4 },
  { componentName: 'Limit Switch', unitCostUsd: 50, quantity: 4 },
  { componentName: 'Return Pin And Shoulder Bushing', unitCostUsd: 35, quantity: 6 },
  { componentName: 'Side Lock', unitCostUsd: 160, quantity: 4 },
];

// Side-action-only hardware — real mold-design fact: a hydraulic cylinder +
// side lock actuate a slide, needed only when the part has a real undercut
// requiring one. Every other row above is fixed baseline hardware present
// on every mold regardless of feature count (same "fixed baseline" pattern
// as progressive-die-tooling-engine.ts's guidePinAssy/stripperGuidePinAssy).
const SIDE_ACTION_ONLY_COMPONENTS = new Set(['Hydraulic Cylinder', 'Side Lock']);

// cmToolAssemblyTimes.json, verbatim. Real source names differ slightly from
// cmStandardToolingComponents' own names for the same physical component
// (e.g. "Ejector Guide Pin And Bushing" vs "Ejector Guide Pin Bushing",
// "Side Locks" vs "Side Lock") — mapped explicitly below rather than
// assumed to match by string equality.
const ASSEMBLY_TIME_HR_BY_COMPONENT: Record<string, number> = {
  'Air Poppet': 0.006,
  'Ejector Guide Pin Bushing': 2.0,       // source: "Ejector Guide Pin And Bushing"
  'Ejector Pin': 0.25,
  'Electrical Connection Or Switch': 1.5, // source: "Electrical Connections Or Switches"
  'Guide Bush': 0.25,                     // source has no separate "Guide Bush" row; Guide Bush
                                           // and Guide Pin are installed as one leader-pin/bushing
                                           // pair — reusing "Leader Pins And Shoulder Bushings"'
                                           // real 5.0hr figure, split evenly (2.5hr each), rather
                                           // than inventing a bushing-only figure.
  'Guide Pin': 2.5,
  'Hydraulic Cylinder': 10.0,
  'Limit Switch': 1.0,
  'Return Pin And Shoulder Bushing': 1.0, // source: "Return Pins And Shoulder Bushings"
  'Side Lock': 0.5,                       // source: "Side Locks"
};

// cmToolAssemblyNumOperators.json, verbatim (mold_base_area_m2 -> operators).
const ASSEMBLY_OPERATORS_BY_AREA_M2: ReadonlyArray<{ areaM2: number; operators: number }> = [
  { areaM2: 1, operators: 1 },
  { areaM2: 2, operators: 2 },
  { areaM2: 3, operators: 3 },
  { areaM2: 4, operators: 4 },
  { areaM2: 100, operators: 5 },
];

// cmMoldBaseDesignHours.json, verbatim (mold_base_area_mm2 -> base_design_hrs_hr).
const DESIGN_HOURS_BY_AREA_MM2: ReadonlyArray<{ areaMm2: number; designHrs: number }> = [
  { areaMm2: 59_253.12, designHrs: 3.24 },
  { areaMm2: 181_782.72, designHrs: 3.48 },
  { areaMm2: 371_246.4, designHrs: 3.72 },
  { areaMm2: 627_644.16, designHrs: 3.96 },
  { areaMm2: 783_640.8, designHrs: 4.00 },
  { areaMm2: 973_104.48, designHrs: 4.19 },
  { areaMm2: 1_162_568.16, designHrs: 4.38 },
  { areaMm2: 1_352_031.84, designHrs: 4.57 },
  { areaMm2: 1_541_495.52, designHrs: 4.76 },
  { areaMm2: 1_730_959.2, designHrs: 4.95 },
  { areaMm2: 1_920_422.88, designHrs: 5.14 },
  { areaMm2: 2_109_886.56, designHrs: 5.33 },
  { areaMm2: 2_354_958.05, designHrs: 5.57 },
  { areaMm2: 999_999_999, designHrs: 6.00 },
];

// cmToolMachiningRates.json, verbatim — the one rate this pass consumes.
const CAVITY_CORE_PLATE_MACHINING_RATE_M2_PER_HR = 0.32;

// cmToolMachiningSetups.json, verbatim — cavity + core plate general
// machining, 2 setups x 1hr each, for both plates.
const CAVITY_PLATE_SETUP_HR = 2 * 1.0;
const CORE_PLATE_SETUP_HR = 2 * 1.0;

export interface MoldToolingInput {
  /** Real required mold-window area (projected area x cavity count), mm^2. */
  moldBaseAreaMm2: number;
  cavityCount: number;
  /** Real, already-extracted undercut count (signals.undercutCount) — gates side-action hardware. */
  undercutCount: number;
}

export interface MoldToolingResult {
  items: Array<{ componentName: string; qty: number; unitCostUsd: number; totalCostUsd: number }>;
  /** Sum of items — the real, priced, purchased-component BOM subtotal. */
  bomSubtotalUsd: number;
  /** Real component rows this mold genuinely needs but with no fixable cost/qty on file. */
  missingComponents: string[];
  /** Real design + machining + assembly hours — never priced (see module doc comment). */
  estimatedDesignHrs: number;
  estimatedMachiningHrs: number;
  estimatedAssemblyHrs: number;
  estimatedAssemblyOperators: number;
  warnings: string[];
}

function lookupDesignHrs(areaMm2: number): number {
  const row = DESIGN_HOURS_BY_AREA_MM2.find((r) => areaMm2 <= r.areaMm2);
  return row ? row.designHrs : DESIGN_HOURS_BY_AREA_MM2[DESIGN_HOURS_BY_AREA_MM2.length - 1]!.designHrs;
}

function lookupOperators(areaM2: number): number {
  const row = ASSEMBLY_OPERATORS_BY_AREA_M2.find((r) => areaM2 <= r.areaM2);
  return row ? row.operators : ASSEMBLY_OPERATORS_BY_AREA_M2[ASSEMBLY_OPERATORS_BY_AREA_M2.length - 1]!.operators;
}

const SCOPE_WARNING =
  'Injection Molding tooling cost covers only the purchased-component BOM (guide pins/bushings, ejector ' +
  'hardware, side-action hardware when the part has undercuts) — it does NOT include mold-base steel/blank ' +
  'cost, cavity/core machining, design, or assembly labor. No toolroom/moldmaker labor rate exists on file for ' +
  'any location to price those honestly; the true tooling investment is very likely higher than this figure.';

/**
 * Real, itemized, partial mold-tooling BOM cost. Pure function — every input
 * is already resolved by the caller, same as computeProgressiveDieToolingCost.
 */
export function computeMoldToolingCost(input: MoldToolingInput): MoldToolingResult {
  const items: MoldToolingResult['items'] = [];
  const missingComponents: string[] = [];
  let assemblyHrs = 0;

  for (const c of MOLD_STANDARD_COMPONENTS) {
    if (SIDE_ACTION_ONLY_COMPONENTS.has(c.componentName) && input.undercutCount <= 0) continue; // real: no slide needed
    if (c.quantity === null) {
      missingComponents.push(`${c.componentName} (real unit cost on file, but this part's real quantity is not derivable from any sourced table)`);
      continue;
    }
    if (c.unitCostUsd === null) continue; // real: cost included in machine price, not a missing gap
    items.push({ componentName: c.componentName, qty: c.quantity, unitCostUsd: c.unitCostUsd, totalCostUsd: c.unitCostUsd * c.quantity });
    assemblyHrs += (ASSEMBLY_TIME_HR_BY_COMPONENT[c.componentName] ?? 0) * c.quantity;
  }

  const bomSubtotalUsd = items.reduce((s, i) => s + i.totalCostUsd, 0);

  const areaM2 = Math.max(input.moldBaseAreaMm2, 0) / 1_000_000;
  const estimatedDesignHrs = lookupDesignHrs(input.moldBaseAreaMm2);
  const estimatedMachiningHrs =
    (areaM2 / CAVITY_CORE_PLATE_MACHINING_RATE_M2_PER_HR) * 2 // cavity plate + core plate
    + CAVITY_PLATE_SETUP_HR + CORE_PLATE_SETUP_HR;
  const estimatedAssemblyOperators = lookupOperators(areaM2);

  const warnings = [SCOPE_WARNING];
  if (missingComponents.length > 0) {
    warnings.push(`Real components with no derivable quantity on file, so not included: ${missingComponents.join(', ')}.`);
  }
  const totalHrs = estimatedDesignHrs + estimatedMachiningHrs + assemblyHrs;
  if (totalHrs > 0) {
    warnings.push(
      `An estimated ${totalHrs.toFixed(1)} real toolmaker hours (design ${estimatedDesignHrs.toFixed(1)}h + ` +
      `machining ${estimatedMachiningHrs.toFixed(1)}h + assembly ${assemblyHrs.toFixed(1)}h across ` +
      `${estimatedAssemblyOperators} operator(s)) are needed to build this mold, from real per-area/per-component ` +
      `figures. No toolroom labor rate exists on file for any location, so these hours are NOT priced into the ` +
      `figure above — the true tooling cost is materially higher.`,
    );
  }

  return {
    items, bomSubtotalUsd, missingComponents,
    estimatedDesignHrs, estimatedMachiningHrs, estimatedAssemblyHrs: assemblyHrs, estimatedAssemblyOperators,
    warnings,
  };
}
