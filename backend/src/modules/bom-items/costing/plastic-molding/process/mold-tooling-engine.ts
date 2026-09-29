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
//   (3) price (2) at the reference toolroom rates (digital_factory_settings_usa:
//       design / machining / assembly USD/hr) when the caller has them for the
//       quote location. memory/ holds toolroom rates for USA only; anywhere
//       else the hours are reported unpriced, never priced at another
//       location's rate.
//
// SOURCE DATA: the staged memory/Plastic Modeling lookups, resolved by
// plastic-reference.ts and passed in (MoldToolingInput.tables), never copied
// here: cmStandardToolingComponents (unit cost + quantity), cmToolAssemblyTimes
// (hours per component, matched by componentNameKey), cmToolAssemblyNumOperators
// and cmMoldBaseDesignHours (by mold-base area), cmToolMachiningRates and
// cmToolMachiningSetups (cavity/core plate general machining).
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

import { componentNameKey, type MoldToolingTables } from '../plastic-reference';

// Side-action-only hardware — real mold-design fact: a hydraulic cylinder +
// side lock actuate a slide, needed only when the part has a real undercut
// requiring one. Every other component is fixed baseline hardware present on
// every mold regardless of feature count (same "fixed baseline" pattern as
// progressive-die-tooling-engine.ts's guidePinAssy/stripperGuidePinAssy).
const SIDE_ACTION_ONLY_COMPONENTS = new Set(['Hydraulic Cylinder', 'Side Lock'].map(componentNameKey));

export interface MoldToolingInput {
  /** Real required mold-window area (projected area x cavity count), mm^2. */
  moldBaseAreaMm2: number;
  cavityCount: number;
  /** Real, already-extracted undercut count (signals.undercutCount) — gates side-action hardware. */
  undercutCount: number;
  /** Staged tooling tables (plastic-reference.ts). */
  tables: MoldToolingTables;
  /** Toolroom rates for the quote location, or null when none is on file for it. */
  toolroomRates: { designUsdPerHr: number; machiningUsdPerHr: number; assemblyUsdPerHr: number } | null;
  /** Quote location, named in the warning when toolroomRates is null. */
  location: string;
}

export interface MoldToolingResult {
  items: Array<{ componentName: string; qty: number; unitCostUsd: number; totalCostUsd: number }>;
  /** Sum of items — the real, priced, purchased-component BOM subtotal. */
  bomSubtotalUsd: number;
  /** Real component rows this mold genuinely needs but with no fixable cost/qty on file. */
  missingComponents: string[];
  /** Design + machining + assembly hours; priced into labourCostUsd when rates are on file. */
  estimatedDesignHrs: number;
  estimatedMachiningHrs: number;
  estimatedAssemblyHrs: number;
  estimatedAssemblyOperators: number;
  /** Hours x toolroom rates, or null when the location has no toolroom rate on file. */
  labourCostUsd: number | null;
  warnings: string[];
}

// Bracket tables: the first row whose bound is at or above the value (the
// last row is the catch-all).
function bracket<T>(rows: readonly T[], bound: (r: T) => number, value: number): T {
  return rows.find((r) => value <= bound(r)) ?? rows[rows.length - 1]!;
}

const SCOPE_WARNING =
  'Injection Molding tooling cost does NOT include mold-base steel/blank cost (no price-by-size table is on ' +
  'file); the true tooling investment is higher than this figure.';

/**
 * Real, itemized, partial mold-tooling BOM cost. Pure function — every input
 * is already resolved by the caller, same as computeProgressiveDieToolingCost.
 */
export function computeMoldToolingCost(input: MoldToolingInput): MoldToolingResult {
  const items: MoldToolingResult['items'] = [];
  const missingComponents: string[] = [];
  const noAssemblyTime: string[] = [];
  let assemblyHrs = 0;

  const t = input.tables;
  const assemblyHrByKey = new Map(t.assemblyTimes.map((a) => [componentNameKey(a.name), a.hours]));
  for (const c of t.components) {
    if (SIDE_ACTION_ONLY_COMPONENTS.has(componentNameKey(c.name)) && input.undercutCount <= 0) continue; // real: no slide needed
    if (c.quantity === null) {
      missingComponents.push(`${c.name} (real unit cost on file, but this part's real quantity is not derivable from any sourced table)`);
      continue;
    }
    if (c.unitCostUsd === null) continue; // real: cost included in machine price, not a missing gap
    items.push({ componentName: c.name, qty: c.quantity, unitCostUsd: c.unitCostUsd, totalCostUsd: c.unitCostUsd * c.quantity });
    const hr = assemblyHrByKey.get(componentNameKey(c.name));
    if (hr == null) noAssemblyTime.push(c.name);
    else assemblyHrs += hr * c.quantity;
  }

  const bomSubtotalUsd = items.reduce((s, i) => s + i.totalCostUsd, 0);

  const areaM2 = Math.max(input.moldBaseAreaMm2, 0) / 1_000_000;
  const estimatedDesignHrs = bracket(t.designHoursByArea, (r) => r.areaMm2, input.moldBaseAreaMm2).hours;
  const estimatedMachiningHrs =
    (areaM2 / t.plateMachiningRateM2PerHr) * 2 // cavity plate + core plate
    + t.cavityPlateSetupHr + t.corePlateSetupHr;
  const estimatedAssemblyOperators = bracket(t.operatorsByArea, (r) => r.areaM2, areaM2).operators;

  const warnings = [SCOPE_WARNING];
  if (missingComponents.length > 0) {
    warnings.push(`Real components with no derivable quantity on file, so not included: ${missingComponents.join(', ')}.`);
  }
  if (noAssemblyTime.length > 0) {
    warnings.push(`No assembly time on file (cmToolAssemblyTimes) for: ${noAssemblyTime.join(', ')}; not counted in assembly hours.`);
  }
  const r = input.toolroomRates;
  const labourCostUsd = r
    ? estimatedDesignHrs * r.designUsdPerHr + estimatedMachiningHrs * r.machiningUsdPerHr + assemblyHrs * r.assemblyUsdPerHr
    : null;
  const totalHrs = estimatedDesignHrs + estimatedMachiningHrs + assemblyHrs;
  if (labourCostUsd == null && totalHrs > 0) {
    warnings.push(
      `${totalHrs.toFixed(1)} toolmaker hours (design ${estimatedDesignHrs.toFixed(1)}h + machining ` +
      `${estimatedMachiningHrs.toFixed(1)}h + assembly ${assemblyHrs.toFixed(1)}h) are NOT priced: memory/ has ` +
      `toolroom rates for USA only, none for ${input.location}. The true tooling cost is materially higher.`,
    );
  }

  return {
    items, bomSubtotalUsd, missingComponents,
    estimatedDesignHrs, estimatedMachiningHrs, estimatedAssemblyHrs: assemblyHrs, estimatedAssemblyOperators,
    labourCostUsd,
    warnings,
  };
}
