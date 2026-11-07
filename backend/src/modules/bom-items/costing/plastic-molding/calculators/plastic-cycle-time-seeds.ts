/**
 * The inputs of the plastic-molding cycle-time calculators (plastic-molding-calculators.json), seeded from what the cost engine already holds: the material's
 * reference thermal properties, the selected press's timing, the staged Plastic reference (variables and the injectionTimeAdjustmentFactors table), the CAD wall
 * and the route's shot volume. Each seed names its source, as the other domains' seeds do (reference-calculator.ts), so the cost dialog can show where every
 * number came from. The formulas are the calculator's, stored in the database; nothing here computes a time.
 *
 * What the engine decides stays here, not in a formula: whether an input exists, and whether the Menges equation has a solution (the eject temperature must lie
 * between the mold wall and the melt). Both come back as named missing inputs, never a default.
 */
import type { CalcSeed } from '../../shared/calculators/reference-calculator';
import { bracketFactor, hasMengesSolution, resinThermalProps, type CycleTimeInput } from '../process/cycle-time';

const positive = (v: number | null | undefined): v is number => v != null && Number.isFinite(v) && v > 0;

export const INJECTION_CALCULATOR = 'Injection Molding - Cycle Time';
export const STRUCTURAL_FOAM_CALCULATOR = 'Structural Foam Molding - Cycle Time';
export const LSR_CALCULATOR = 'Injection Molding - LSR Cycle Time';
export const COMPRESSION_CALCULATOR = 'Compression Molding - Cycle Time';
export const RIM_CALCULATOR = 'Reaction Injection Molding - Cycle Time';

export type SeedResult = { seeds: Record<string, CalcSeed> } | { missing: string[] };

const REF = 'memory/Plastic Modeling';

/** The seeds shared by the injection, structural foam and LSR calculators: wall, shot volume, press rate and dry cycle, the two fill factors and the global factor. */
function commonSeeds(input: CycleTimeInput, missing: string[]): Record<string, CalcSeed> {
  const seeds: Record<string, CalcSeed> = {};
  if (positive(input.wallMm)) seeds['Nominal Wall Thickness'] = { value: input.wallMm, source: 'CAD nominal wall thickness' };
  else missing.push('nominal wall thickness (CAD)');

  const rate = input.press?.injectionRateMm3PerS ?? null;
  if (positive(rate)) seeds['Press Injection Rate'] = { value: rate, source: 'Press reference record: rates.injectionRateMm3PerS' };
  else missing.push('press injection rate (injectionRateMm3PerS)');

  const dry = input.press?.dryCycleTimeS ?? null;
  if (positive(dry)) seeds['Press Dry Cycle Time'] = { value: dry, source: 'Press reference record: time.dryCycleTimeS (Euromap 6, mold open and close)' };
  else missing.push('press dry cycle time (dryCycleTimeS)');

  if (positive(input.shotMeltVolumeMm3)) seeds['Shot Melt Volume'] = { value: input.shotMeltVolumeMm3, source: 'Part volume x cavities + runner, at the material melt density' };
  else missing.push('shot melt volume (part volume and melt density)');

  const cavities = Math.max(input.cavityCount, 1);
  const gates = Math.max(input.gatesPerCavity, 1);
  const cavityRow = input.model.fillFactorByCavities.find((r) => cavities <= r.upTo) ?? input.model.fillFactorByCavities[input.model.fillFactorByCavities.length - 1]!;
  const gateRow = input.model.fillFactorByGates.find((r) => gates <= r.upTo) ?? input.model.fillFactorByGates[input.model.fillFactorByGates.length - 1]!;
  seeds['Fill Factor for Cavities'] = {
    value: bracketFactor(input.model.fillFactorByCavities, cavities), lookup: true,
    source: `${REF}/lookup/injectionTimeAdjustmentFactors: Cavities Per Mold, ${cavities} cavities`,
    match: { table: 'injectionTimeAdjustmentFactors', row: { attribute: 'Cavities Per Mold', number: cavityRow.upTo } },
  };
  seeds['Fill Factor for Gates'] = {
    value: bracketFactor(input.model.fillFactorByGates, gates), lookup: true,
    source: `${REF}/lookup/injectionTimeAdjustmentFactors: Gates Per Cavity, ${gates} gates per cavity`,
    match: { table: 'injectionTimeAdjustmentFactors', row: { attribute: 'Gates Per Cavity', number: gateRow.upTo } },
  };
  seeds['Cycle Time Adjustment Factor'] = { value: input.model.cycleTimeAdjustmentFactor, source: `${REF}/variables: cycleTimeAdjustmentFactor` };
  return seeds;
}

/** The calculator that computes this input's cycle, by name: the LSR variant for a liquid silicone, otherwise the process's own (injection, or structural foam). */
export function injectionCalculatorName(isLsr: boolean, process: 'injection' | 'structural_foam'): string {
  return isLsr ? LSR_CALCULATOR : process === 'structural_foam' ? STRUCTURAL_FOAM_CALCULATOR : INJECTION_CALCULATOR;
}

/** Seeds for the injection / structural foam / LSR cycle-time calculators, or the inputs that are missing (each named). */
export function injectionCycleTimeSeeds(input: CycleTimeInput): SeedResult {
  const missing: string[] = [];
  const seeds = commonSeeds(input, missing);
  if (!input.isLsr) {
    const thermal = resinThermalProps(input.real, input.model.moldTemperatureIncreaseC);
    if ('missing' in thermal) {
      missing.push(...thermal.missing.map((m) => `material ${m}`));
    } else {
      const r = input.real!;
      if (positive(input.wallMm) && !hasMengesSolution(input.wallMm, thermal.props)) {
        missing.push('material temperatures give no Menges solution (eject must lie between mold and melt)');
      }
      const material = 'Material reference (raw_materials)';
      seeds['Melt Temperature'] = { value: r.meltingTempC!, source: `${material}: melting temperature` };
      seeds['Mold Temperature'] = { value: r.moldTempC!, source: `${material}: mold temperature` };
      seeds['Mold Temperature Increase'] = { value: input.model.moldTemperatureIncreaseC, source: `${REF}/variables: defaultMoldTemperatureIncrease` };
      seeds['Ejection Temperature'] = { value: r.ejectionTempC!, source: `${material}: eject temperature` };
      seeds['Specific Heat of Melt'] = { value: r.specificHeatMeltJgC!, source: `${material}: specific heat of melt` };
      seeds['Thermal Conductivity of Melt'] = { value: r.thermalConductivityMeltWMK!, source: `${material}: thermal conductivity of melt` };
      seeds['Melt Density'] = { value: r.densityOfMeltKgM3!, source: `${material}: density of melt` };
    }
  }
  return missing.length > 0 ? { missing } : { seeds };
}

/**
 * Seeds for the compression calculator: the machine's press open/close time and the material's cure time in minutes. A grade with no cure time on file is seeded 0, as
 * the engine always has (it then costs the press motion alone and says the cycle is understated): never a typical value.
 */
export function pressCycleTimeSeeds(input: { pressCycleTimeS: number | null; cureTimeMin: number | null }): SeedResult {
  if (!positive(input.pressCycleTimeS)) return { missing: ['press open/close time (press_cycle_time_s)'] };
  return { seeds: { 'Press Open/Close Time': { value: input.pressCycleTimeS, source: 'Machine record: press_cycle_time_s' }, 'Material Cure Time': cureSeed(input.cureTimeMin) } };
}

function cureSeed(cureTimeMin: number | null): CalcSeed {
  const hasCure = positive(cureTimeMin);
  return {
    value: hasCure ? cureTimeMin! : 0,
    source: hasCure ? 'Material reference (raw_materials.cure_time_min)' : 'No cure time on file for this material grade: not included, so the cycle is understated (not a default)',
  };
}

/**
 * Seeds for the reaction injection calculator: the machine's dry cycle (s), the part volume (mm3), the machine's injection rate (mm3/s) and the material's cure time (min).
 * Units are the staged ones and are stated on the fields: the shot volume in mm3 over the rate in mm3/s gives seconds. A missing, zero, negative or non-finite volume,
 * rate or dry cycle is named, never defaulted: the fill time has no value without them. No runner volume is staged for RIM, so none is added.
 */
export function rimCycleTimeSeeds(input: { machineCycleTimeS: number | null; partVolumeMm3: number | null; injectionRateMm3PerS: number | null; cureTimeMin: number | null }): SeedResult {
  const missing: string[] = [];
  if (!positive(input.machineCycleTimeS)) missing.push('machine dry cycle time (press_cycle_time_s)');
  if (!positive(input.partVolumeMm3)) missing.push('part volume (CAD volume, mm3)');
  if (!positive(input.injectionRateMm3PerS)) missing.push('machine injection rate (injectionRateMm3PerS, mm3/s)');
  if (missing.length > 0) return { missing };
  return {
    seeds: {
      'Machine Dry Cycle Time': { value: input.machineCycleTimeS!, source: 'Machine record: press_cycle_time_s (time.dryCycleTimeS)' },
      'Part Volume': { value: input.partVolumeMm3!, source: 'CAD net part volume (mm3)' },
      'Cavities per Mold': { value: 1, source: 'Cost engine: the RIM engine prices one part per press cycle' },
      'Machine Injection Rate': { value: input.injectionRateMm3PerS!, source: `Machine record: ${REF}/machine/reaction_injection_molding_machines.csv rates.injectionRateMm3PerS (mm3/s)` },
      'Material Cure Time': cureSeed(input.cureTimeMin),
    },
  };
}
