import { IsUUID, IsString, IsOptional, IsEnum, IsInt, IsBoolean, IsArray, IsNumber, Min, Max, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

enum ProcessStatus {
  PENDING = 'pending',
  READY = 'ready',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  ON_HOLD = 'on_hold',
  CANCELLED = 'cancelled'
}

export enum QualityStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  PASSED = 'passed',
  FAILED = 'failed',
  REWORK_REQUIRED = 'rework_required'
}

export class CreateProductionProcessDto {
  @IsUUID()
  production_lot_id: string;

  @IsUUID()
  @IsOptional()
  process_id?: string;

  @IsString()
  process_name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  estimated_hours?: number;

  @IsOptional()
  @IsString()
  assigned_department?: string;

  @IsOptional()
  @IsString()
  responsible_person?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  machineAllocation?: string[];

  @IsOptional()
  @IsUUID()
  dependsOnProcessId?: string;

  @IsOptional()
  @IsBoolean()
  qualityCheckRequired?: boolean = true;

  @IsOptional()
  @IsString()
  remarks?: string;

}

export class UpdateProductionProcessDto {
  @IsOptional()
  @IsString()
  processName?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  estimatedHours?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  actualHours?: number;

  @IsOptional()
  @IsString()
  assignedDepartment?: string;

  @IsOptional()
  @IsString()
  responsiblePerson?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  machineAllocation?: string[];

  @IsOptional()
  @IsEnum(ProcessStatus)
  status?: ProcessStatus;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  completionPercentage?: number;

  @IsOptional()
  @IsUUID()
  dependsOnProcessId?: string;

  @IsOptional()
  @IsBoolean()
  qualityCheckRequired?: boolean;

  @IsOptional()
  @IsEnum(QualityStatus)
  qualityStatus?: QualityStatus;

  @IsOptional()
  @IsString()
  remarks?: string;
}

class BomPartRequirementDto {
  @IsUUID()
  bom_item_id: string;

  @IsNumber()
  @Min(0.01)
  required_quantity: number;

  @IsString()
  unit: string;
}

export class CreateProcessSubtaskDto {
  @IsUUID()
  productionProcessId: string;

  @IsString()
  taskName: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsInt()
  @Min(1)
  taskSequence: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  estimatedHours?: number;

  @IsOptional()
  @IsString()
  assignedOperator?: string;

  @IsOptional()
  @IsString()
  skillRequirement?: string;

  @IsOptional()
  @IsBoolean()
  qualityCheckRequired?: boolean = false;

  @IsOptional()
  @IsUUID()
  dependsOnSubtaskId?: string;

  @IsOptional()
  @IsString()
  remarks?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BomPartRequirementDto)
  bomParts?: BomPartRequirementDto[];

  @IsOptional()
  @IsString()
  plannedStartDate?: string;

  @IsOptional()
  @IsString()
  plannedEndDate?: string;
}

export class UpdateProcessSubtaskDto {
  @IsOptional()
  @IsString()
  taskName?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  taskSequence?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  estimatedHours?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  actualHours?: number;

  @IsOptional()
  @IsString()
  assignedOperator?: string;

  @IsOptional()
  @IsString()
  skillRequirement?: string;

  @IsOptional()
  @IsEnum(ProcessStatus)
  status?: ProcessStatus;

  @IsOptional()
  @IsBoolean()
  qualityCheckRequired?: boolean;

  @IsOptional()
  @IsBoolean()
  qualityCheckPassed?: boolean;

  @IsOptional()
  @IsUUID()
  dependsOnSubtaskId?: string;

  @IsOptional()
  @IsString()
  remarks?: string;
}