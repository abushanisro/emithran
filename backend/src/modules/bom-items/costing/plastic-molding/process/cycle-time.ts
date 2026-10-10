// Injection molding cycle time, from real inputs only: the material's
// reference thermal properties, the selected press's own timing, and the
// staged Plastic reference (plastic-reference.ts CycleModel).
//
//   Cooling       Menges: t = (s² / π²α) × ln((4/π)(Tm − Tw)/(Te − Tw))
//                 α = k / (ρ_melt × cp); Tm, Tw (+ defaultMoldTemperatureIncrease),
//                 Te, k, cp, ρ_melt are the material's reference values
//                 (raw_materials; melt density via migration 831)
//   Fill          shot melt volume / the press's injectionRateMm3PerS, times the
//                 injectionTimeAdjustmentFactors for cavities per mold and gates
//                 per cavity
//   Mold motion   the press's Euromap 6 dry cycle (time.dryCycleTimeS: mold open
//                 and close)
//   Pack / hold   0.35 × cooling, floor 2 s: the Menges gate-freeze rule (§6.3).
//                 The reference data holds no hold-time value; this is the one
//                 literature rule in the model, named in the trace.
//   Total         (fill + pack + cool + mold motion) × cycleTimeAdjustmentFactor
//
// Ejector-plate travel is not modelled: its reference variables need the
// press's maximum ejector velocity, which no press record carries. Any input
// missing makes the cycle not derivable, with each missing input named;
// nothing is filled from a resin-family table or a default wall.
//
// LSR (thermoset) cures instead of cooling: Arrhenius cure time, literature
// constants (Ossipov et al., Polymer Engineering 2002), no pack phase.

import type { CycleModel } from '../plastic-reference';
import type { CalculationTraceStep } from '../../../dto/cost-breakdown.dto';

const step = (fieldName: string, value: number, source: string): CalculationTraceStep =>
  ({ fieldName, displayLabel: `${fieldName} (s)`, kind: 'calculated', value, unit: 's', source });

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

interface ResinThermalProps {
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

/** Menges cooling time (s), or null when the temperatures admit no solution (Te <= Tw or Te >= Tm). */
export function computeCoolingTimeSec(wallMm: number, props: ResinThermalProps): number | null {
  const { alpha, Tm, Tw, Te } = props;
  if (!(wallMm > 0) || !(alpha > 0) || Te - Tw <= 0) return null;
  const lnArg = (4 / Math.PI) * (Tm - Tw) / (Te - Tw);
  if (lnArg <= 1) return null;
  const tCool = (wallMm * wallMm / (Math.PI * Math.PI * alpha)) * Math.log(lnArg);
  return Math.round(tCool * 10) / 10;
}

/** The factor of the first bracket whose upper bound covers the value (the last covers the rest). */
function bracketFactor(rows: ReadonlyArray<{ upTo: number; factor: number }>, value: number): number {
  return (rows.find((r) => value <= r.upTo) ?? rows[rows.length - 1]!).factor;
}

/** Fill time (s): shot melt volume at the press injection rate, reference-adjusted. */
export function computeFillTimeSec(input: {
  shotMeltVolumeMm3: number;
  injectionRateMm3PerS: number;
  cavityCount: number;
  gatesPerCavity: number;
  model: CycleModel;
}): number {
  const base = input.shotMeltVolumeMm3 / input.injectionRateMm3PerS;
  const t = base
    * bracketFactor(input.model.fillFactorByCavities, Math.max(input.cavityCount, 1))
    * bracketFactor(input.model.fillFactorByGates, Math.max(input.gatesPerCavity, 1));
  return Math.round(t * 100) / 100;
}

// Menges §6.3 gate-freeze rule (see header): the only literature constants.
const PACK_TO_COOL_RATIO = 0.35;
const PACK_MIN_SEC = 2.0;

function computePackTimeSec(coolingTimeSec: number): number {
  return Math.max(PACK_MIN_SEC, Math.round(coolingTimeSec * PACK_TO_COOL_RATIO * 10) / 10);
}

// LSR cure (Arrhenius), literature constants: see header.
const LSR_DEFAULT_MOLD_TEMP_C = 180;
const LSR_A_FACTOR = 0.008;
const LSR_EA_OVER_R = 3500;
const R_KELVIN_OFFSET = 273.15;

function computeLsrCureTime(wallMm: number, moldTempC: number = LSR_DEFAULT_MOLD_TEMP_C): number {
  const T = moldTempC + R_KELVIN_OFFSET;
  return Math.round(LSR_A_FACTOR * Math.exp(LSR_EA_OVER_R / T) * wallMm * 10) / 10;
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
    }
  | { derivable: false; missing: string[] };

export function computeCycleTime(input: {
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
}): CycleTimeResult {
  const missing: string[] = [];
  const wall = input.wallMm != null && input.wallMm > 0 ? input.wallMm : null;
  if (wall == null) missing.push('nominal wall thickness (CAD)');

  let coolSec: number | null = null;
  const trace: CalculationTraceStep[] = [];
  if (input.isLsr) {
    if (wall != null) {
      coolSec = computeLsrCureTime(wall);
      trace.push(step('Cure Time', coolSec, `LSR Arrhenius at ${LSR_DEFAULT_MOLD_TEMP_C} C, wall ${wall} mm (literature constants)`));
    }
  } else {
    const thermal = resinThermalProps(input.real, input.model.moldTemperatureIncreaseC);
    if ('missing' in thermal) missing.push(...thermal.missing.map((m) => `material ${m}`));
    else if (wall != null) {
      coolSec = computeCoolingTimeSec(wall, thermal.props);
      if (coolSec == null) missing.push('material temperatures give no Menges solution (eject must lie between mold and melt)');
      else trace.push(step('Cooling Time', coolSec, `Menges: wall ${wall} mm, α ${thermal.props.alpha.toFixed(4)} mm²/s (k / ρ_melt·cp), Tm ${thermal.props.Tm} / Tw ${thermal.props.Tw} / Te ${thermal.props.Te} C (material reference)`));
    }
  }

  const rate = input.press?.injectionRateMm3PerS ?? null;
  const dry = input.press?.dryCycleTimeS ?? null;
  if (rate == null || !(rate > 0)) missing.push('press injection rate (injectionRateMm3PerS)');
  if (dry == null || !(dry > 0)) missing.push('press dry cycle time (dryCycleTimeS)');
  if (input.shotMeltVolumeMm3 == null || !(input.shotMeltVolumeMm3 > 0)) missing.push('shot melt volume (part volume and melt density)');

  if (missing.length > 0 || coolSec == null) return { derivable: false, missing };

  const fillSec = computeFillTimeSec({
    shotMeltVolumeMm3: input.shotMeltVolumeMm3!, injectionRateMm3PerS: rate!,
    cavityCount: input.cavityCount, gatesPerCavity: input.gatesPerCavity, model: input.model,
  });
  trace.push(step('Fill Time', fillSec, `${Math.round(input.shotMeltVolumeMm3!)} mm³ shot melt / ${rate} mm³/s press injection rate × injectionTimeAdjustmentFactors (${input.cavityCount} cav, ${input.gatesPerCavity} gate/cav)`));
  const packSec = input.isLsr ? 0 : computePackTimeSec(coolSec);
  if (!input.isLsr) trace.push(step('Pack Time', packSec, '0.35 × cooling, floor 2 s: Menges gate-freeze rule (the reference data holds no hold time)'));
  trace.push(step('Mold Open/Close Time', dry!, 'Press dry cycle, Euromap 6 (machine reference record)'));
  const factor = input.model.cycleTimeAdjustmentFactor;
  const totalCycleSec = Math.round((fillSec + packSec + coolSec + dry!) * factor * 100) / 100;
  trace.push(step('Cycle Time', totalCycleSec, `(fill + pack + cooling + mold open/close) × cycleTimeAdjustmentFactor ${factor}; ejector travel not modelled (no press ejector velocity on file)`));
  return { derivable: true, fillSec, packSec, coolSec, moldMotionSec: dry!, totalCycleSec, trace };
}
