/**
 * ManufacturingPipeline — the compiler runner.
 *
 * Wires the 6 stages together and executes them in order. Each stage receives
 * the previous stage's result as its input. No stage is aware of any other.
 *
 * Usage:
 *   const cost = await pipeline.run(ir);
 *   const planning = await pipeline.runUntil(ir, 'planning');
 *
 * The pipeline is not directly injectable — it is constructed by
 * ManufacturingModule and provided under the MANUFACTURING_PIPELINE token.
 */

import { Injectable, Inject, Logger } from '@nestjs/common';
import type { ManufacturingIR } from '../ir/manufacturing-ir';
import type { PlanningResult, CapabilityResult, RuleResult, CalculationResult, ValidationResult, CostResult, PipelineStage } from './stages';
import {
  PLANNER_STAGE, CAPABILITY_STAGE, RULE_ENGINE_STAGE,
  CALCULATOR_STAGE, VALIDATOR_STAGE, AGGREGATOR_STAGE,
  type PlannerStageHandler,
  type CapabilityStageHandler,
  type RuleEngineStageHandler,
  type CalculatorStageHandler,
  type ValidatorStageHandler,
  type AggregatorStageHandler,
} from './pipeline-stage.interface';

export const MANUFACTURING_PIPELINE = Symbol('MANUFACTURING_PIPELINE');

/** Union of all possible stage stop-points for runUntil(). */
type StageResult =
  | PlanningResult
  | CapabilityResult
  | RuleResult
  | CalculationResult
  | ValidationResult
  | CostResult;

@Injectable()
export class ManufacturingPipeline {
  private readonly logger = new Logger(ManufacturingPipeline.name);

  constructor(
    @Inject(PLANNER_STAGE) private readonly planner: PlannerStageHandler,
    @Inject(CAPABILITY_STAGE) private readonly capability: CapabilityStageHandler,
    @Inject(RULE_ENGINE_STAGE) private readonly ruleEngine: RuleEngineStageHandler,
    @Inject(CALCULATOR_STAGE) private readonly calculator: CalculatorStageHandler,
    @Inject(VALIDATOR_STAGE) private readonly validator: ValidatorStageHandler,
    @Inject(AGGREGATOR_STAGE) private readonly aggregator: AggregatorStageHandler,
  ) {}

  /**
   * Run all 6 stages and return the final CostResult.
   * Short-circuits if validation fails (returns ValidationResult with
   * isManufacturable=false rather than propagating to cost aggregation).
   */
  async run(ir: ManufacturingIR): Promise<CostResult> {
    this.logger.debug(`[pipeline] run partId=${ir.part.partId} irVersion=${ir.irVersion}`);

    const planning    = await this.runStage('planning',        () => this.planner.execute(ir));
    const capability  = await this.runStage('capability',      () => this.capability.execute(planning));
    const rules       = await this.runStage('rule_evaluation', () => this.ruleEngine.execute(capability));
    const calculation = await this.runStage('calculation',     () => this.calculator.execute(rules));
    const validation  = await this.runStage('validation',      () => this.validator.execute(calculation));

    if (!validation.isManufacturable) {
      this.logger.warn(`[pipeline] partId=${ir.part.partId} not manufacturable — skipping cost aggregation`);
    }

    return this.runStage('cost_aggregation', () => this.aggregator.execute(validation));
  }

  /**
   * Run only up to the specified stage — useful for DFM-only or
   * planning-only consumers that don't need a full cost result.
   */
  async runUntil(ir: ManufacturingIR, stopAfter: PipelineStage): Promise<StageResult> {
    const planning = await this.runStage('planning', () => this.planner.execute(ir));
    if (stopAfter === 'planning') return planning;

    const capability = await this.runStage('capability', () => this.capability.execute(planning));
    if (stopAfter === 'capability') return capability;

    const rules = await this.runStage('rule_evaluation', () => this.ruleEngine.execute(capability));
    if (stopAfter === 'rule_evaluation') return rules;

    const calculation = await this.runStage('calculation', () => this.calculator.execute(rules));
    if (stopAfter === 'calculation') return calculation;

    const validation = await this.runStage('validation', () => this.validator.execute(calculation));
    if (stopAfter === 'validation') return validation;

    return this.runStage('cost_aggregation', () => this.aggregator.execute(validation));
  }

  private async runStage<T>(name: PipelineStage, fn: () => Promise<T>): Promise<T> {
    const t0 = Date.now();
    try {
      const result = await fn();
      this.logger.debug(`[pipeline:${name}] completed in ${Date.now() - t0}ms`);
      return result;
    } catch (err) {
      this.logger.error(`[pipeline:${name}] failed after ${Date.now() - t0}ms: ${(err as Error).message}`);
      throw err;
    }
  }
}
