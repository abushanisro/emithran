import { Injectable, Logger } from "@nestjs/common";
import { SupabaseService } from "../../common/supabase/supabase.service";
import { MaterialGroupResolver } from "./resolvers/material-group.resolver";
import { ParameterResolver } from "./resolvers/parameter.resolver";
import { CalculatorRegistry } from "./calculators/calculator.registry";
import type { OperationResult } from "./dto/operation-result.dto";
import type {
  IsoGroup,
  MachiningParams,
  CalculationResult,
  QualityLevel,
  ToolMaterial,
} from "./interfaces/operation-calculator.interface";

export interface EvaluateInput {
  operation: string;
  materialGrade: string;
  featureGeometry: Record<string, unknown>;
  qualityLevel?: QualityLevel;
  toolMaterial?: ToolMaterial;
  bomItemId?: string;
  generationId?: string;
}

@Injectable()
export class ManufacturingRulesService {
  private readonly logger = new Logger(ManufacturingRulesService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly materialGroupResolver: MaterialGroupResolver,
    private readonly parameterResolver: ParameterResolver,
    private readonly calculatorRegistry: CalculatorRegistry,
  ) {}

  async evaluate(input: EvaluateInput): Promise<OperationResult> {
    const {
      operation,
      materialGrade,
      featureGeometry,
      qualityLevel = "semi_finishing",
      toolMaterial = "carbide",
      bomItemId,
      generationId,
    } = input;

    const materialRecord = await this.materialGroupResolver.resolve(materialGrade);
    const isoGroup = materialRecord.isoGroup;

    const params: MachiningParams = await this.parameterResolver.resolve({
      operation,
      isoGroup,
      qualityLevel,
      toolMaterial,
      diameterMm: this.extractDiameter(featureGeometry),
    });

    const calculator = this.calculatorRegistry.resolve(operation);

    if (!calculator) {
      this.logger.warn(`[rules-engine] No calculator for operation "${operation}" — returning geometry_estimate default`);
      return this.defaultResult(operation, isoGroup, params);
    }

    const validation = calculator.validate(params, featureGeometry);

    if (!validation.valid) {
      this.logger.warn(`[rules-engine] Validation failed for ${operation}/${materialGrade}: ${validation.errors.join("; ")}`);
    }

    let calcResult: CalculationResult;
    try {
      // LaserCuttingCalculator and InjectionMoldingCalculator are async (DB lookups for speed/polymer data)
      const maybePromise = calculator.calculate(params, featureGeometry);
      calcResult = maybePromise instanceof Promise ? await maybePromise : maybePromise;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[rules-engine] Calculator error for ${operation}: ${msg}`);
      return this.defaultResult(operation, isoGroup, params);
    }

    const machineReqs = calculator.machineRequirements(params, calcResult);
    const toolReqs = calculator.toolRequirements(params, featureGeometry);

    if (bomItemId) {
      await this.persist({
        bomItemId,
        generationId,
        operation,
        isoGroup,
        totalCycleTimeSec: calcResult.totalCycleTimeSec,
        steps: calcResult.steps,
        machineReqs,
        toolReqs,
        validation,
      });
    }

    const timingSource = validation.valid ? "machining_rules" : "geometry_estimate";

    return {
      operation,
      timingSource,
      isoGroup,
      totalCycleTimeSec: calcResult.totalCycleTimeSec,
      perFeatureCycleTimeSec: calcResult.perFeatureCycleTimeSec,
      featureCount: calcResult.featureCount,
      steps: calcResult.steps,
      parameterSource: params.parameterSource,
      machineRequirements: machineReqs,
      toolRequirements: toolReqs,
      validation,
    };
  }

  /** Batch evaluate multiple operations for one BOM item */
  async evaluateBatch(inputs: EvaluateInput[]): Promise<OperationResult[]> {
    return Promise.all(inputs.map((i) => this.evaluate(i)));
  }

  private defaultResult(
    operation: string,
    isoGroup: IsoGroup,
    params: MachiningParams,
  ): OperationResult {
    return {
      operation,
      timingSource: "default",
      isoGroup,
      totalCycleTimeSec: 60,
      perFeatureCycleTimeSec: 60,
      featureCount: 1,
      steps: [],
      parameterSource: params.parameterSource,
      machineRequirements: {
        minPowerKw: 7.5,
        minRpm: 1000,
        machineCategoryHint: "vmc_3ax",
      },
      toolRequirements: {
        toolType: "unresolved",
        coating: params.insertCoating,
        insertGradeIso: params.insertGradeIso,
      },
      validation: {
        valid: false,
        errors: [`No calculator registered for operation "${operation}"`],
        warnings: [],
      },
    };
  }

  private extractDiameter(geometry: Record<string, unknown>): number | undefined {
    // Try common diameter field names across different geometry types
    const candidates = [
      geometry.diameterMm,
      geometry.majorDiameterMm,
      geometry.cutterDiameterMm,
    ];
    for (const v of candidates) {
      if (typeof v === "number" && v > 0) return v;
    }
    return undefined;
  }

  private async persist(data: {
    bomItemId: string;
    generationId?: string;
    operation: string;
    isoGroup: IsoGroup;
    totalCycleTimeSec: number;
    steps: unknown[];
    machineReqs: unknown;
    toolReqs: unknown;
    validation: unknown;
  }): Promise<void> {
    try {
      const db = this.supabase.getClient();
      await db.from("machining_rule_results").insert({
        bom_item_id: data.bomItemId,
        generation_id: data.generationId ?? null,
        operation: data.operation,
        iso_group: data.isoGroup,
        timing_source: "machining_rules",
        total_cycle_time_sec: data.totalCycleTimeSec,
        calculation_steps: data.steps,
        machine_requirements: data.machineReqs,
        tool_requirements: data.toolReqs,
        validation_result: data.validation,
      });
    } catch (err: unknown) {
      // Non-critical — don't break the pipeline if audit persistence fails
      this.logger.warn(`[rules-engine] Failed to persist result: ${err}`);
    }
  }
}
