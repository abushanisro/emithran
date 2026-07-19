/**
 * PipelineStageHandler — the contract every pipeline stage must implement.
 *
 * Each stage is a pure transformation: TIn → TOut. No stage knows about any
 * other stage — it only knows its input type and its output type.
 *
 * NestJS injection: concrete stage handlers are @Injectable() services
 * that implement this interface. The pipeline runner receives them as
 * constructor arguments.
 */

import type { ManufacturingIR } from '../ir/manufacturing-ir';
import type {
  PlanningResult,
  CapabilityResult,
  RuleResult,
  CalculationResult,
  ValidationResult,
  CostResult,
  PipelineStage,
} from './stages';

export interface PipelineStageHandler<TIn, TOut> {
  readonly stage: PipelineStage;
  execute(input: TIn): Promise<TOut>;
}

// Strongly-typed aliases for each stage — prevents accidentally wiring stages
// in the wrong order at the injection site.

export type PlannerStageHandler = PipelineStageHandler<ManufacturingIR, PlanningResult>;
export type CapabilityStageHandler = PipelineStageHandler<PlanningResult, CapabilityResult>;
export type RuleEngineStageHandler = PipelineStageHandler<CapabilityResult, RuleResult>;
export type CalculatorStageHandler = PipelineStageHandler<RuleResult, CalculationResult>;
export type ValidatorStageHandler = PipelineStageHandler<CalculationResult, ValidationResult>;
export type AggregatorStageHandler = PipelineStageHandler<ValidationResult, CostResult>;

// NestJS injection tokens — used with @Inject() so concrete implementations
// can be swapped without changing the pipeline runner.
export const PLANNER_STAGE = Symbol('PLANNER_STAGE');
export const CAPABILITY_STAGE = Symbol('CAPABILITY_STAGE');
export const RULE_ENGINE_STAGE = Symbol('RULE_ENGINE_STAGE');
export const CALCULATOR_STAGE = Symbol('CALCULATOR_STAGE');
export const VALIDATOR_STAGE = Symbol('VALIDATOR_STAGE');
export const AGGREGATOR_STAGE = Symbol('AGGREGATOR_STAGE');
