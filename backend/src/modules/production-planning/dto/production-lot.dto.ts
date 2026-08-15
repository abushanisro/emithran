import { IsUUID, IsString, IsInt, IsOptional, IsDateString, IsEnum, Min } from 'class-validator';
import { 
  SanitizedDate, 
  SanitizedLotNumber,
  SanitizedQuantity 
} from '@/common/decorators/validate-input.decorator';

export enum LotStatus {
  PLANNED = 'planned',
  MATERIALS_ORDERED = 'materials_ordered',
  IN_PRODUCTION = 'in_production',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
  ON_HOLD = 'on_hold'
}

export enum LotPriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  URGENT = 'urgent'
}

export enum LotType {
  STANDARD = 'standard',
  PROTOTYPE = 'prototype',
  REWORK = 'rework',
  URGENT = 'urgent'
}

export class CreateProductionLotDto {
  @IsUUID()
  bomId: string;

  @IsString()
  lotNumber: string;

  @IsInt()
  @Min(1)
  productionQuantity: number;

  @IsDateString()
  plannedStartDate: string;

  @IsDateString()
  plannedEndDate: string;

  @IsOptional()
  @IsEnum(LotPriority)
  priority?: LotPriority = LotPriority.MEDIUM;

  @IsOptional()
  @IsEnum(LotType)
  lotType?: LotType = LotType.STANDARD;

  @IsOptional()
  @IsString()
  remarks?: string;

  @IsOptional()
  @IsUUID('4', { each: true })
  selectedBomItemIds?: string[];
}

export class UpdateProductionLotDto {
  @SanitizedLotNumber()
  @IsOptional()
  lotNumber?: string;

  @SanitizedQuantity({ min: 1, max: 1000000 })
  @IsOptional()
  @IsInt({ message: 'Production quantity must be a whole number' })
  @Min(1, { message: 'Production quantity must be at least 1' })
  productionQuantity?: number;

  @IsOptional()
  @IsEnum(LotStatus, { message: 'Invalid status value' })
  status?: LotStatus;

  @SanitizedDate({ required: false })
  plannedStartDate?: string;

  @SanitizedDate({ required: false })
  plannedEndDate?: string;

  @IsOptional()
  @IsDateString()
  actualStartDate?: string;

  @IsOptional()
  @IsDateString()
  actualEndDate?: string;

  @IsOptional()
  @IsEnum(LotPriority)
  priority?: LotPriority;

  @IsOptional()
  @IsEnum(LotType)
  lotType?: LotType;

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class ProductionLotResponseDto {
  id: string;
  bomId: string;
  lotNumber: string;
  productionQuantity: number;
  status: LotStatus;
  plannedStartDate: string;
  plannedEndDate: string;
  actualStartDate?: string;
  actualEndDate?: string;
  priority: LotPriority;
  lotType: LotType;
  totalMaterialCost: number;
  totalProcessCost: number;
  totalEstimatedCost: number;
  remarks?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  
  // Related data
  bom?: {
    id: string;
    name: string;
    version: string;
    items?: {
      id: string;
      partNumber: string;
      description: string;
      quantity: number;
      itemType: string;
      unitCost?: number;
      materialGrade?: string;
      makeBuy?: string;
    }[];
  };
  
  selectedBomItems?: {
    id: string;
    partNumber: string;
    description: string;
    quantity: number;
    itemType: string;
    unitCost?: number;
    materialGrade?: string;
    makeBuy?: string;
  }[];
  
  vendorAssignments?: LotVendorAssignmentResponseDto[];
  processes?: ProductionProcessResponseDto[];
}

export class LotVendorAssignmentResponseDto {
  id: string;
  productionLotId: string;
  bomItemId: string;
  vendorId: string;
  requiredQuantity: number;
  unitCost: number;
  totalCost: number;
  deliveryStatus: string;
  expectedDeliveryDate?: string;
  actualDeliveryDate?: string;
  qualityStatus: string;
  remarks?: string;
  
  // Related data
  bomItem?: {
    id: string;
    partNumber: string;
    description: string;
  };
  
  vendor?: {
    id: string;
    name: string;
    company_email: string;
  };
}

export class ProductionProcessResponseDto {
  id: string;
  productionLotId: string;
  processId: string;
  processSequence: number;
  processName: string;
  description?: string;
  plannedStartDate: string;
  plannedEndDate: string;
  actualStartDate?: string;
  actualEndDate?: string;
  assignedDepartment?: string;
  responsiblePerson?: string;
  status: string;
  completionPercentage: number;
  qualityCheckRequired: boolean;
  qualityStatus: string;
  remarks?: string;
  
  subtasks?: ProcessSubtaskResponseDto[];
}

export class ProcessSubtaskResponseDto {
  id: string;
  productionProcessId: string;
  taskName: string;
  description?: string;
  taskSequence: number;
  estimatedDurationHours: number;
  actualDurationHours?: number;
  assignedOperator?: string;
  skillRequirement?: string;
  status: string;
  qualityCheckRequired: boolean;
  qualityCheckPassed?: boolean;
  startedAt?: string;
  completedAt?: string;
  remarks?: string;
}