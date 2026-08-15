import { IsUUID, IsOptional, IsDateString, IsEnum, IsInt, IsString, IsNumber, Min } from 'class-validator';

export enum EntryType {
  DAILY = 'daily',
  WEEKLY = 'weekly',
  SHIFT = 'shift'
}

export class CreateDailyProductionEntryDto {
  @IsUUID()
  productionLotId: string;

  @IsOptional()
  @IsUUID()
  productionProcessId?: string;

  @IsDateString()
  entryDate: string;

  @IsEnum(EntryType)
  entryType: EntryType = EntryType.DAILY;

  @IsOptional()
  @IsInt()
  @Min(0)
  plannedQuantity?: number = 0;

  @IsInt()
  @Min(0)
  actualQuantity: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  rejectedQuantity?: number = 0;

  @IsOptional()
  @IsInt()
  @Min(0)
  reworkQuantity?: number = 0;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  downtimeHours?: number = 0;

  @IsOptional()
  @IsString()
  downtimeReason?: string;

  @IsOptional()
  @IsString()
  shift?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  operatorsCount?: number = 1;

  @IsOptional()
  @IsString()
  supervisor?: string;

  @IsOptional()
  @IsString()
  remarks?: string;

  @IsOptional()
  @IsString()
  issuesEncountered?: string;
}

export class UpdateDailyProductionEntryDto {
  @IsOptional()
  @IsDateString()
  entryDate?: string;

  @IsOptional()
  @IsEnum(EntryType)
  entryType?: EntryType;

  @IsOptional()
  @IsInt()
  @Min(0)
  plannedQuantity?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  actualQuantity?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  rejectedQuantity?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  reworkQuantity?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  downtimeHours?: number;

  @IsOptional()
  @IsString()
  downtimeReason?: string;

  @IsOptional()
  @IsString()
  shift?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  operatorsCount?: number;

  @IsOptional()
  @IsString()
  supervisor?: string;

  @IsOptional()
  @IsString()
  remarks?: string;

  @IsOptional()
  @IsString()
  issuesEncountered?: string;
}

export class DailyProductionEntryResponseDto {
  id: string;
  productionLotId: string;
  productionProcessId?: string;
  entryDate: string;
  entryType: EntryType;
  plannedQuantity: number;
  actualQuantity: number;
  rejectedQuantity: number;
  reworkQuantity: number;
  efficiencyPercentage: number;
  downtimeHours: number;
  downtimeReason?: string;
  shift?: string;
  operatorsCount: number;
  supervisor?: string;
  remarks?: string;
  issuesEncountered?: string;
  enteredBy: string;
  createdAt: string;
  updatedAt: string;

  // Related data
  productionLot?: {
    id: string;
    lotNumber: string;
    productionQuantity: number;
  };

  productionProcess?: {
    id: string;
    processName: string;
    status: string;
  };
}

export class ProductionSummaryDto {
  totalPlannedQuantity: number;
  totalActualQuantity: number;
  totalRejectedQuantity: number;
  totalReworkQuantity: number;
  overallEfficiency: number;
  totalDowntime: number;
  activeProcesses: number;
  completedProcesses: number;
  
  // Trend data
  dailyProduction: {
    date: string;
    plannedQuantity: number;
    actualQuantity: number;
    efficiency: number;
  }[];
  
  // Quality metrics
  qualityMetrics: {
    acceptanceRate: number;
    rejectionRate: number;
    reworkRate: number;
    firstPassYield: number;
  };
}