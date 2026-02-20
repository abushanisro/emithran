


import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsString, IsOptional, IsNumber, IsEnum, IsUUID, Max, Min } from 'class-validator';
import {
  IsProjectName,
  IsOptionalString,
  IsOptionalEnum,
  IsOptionalPrice,
} from '../../../common/decorators/validation.decorators';

export enum ProjectStatus {
  DRAFT = 'draft',
  ACTIVE = 'active',
  COMPLETED = 'completed',
  ON_HOLD = 'on_hold',
  CANCELLED = 'cancelled',
}

export class CreateProjectDto {
  @ApiProperty({ 
    example: 'Project Alpha',
    description: 'Project name (2-100 characters, letters, numbers, spaces, hyphens, dashes, underscores, periods, and common punctuation allowed)'
  })
  @IsProjectName()
  name: string;

  @ApiPropertyOptional({ example: 'Manufacturing cost analysis project' })
  @IsOptionalString('Description must be text')
  description?: string;

  @ApiPropertyOptional({ example: 'United States' })
  @IsOptionalString('Country must be text')
  country?: string;

  @ApiPropertyOptional({ example: 'California' })
  @IsOptionalString('State must be text')
  state?: string;

  @ApiPropertyOptional({ example: 'San Francisco' })
  @IsOptionalString('City must be text')
  city?: string;

  @ApiPropertyOptional({ example: ProjectStatus.DRAFT, enum: ProjectStatus })
  @IsOptionalEnum(ProjectStatus, 'Status must be one of: draft, active, completed, on_hold, cancelled')
  status?: ProjectStatus;

  @ApiPropertyOptional({ example: 'Medical' })
  @IsOptionalString('Industry must be text')
  industry?: string;

  @ApiPropertyOptional({ 
    example: 10000,
    description: 'Expected annual production volume',
    minimum: 1,
    maximum: 999999999
  })
  @IsOptional()
  @IsNumber({}, { message: 'Estimated annual volume must be a number' })
  @Min(1, { message: 'Estimated annual volume must be at least 1' })
  @Max(999999999, { message: 'Estimated annual volume cannot exceed 999,999,999' })
  estimatedAnnualVolume?: number;

  @ApiPropertyOptional({
    example: 150.75,
    description: 'Target BOM cost',
    minimum: 0,
    maximum: 999999.99
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Target BOM cost must be a valid amount with up to 2 decimal places' })
  @Min(0, { message: 'Target BOM cost must be non-negative' })
  @Max(999999.99, { message: 'Target BOM cost cannot exceed 999,999.99' })
  targetBomCost?: number;

  @ApiPropertyOptional({ 
    example: 'USD',
    description: 'Currency for target BOM cost (USD, INR, EUR, GBP)'
  })
  @IsOptional()
  @IsString({ message: 'Target BOM cost currency must be a string' })
  targetBomCostCurrency?: string;
}

export class UpdateProjectDto extends PartialType(CreateProjectDto) {}

export class QueryProjectsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: ProjectStatus })
  @IsOptional()
  @IsEnum(ProjectStatus)
  status?: ProjectStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  page?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  limit?: number;
}
