


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
    description: 'Project name (2-100 characters, letters, numbers, spaces, hyphens, underscores, and periods only)'
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

  @ApiPropertyOptional({
    example: 3750000,
    description: 'Target price in rupees (max: ₹9,99,99,999.99)',
    minimum: 0,
    maximum: 99999999.99
  })
  @IsOptionalPrice(2, 0, 99999999.99, 'Target price must be a valid amount between ₹0 and ₹9,99,99,999.99')
  targetPrice?: number;
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
