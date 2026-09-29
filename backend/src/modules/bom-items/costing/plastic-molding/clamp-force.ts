// Required injection-molding clamp force: the reference model, the ONE
// implementation every clamp check calls (machine selection, route
// comparison, cavity count, the active quote). Pure; all parameters come
// from the staged Plastic reference (plastic-reference.ts ClampModel) and the
// material's reference properties (raw_materials im_* columns, migration 831).
//
//   flow class       material flow length ratio >= flowRatioThresholdEasyFlow  -> Easy
//                                               >= flowRatioThresholdMediumFlow -> Medium
//                                               otherwise                      -> Hard
//   adjusted P_inj   max(minInjectionPressure,
//                        injectionPressureMax x (1 - runner reduction factor))
//                    runner reduction: conventional (cold) or hot runner factor
//   cavity pressure  adjusted P_inj x minimumPercentClampForce[flow class] / 100
//   clamp force      projected area x cavities x cavity pressure x clampForceSafetyFactor
//
// A material without reference injection pressure or flow ratio has no
// derivable clamp force: the result says so, and no press is sized on a
// substitute number.

import type { ClampModel } from './plastic-reference';

export type FlowClass = 'easy' | 'medium' | 'hard';
export type RunnerSystem = 'hot' | 'cold';

/** The material's reference clamp properties (raw_materials, migration 831). */
export interface MaterialClampProperties {
  injectionPressureMaxMpa: number | null;
  flowLengthRatio: number | null;
  /** Reference material the values came from, for the trace. */
  referenceMaterial: string | null;
}

export type ClampForceResult =
  | {
      derivable: true;
      requiredTonnes: number;
      flowClass: FlowClass;
      adjustedInjectionPressureMpa: number;
      cavityPressureMpa: number;
      trace: string;
    }
  | { derivable: false; reason: string };

/** One tonne-force in newtons (the platform's clamp tonnage unit). */
const NEWTONS_PER_TONNE_FORCE = 9806.65;

export function flowClassOf(model: ClampModel, flowLengthRatio: number): FlowClass {
  if (flowLengthRatio >= model.easyFlowRatio) return 'easy';
  if (flowLengthRatio >= model.mediumFlowRatio) return 'medium';
  return 'hard';
}

export function requiredClampForce(input: {
  model: ClampModel;
  material: MaterialClampProperties;
  materialLabel: string;
  projectedAreaMm2: number;
  cavityCount: number;
  runner: RunnerSystem;
}): ClampForceResult {
  const { model, material } = input;
  if (material.injectionPressureMaxMpa == null || material.flowLengthRatio == null) {
    return {
      derivable: false,
      reason: `Clamp force not derivable: ${input.materialLabel} has no reference injection pressure / flow length ratio ` +
        `(raw_materials im_* columns, migration 831).`,
    };
  }
  if (!(input.projectedAreaMm2 > 0)) {
    return { derivable: false, reason: 'Clamp force not derivable: no projected area for this part.' };
  }
  const flowClass = flowClassOf(model, material.flowLengthRatio);
  const reduction = model.runnerPressureReduction[input.runner];
  const adjusted = Math.max(model.minInjectionPressureMpa, material.injectionPressureMaxMpa * (1 - reduction));
  const pct = model.percentClampForce[flowClass];
  const cavityPressureMpa = adjusted * pct / 100;
  const requiredTonnes =
    (input.projectedAreaMm2 * input.cavityCount * cavityPressureMpa * model.clampForceSafetyFactor) / NEWTONS_PER_TONNE_FORCE;
  return {
    derivable: true,
    requiredTonnes,
    flowClass,
    adjustedInjectionPressureMpa: adjusted,
    cavityPressureMpa,
    trace:
      `${input.projectedAreaMm2.toFixed(0)} mm² × ${input.cavityCount} cav × ${cavityPressureMpa.toFixed(2)} MPa ` +
      `(${pct}% of ${adjusted.toFixed(1)} MPa: ${material.injectionPressureMaxMpa} MPa − ${(reduction * 100).toFixed(0)}% ${input.runner} runner; ` +
      `${flowClass} flow, ratio ${material.flowLengthRatio}) × ${model.clampForceSafetyFactor} = ${requiredTonnes.toFixed(1)} t` +
      (material.referenceMaterial ? ` [${material.referenceMaterial}]` : ''),
  };
}
