// Formula registry (plastic-molding/formula-registry.ts): F-04, F-05, F-06, F-07, F-08, F-09. Change a formula or its constants -> bump its version there.
//
// The inputs and the result of a molding cycle time. The cycle time itself is computed by the stored calculators (plastic-molding-calculators.json, migration 975;
// see calculators/plastic-cycle-time.ts), as for heat treatment, machining and die casting: the formulas are in the database, the engine supplies the inputs. What
// stays here is what the engine decides before a calculator runs: the material's thermal properties from its reference values, whether the Menges equation has a
// solution (the eject temperature must lie between the mold wall and the melt), and the bracket of a staged lookup table.
//
// The model the calculators state (the documentation is docs/plastic-modeling/cycle-time-calculators.md):
//   Cooling       Menges: t = (s² / π²α) × ln((4/π)(Tm − Tw)/(Te − Tw)), α = k / (ρ_melt × cp); Tm, Tw (+ defaultMoldTemperatureIncrease), Te, k, cp, ρ_melt are
//                 the material's reference values
//   Fill          shot melt volume / the press's injectionRateMm3PerS, times the injectionTimeAdjustmentFactors for cavities per mold and gates per cavity
//   Mold motion   the press's Euromap 6 dry cycle (time.dryCycleTimeS)
//   Pack / hold   0.35 × cooling, floor 2 s: the Menges gate-freeze rule (the reference data holds no hold-time value)
//   Total         (fill + pack + cool + mold motion) × cycleTimeAdjustmentFactor
// Ejector travel is not modelled. Any input missing makes the cycle not derivable, with each missing input named; nothing is filled from a default.
// LSR (thermoset) cures instead of cooling (Arrhenius, literature constants), no pack phase.

import type { CycleModel } from '../plastic-reference';
import type { CalculationTraceStep } from '../../../dto/cost-breakdown.dto';

export type GateType = 'edge' | 'fan' | 'sub' | 'hot_tip';

/** The material's reference thermal properties (resolveMaterialForFamily). */
export interface RealResinInputs {
  meltingTempC: number | null;
  moldTempC: number | null;
  ejectionTempC: number | null;
  specificHeatMeltJgC: number | null;
  thermalConductivityMeltWMK: number | null;
  densityOfMeltKgM3: number | null;
}

export interface ResinThermalProps {
  alpha: number; // thermal diffusivity, mm²/s
  Tm: number;    // melt temperature, C
  Tw: number;    // mold wall temperature, C
  Te: number;    // ejection temperature, C
}

/** The press's own reference timing (PlasticReferenceService.getPressSpecs). */
export interface PressTiming {
  injectionRateMm3PerS: number | null;
  dryCycleTimeS: number | null;
}

type ThermalResult = { props: ResinThermalProps } | { missing: string[] };

export function resinThermalProps(real: RealResinInputs | null | undefined, moldTemperatureIncreaseC: number): ThermalResult {
  const need: Array<[keyof RealResinInputs, string]> = [
    ['meltingTempC', 'melting temperature'], ['moldTempC', 'mold temperature'], ['ejectionTempC', 'eject temperature'],
    ['specificHeatMeltJgC', 'specific heat of melt'], ['thermalConductivityMeltWMK', 'thermal conductivity of melt'],
    ['densityOfMeltKgM3', 'density of melt'],
  ];
  const missing = need.filter(([k]) => !(real?.[k] != null && Number(real[k]) > 0)).map(([, label]) => label);
  if (missing.length > 0) return { missing };
  const r = real!;
  // α = k / (ρ·cp): k W/(m·K), ρ kg/m³, cp J/(g·K) -> J/(kg·K); m²/s -> mm²/s.
  const alpha = (r.thermalConductivityMeltWMK! / (r.densityOfMeltKgM3! * r.specificHeatMeltJgC! * 1000)) * 1e6;
  return { props: { alpha, Tm: r.meltingTempC!, Tw: r.moldTempC! + moldTemperatureIncreaseC, Te: r.ejectionTempC! } };
}

/** True when the Menges equation has a solution for this wall and these temperatures (the eject temperature lies between the mold wall and the melt). */
export function hasMengesSolution(wallMm: number, props: ResinThermalProps): boolean {
  const { alpha, Tm, Tw, Te } = props;
  if (!(wallMm > 0) || !(alpha > 0) || Te - Tw <= 0) return false;
  return (4 / Math.PI) * (Tm - Tw) / (Te - Tw) > 1;
}

/** The factor of the first bracket whose upper bound covers the value (the last covers the rest). */
export function bracketFactor(rows: ReadonlyArray<{ upTo: number; factor: number }>, value: number): number {
  return (rows.find((r) => value <= r.upTo) ?? rows[rows.length - 1]!).factor;
}

export type CycleTimeResult =
  | {
      derivable: true;
      fillSec: number;
      packSec: number;
      coolSec: number;
      moldMotionSec: number;
      totalCycleSec: number;
      trace: CalculationTraceStep[];
      /** Per input read from a reference lookup table, the table and the row it came from (the cost dialog outlines it). */
      lookups: Record<string, { table: string; row: Record<string, string | number> }>;
      /** The stored calculator that computed it (calculators.id and version), and a fingerprint of the formulas it ran, so a saved calculation can say which. */
      calculator: { id: string | null; version: number | null; name: string; fingerprint: string };
    }
  | { derivable: false; missing: string[]; /** Set when the stored calculator itself is absent or too old: the migrations to apply, not data to add. */ calculatorProblem?: string };

export interface CycleTimeInput {
  /** CAD nominal wall thickness; null/0 = not measured. */
  wallMm: number | null;
  isLsr: boolean;
  real: RealResinInputs | null | undefined;
  model: CycleModel;
  press: PressTiming | null;
  /** Melt volume of one full shot (all cavities + runner), mm³. */
  shotMeltVolumeMm3: number | null;
  cavityCount: number;
  gatesPerCavity: number;
}
