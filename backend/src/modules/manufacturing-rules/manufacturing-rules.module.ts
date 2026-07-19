import { Module } from "@nestjs/common";
import { ManufacturingRulesController } from "./manufacturing-rules.controller";
import { ManufacturingRulesService } from "./manufacturing-rules.service";
import { MaterialGroupResolver } from "./resolvers/material-group.resolver";
import { ParameterResolver } from "./resolvers/parameter.resolver";
import { CalculatorRegistry } from "./calculators/calculator.registry";
import { DrillingCalculator } from "./calculators/drilling.calculator";
import { TurningCalculator } from "./calculators/turning.calculator";
import { MillingCalculator } from "./calculators/milling.calculator";
import { TappingCalculator } from "./calculators/tapping.calculator";
import { LaserCuttingCalculator } from "./calculators/laser-cutting.calculator";
import { PressBrakeCalculator } from "./calculators/press-brake.calculator";
import { InjectionMoldingCalculator } from "./calculators/injection-molding.calculator";
import { SupabaseModule } from "../../common/supabase/supabase.module";
import { LoggerModule } from "../../common/logger/logger.module";

@Module({
  imports: [SupabaseModule, LoggerModule],
  controllers: [ManufacturingRulesController],
  providers: [
    ManufacturingRulesService,
    MaterialGroupResolver,
    ParameterResolver,
    CalculatorRegistry,
    DrillingCalculator,
    TurningCalculator,
    MillingCalculator,
    TappingCalculator,
    LaserCuttingCalculator,
    PressBrakeCalculator,
    InjectionMoldingCalculator,
  ],
  exports: [ManufacturingRulesService],
})
export class ManufacturingRulesModule {}
