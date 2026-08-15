import { IsString, IsUUID, IsOptional, IsArray, IsNumber, IsDateString, IsIn, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class BOMPartRequirementDto {
  @ApiProperty()
  @IsUUID()
  bomItemId: string;

  @ApiProperty()
  @IsNumber()
  requiredQuantity: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  unit?: string;
}

export class CreateSubtaskDto {
  @ApiProperty()
  @IsUUID()
  productionProcessId: string;

  @ApiProperty()
  @IsString()
  taskName: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  assignedOperator?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  plannedStartDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  plannedEndDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsIn(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'BLOCKED'])
  status?: string;

  @ApiPropertyOptional({ type: [BOMPartRequirementDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BOMPartRequirementDto)
  bomParts?: BOMPartRequirementDto[];
}

export class UpdateSubtaskDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  taskName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  assignedOperator?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  plannedStartDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  plannedEndDate?: string;

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
  @IsIn(['PENDING', 'IN_PROGRESS', 'COMPLETED', 'BLOCKED'])
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class BOMRequirementResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  bomItemId: string;

  @ApiProperty()
  partNumber: string;

  @ApiProperty()
  partName: string;

  @ApiProperty()
  description: string;

  @ApiProperty()
  requiredQuantity: number;

  @ApiProperty()
  unit: string;

  @ApiProperty()
  status: string;
}

export class SubtaskResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  productionProcessId: string;

  @ApiProperty()
  taskName: string;

  @ApiProperty()
  description: string;

  @ApiProperty()
  taskSequence: number;

  @ApiProperty()
  plannedStartDate: string;

  @ApiProperty()
  plannedEndDate: string;

  @ApiProperty()
  actualStartDate: string;

  @ApiProperty()
  actualEndDate: string;

  @ApiProperty()
  assignedOperator: string;

  @ApiProperty()
  operatorName: string;

  @ApiProperty()
  status: string;

  @ApiProperty()
  notes: string;

  @ApiProperty()
  createdAt: string;

  @ApiProperty()
  updatedAt: string;

  @ApiProperty({ type: [BOMRequirementResponseDto] })
  bomRequirements: BOMRequirementResponseDto[];
}