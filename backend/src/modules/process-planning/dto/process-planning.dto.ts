import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsUUID, IsOptional, MaxLength } from 'class-validator';

export class CreateProcessPlanningSpecDto {
  @ApiProperty({ description: 'BOM item ID' })
  @IsUUID()
  bomItemId: string;

  @ApiProperty({ description: 'Project ID' })
  @IsUUID()
  projectId: string;

  @ApiPropertyOptional({ description: 'Tolerance grade specification', example: 'IT8' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  toleranceGrade?: string;

  @ApiPropertyOptional({ description: 'Surface finish requirement', example: 'Ra 3.2 μm' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  surfaceFinish?: string;

  @ApiPropertyOptional({ description: 'Heat treatment specification', example: 'As Required' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  heatTreatment?: string;

  @ApiPropertyOptional({ description: 'Hardness requirement', example: '45-50 HRC' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  hardness?: string;

  @ApiPropertyOptional({ description: 'Manufacturing method', example: 'CNC Machining' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  manufacturingMethod?: string;

  @ApiPropertyOptional({ description: 'Required tooling' })
  @IsOptional()
  @IsString()
  toolingRequired?: string;

  @ApiPropertyOptional({ description: 'Special manufacturing instructions' })
  @IsOptional()
  @IsString()
  specialInstructions?: string;

  @ApiPropertyOptional({ description: 'Coating specification', example: 'Black Anodize Type II' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  coatingSpecification?: string;
}

export class UpdateProcessPlanningSpecDto {
  @ApiPropertyOptional({ description: 'Tolerance grade specification', example: 'IT8' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  toleranceGrade?: string;

  @ApiPropertyOptional({ description: 'Surface finish requirement', example: 'Ra 3.2 μm' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  surfaceFinish?: string;

  @ApiPropertyOptional({ description: 'Heat treatment specification', example: 'As Required' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  heatTreatment?: string;

  @ApiPropertyOptional({ description: 'Hardness requirement', example: '45-50 HRC' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  hardness?: string;

  @ApiPropertyOptional({ description: 'Manufacturing method', example: 'CNC Machining' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  manufacturingMethod?: string;

  @ApiPropertyOptional({ description: 'Required tooling' })
  @IsOptional()
  @IsString()
  toolingRequired?: string;

  @ApiPropertyOptional({ description: 'Special manufacturing instructions' })
  @IsOptional()
  @IsString()
  specialInstructions?: string;

  @ApiPropertyOptional({ description: 'Coating specification', example: 'Black Anodize Type II' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  coatingSpecification?: string;
}

export class ProcessPlanningSpecResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  bomItemId: string;

  @ApiProperty()
  projectId: string;

  @ApiProperty()
  toleranceGrade: string;

  @ApiProperty()
  surfaceFinish: string;

  @ApiProperty()
  heatTreatment: string;

  @ApiPropertyOptional()
  hardness?: string;

  @ApiPropertyOptional()
  manufacturingMethod?: string;

  @ApiPropertyOptional()
  toolingRequired?: string;

  @ApiPropertyOptional()
  specialInstructions?: string;

  @ApiPropertyOptional()
  coatingSpecification?: string;

  @ApiProperty()
  createdAt: string;

  @ApiProperty()
  updatedAt: string;

  @ApiPropertyOptional()
  createdBy?: string;

  @ApiPropertyOptional()
  updatedBy?: string;

  // BOM Item details (from view)
  @ApiPropertyOptional()
  bomItemName?: string;

  @ApiPropertyOptional()
  partNumber?: string;

  @ApiPropertyOptional()
  bomItemDescription?: string;

  @ApiPropertyOptional()
  itemType?: string;

  @ApiPropertyOptional()
  material?: string;

  @ApiPropertyOptional()
  materialGrade?: string;
}