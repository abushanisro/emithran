import { IsString, IsOptional, IsNumber, IsObject, IsEnum } from "class-validator";
import type { QualityLevel, ToolMaterial } from "../interfaces/operation-calculator.interface";

export class EvaluateOperationDto {
  @IsString()
  operation: string;           // 'drilling' | 'turning' | 'milling' | 'tapping' | 'laser_cutting' | 'press_brake' | 'injection_molding'

  @IsString()
  materialGrade: string;       // 'IS2062 E250', 'SS304', 'Ti-6Al-4V', etc.

  @IsOptional()
  @IsEnum(["roughing", "semi_finishing", "finishing"])
  qualityLevel?: QualityLevel; // defaults to 'semi_finishing'

  @IsOptional()
  @IsEnum(["hss", "hss_cobalt", "carbide", "ceramic", "cbn", "pcd"])
  toolMaterial?: ToolMaterial; // defaults to 'carbide'

  @IsObject()
  featureGeometry: Record<string, unknown>;

  @IsOptional()
  @IsString()
  bomItemId?: string;          // if provided, persists result to machining_rule_results

  @IsOptional()
  @IsString()
  generationId?: string;
}
