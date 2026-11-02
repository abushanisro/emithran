import { Controller, Post, Body, Get, Logger } from "@nestjs/common";
import { ManufacturingRulesService } from "./manufacturing-rules.service";
import { EvaluateOperationDto } from "./dto/evaluate-operation.dto";
import { CalculatorRegistry } from "./calculators/calculator.registry";
import { OrgRole } from '../../common/authz/authz-policy';

@OrgRole('member')
@Controller({ path: 'api/manufacturing-rules', version: '1' })
export class ManufacturingRulesController {
  private readonly logger = new Logger(ManufacturingRulesController.name);

  constructor(
    private readonly rulesService: ManufacturingRulesService,
    private readonly calculatorRegistry: CalculatorRegistry,
  ) {}

  @Post("evaluate")
  async evaluate(@Body() dto: EvaluateOperationDto) {
    this.logger.log(`[rules] Evaluate: op=${dto.operation} material=${dto.materialGrade}`);
    return this.rulesService.evaluate({
      operation: dto.operation,
      materialGrade: dto.materialGrade,
      featureGeometry: dto.featureGeometry,
      qualityLevel: dto.qualityLevel,
      toolMaterial: dto.toolMaterial,
      bomItemId: dto.bomItemId,
      generationId: dto.generationId,
    });
  }

  @OrgRole('viewer')
  @Get("operations")
  listOperations() {
    return { operations: this.calculatorRegistry.list() };
  }
}
