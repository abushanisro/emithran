// Formula registry (plastic-molding/formula-registry.ts): F-16. Change a formula or its constants -> bump its version there.
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
//   "is calculated in the cost model": the tooling calculator counts the pins
//   (the molded area over areaCoveredPerEjectorPin, F-27) and prices them, so
//   the component list leaves it out rather than reporting it missing.

import { componentNameKey, type MoldToolingTables } from '../plastic-reference';

// Side-action-only hardware — real mold-design fact: a hydraulic cylinder +
// side lock actuate a slide, needed only when the part has a real undercut
// requiring one. Every other component is fixed baseline hardware present on
// every mold regardless of feature count (same "fixed baseline" pattern as
// progressive-die-tooling-engine.ts's guidePinAssy/stripperGuidePinAssy).
const SIDE_ACTION_ONLY_COMPONENTS = new Set(['Hydraulic Cylinder', 'Side Lock'].map(componentNameKey));

interface MoldToolingInput {
  /** Real required mold-window area (projected area x cavity count), mm^2. */
  moldBaseAreaMm2: number;
  cavityCount: number;
  /** Real, already-extracted undercut count (signals.undercutCount) — gates side-action hardware. */
  undercutCount: number;
  /**
   * Recognised bundles only a slide can serve. Null = the features were not recognised (older engine): the hardware then follows undercutCount, as it did.
   * Known: the slide hardware is priced when there is at least one, and only then, because a lifter has none of it.
   */
  slideBundles: number | null;
  /** Bundles a lifter or a slide could serve: not decided (clearance beside the part), so no slide hardware is assumed for them. */
  slideOrLifterBundles: number;
  /** Staged tooling tables (plastic-reference.ts). */
  tables: MoldToolingTables;
  /** What decides which of the remaining gaps apply to this mold: a hot runner needs hot drops, an insert-built class needs inserts, a texture needs texturing. */
  scope: { runner: 'hot' | 'cold'; classUsesInserts: boolean | null; cavityTexture: string; sideActionsPriced: boolean };
}

interface MoldToolingResult {
  items: Array<{ componentName: string; qty: number; unitCostUsd: number; totalCostUsd: number }>;
  /** Sum of items — the real, priced, purchased-component BOM subtotal. */
  bomSubtotalUsd: number;
  /** Real component rows this mold genuinely needs but with no fixable cost/qty on file. */
  missingComponents: string[];
  /** Design and assembly hours, from the staged tables; the machining hours and every price are the tooling calculator's (mold-tooling-calculator.ts). */
  estimatedDesignHrs: number;
  estimatedAssemblyHrs: number;
  estimatedAssemblyOperators: number;
  warnings: string[];
}

// Bracket tables: the first row whose bound is at or above the value (the
// last row is the catch-all).
function bracket<T>(rows: readonly T[], bound: (r: T) => number, value: number): T {
  return rows.find((r) => value <= bound(r)) ?? rows[rows.length - 1]!;
}

// Priced by the tooling calculator from the staged ejector pin count and the components below; the list leaves it out (see the header).
const CALCULATOR_PRICED_COMPONENTS = new Set(['Ejector Pin'].map(componentNameKey));

/**
 * What the tooling cost includes and what it still leaves out for this mold. Hot drops, inserts and texture are left out only when they apply: a cold
 * runner has no hot drops, a class tblSpiType builds without inserts has none, and the default texture "None" is no texture.
 */
/** The registry gaps (formula-registry.ts) left in a priced mold: EDM and the water baffles always; slides and lifters when the CAD bundles are not all sized; texture, inserts, hot drops where they apply. */
export function toolingGapIds(scope: MoldToolingInput['scope']): string[] {
  return [
    ...(scope.sideActionsPriced ? [] : ['G-03']),
    'G-04',
    ...(scope.cavityTexture.toLowerCase() !== 'none' ? ['G-05'] : []),
    'G-06',
    ...(scope.classUsesInserts !== false ? ['G-07'] : []),
    ...(scope.runner === 'hot' ? ['G-08'] : []),
  ];
}

export function toolingScopeWarning(scope: MoldToolingInput['scope']): string {
  const left = [...(scope.sideActionsPriced ? [] : ['slides and lifters (the CAD bundles are not all recognised and sized)']), 'EDM', 'water baffles (no count on file)'];
  if (scope.runner === 'hot') left.push('hot drops (the number of drops is not on file)');
  if (scope.classUsesInserts !== false) left.push('cavity inserts');
  if (scope.cavityTexture.toLowerCase() !== 'none') left.push(`the ${scope.cavityTexture} texture`);
  return 'Injection Molding tooling cost includes the mold base plate steel, the cavity and core machining and polish, the standard components, the ejector '
    + `pins, sprue bushing, locating ring, try-out, ${scope.sideActionsPriced ? 'the slide and lifter blocks, ' : ''}the heat treatment, the cooling lines and the toolroom hours; it does NOT include ${left.join(', ')} (no formula on file yet): the true tooling `
    + 'investment is higher than this figure.';
}

/**
 * Real, itemized, partial mold-tooling BOM cost. Pure function — every input
 * is already resolved by the caller, same as computeProgressiveDieToolingCost.
 */
export function computeMoldToolingCost(input: MoldToolingInput): MoldToolingResult {
  const items: MoldToolingResult['items'] = [];
  const missingComponents: string[] = [];
  const noAssemblyTime: string[] = [];
  let assemblyHrs = 0;

  // Slide hardware (hydraulic cylinder, side lock): by the recognised slide bundles when the features were recognised, else by the undercut count.
  const needsSlideHardware = input.slideBundles == null ? input.undercutCount > 0 : input.slideBundles > 0;
  const t = input.tables;
  const assemblyHrByKey = new Map(t.assemblyTimes.map((a) => [componentNameKey(a.name), a.hours]));
  for (const c of t.components) {
    if (SIDE_ACTION_ONLY_COMPONENTS.has(componentNameKey(c.name)) && !needsSlideHardware) continue; // real: no slide needed
    if (CALCULATOR_PRICED_COMPONENTS.has(componentNameKey(c.name))) continue;
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
  const estimatedAssemblyOperators = bracket(t.operatorsByArea, (r) => r.areaM2, areaM2).operators;

  const warnings = [toolingScopeWarning(input.scope)];
  if (input.slideBundles != null && input.slideBundles === 0 && input.slideOrLifterBundles > 0) {
    warnings.push(
      `Slide hardware (hydraulic cylinder, side lock) is not priced: ${input.slideOrLifterBundles} side-action bundle${input.slideOrLifterBundles === 1 ? '' : 's'} could be lifters or slides, `
      + 'which depends on the clearance beside the part in the tool and is not assessed. No lifter hardware cost is on file.',
    );
  }
  if (input.slideBundles != null && input.slideBundles > 0) {
    warnings.push(
      `Slide hardware is priced at the staged quantity for one mold set (cmStandardToolingComponents), not scaled by the ${input.slideBundles} slide bundle${input.slideBundles === 1 ? '' : 's'}: no per-slide quantity is on file.`,
    );
  }
  if (missingComponents.length > 0) {
    warnings.push(`Real components with no derivable quantity on file, so not included: ${missingComponents.join(', ')}.`);
  }
  if (noAssemblyTime.length > 0) {
    warnings.push(`No assembly time on file (cmToolAssemblyTimes) for: ${noAssemblyTime.join(', ')}; not counted in assembly hours.`);
  }
  return {
    items, bomSubtotalUsd, missingComponents,
    estimatedDesignHrs, estimatedAssemblyHrs: assemblyHrs, estimatedAssemblyOperators,
    warnings,
  };
}
