import { IsString, IsOptional, IsArray, IsEnum, IsDateString, IsUUID, IsObject, ValidateNested, IsNumber, IsBoolean } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum InspectionType {
  FIRST_ARTICLE = 'first-article',
  IN_PROCESS = 'in-process',
  FINAL = 'final',
  RECEIVING = 'receiving',
  AUDIT = 'audit',
  PRE_SHIPMENT = 'pre-shipment',
}

export enum InspectionStatus {
  PLANNED = 'planned',
  IN_PROGRESS = 'in-progress',
  COMPLETED = 'completed',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  ON_HOLD = 'on-hold',
}

export enum InspectionResult {
  PASS = 'pass',
  FAIL = 'fail',
  CONDITIONAL = 'conditional',
  NOT_TESTED = 'not-tested',
}

export enum CriticalLevel {
  CRITICAL = 'critical',
  MAJOR = 'major',
  MINOR = 'minor',
}

export enum MeasurementType {
  PASS_FAIL = 'pass_fail',
  MEASUREMENT = 'measurement',
  VISUAL = 'visual',
  DOCUMENT = 'document',
}

export class InspectionChecklistItemDto {
  @ApiProperty()
  @IsString()
  id: string;

  @ApiProperty()
  @IsString()
  category: string;

  @ApiProperty()
  @IsString()
  requirement: string;

  @ApiProperty()
  @IsString()
  specification: string;

  @ApiProperty({ enum: MeasurementType })
  @IsEnum(MeasurementType)
  measurementType: MeasurementType;

  @ApiProperty({ enum: CriticalLevel })
  @IsEnum(CriticalLevel)
  criticalLevel: CriticalLevel;

  @ApiProperty()
  @IsString()
  inspectionMethod: string;

  @ApiProperty()
  @IsString()
  acceptanceCriteria: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tools?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  standardReference?: string;
}

export class CreateQualityInspectionDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ enum: InspectionType })
  @IsEnum(InspectionType)
  type: InspectionType;

  @ApiProperty()
  @IsUUID()
  projectId: string;

  @ApiProperty()
  @IsUUID()
  bomId: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  inspector?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  plannedDate?: string;

  @ApiProperty()
  @IsArray()
  @IsString({ each: true })
  selectedItems: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  qualityStandards?: string[];

  @ApiProperty({ type: [InspectionChecklistItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InspectionChecklistItemDto)
  checklist: InspectionChecklistItemDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}

export class UpdateQualityInspectionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ enum: InspectionStatus })
  @IsOptional()
  @IsEnum(InspectionStatus)
  status?: InspectionStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  inspector?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  plannedDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  actualStartDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  actualEndDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  qualityStandards?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}

export class InspectionChecklistResultDto {
  @ApiProperty()
  @IsString()
  checklistItemId: string;

  @ApiProperty({ enum: InspectionResult })
  @IsEnum(InspectionResult)
  result: InspectionResult;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  actualValue?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  attachments?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  inspectedBy?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  inspectedAt?: string;
}

export class InspectionResultDto {
  @ApiProperty({ type: [InspectionChecklistResultDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InspectionChecklistResultDto)
  checklistResults: InspectionChecklistResultDto[];

  @ApiProperty({ enum: InspectionResult })
  @IsEnum(InspectionResult)
  overallResult: InspectionResult;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  recommendations?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  attachments?: string[];
}

export class QualityInspectionResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional()
  description?: string;

  @ApiProperty({ enum: InspectionType })
  type: InspectionType;

  @ApiProperty({ enum: InspectionStatus })
  status: InspectionStatus;

  @ApiProperty()
  projectId: string;

  @ApiProperty()
  bomId: string;

  @ApiPropertyOptional()
  inspector?: string;

  @ApiPropertyOptional()
  plannedDate?: string;

  @ApiPropertyOptional()
  actualStartDate?: string;

  @ApiPropertyOptional()
  actualEndDate?: string;

  @ApiProperty()
  selectedItems: string[];

  @ApiPropertyOptional()
  qualityStandards?: string[];

  @ApiProperty({ type: [InspectionChecklistItemDto] })
  checklist: InspectionChecklistItemDto[];

  @ApiPropertyOptional()
  results?: any;

  @ApiPropertyOptional({ enum: InspectionResult })
  overallResult?: InspectionResult;

  @ApiPropertyOptional()
  notes?: string;

  @ApiPropertyOptional()
  approvedBy?: string;

  @ApiPropertyOptional()
  approvedAt?: string;

  @ApiPropertyOptional()
  rejectedBy?: string;

  @ApiPropertyOptional()
  rejectedAt?: string;

  @ApiPropertyOptional()
  rejectionReason?: string;

  @ApiProperty()
  createdBy: string;

  @ApiProperty()
  createdAt: string;

  @ApiProperty()
  updatedAt: string;

  @ApiPropertyOptional()
  metadata?: Record<string, any>;

  // Related data
  @ApiPropertyOptional()
  project?: any;

  @ApiPropertyOptional()
  bom?: any;

  @ApiPropertyOptional()
  bomItems?: any[];

  @ApiPropertyOptional()
  nonConformances?: any[];
}