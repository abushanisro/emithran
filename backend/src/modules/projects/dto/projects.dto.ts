


import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsString, IsOptional, IsNumber, IsEnum, IsUUID, Max, Min } from 'class-validator';

export enum ProjectStatus {
  DRAFT = 'draft',
  ACTIVE = 'active',
  COMPLETED = 'completed',
  ON_HOLD = 'on_hold',
  CANCELLED = 'cancelled',
}

export class CreateProjectDto {
  @ApiProperty({ example: 'Project Alpha' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ example: 'Manufacturing cost analysis project' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 'United States' })
  @IsOptional()
  @IsString()
  country?: string;

  @ApiPropertyOptional({ example: 'California' })
  @IsOptional()
  @IsString()
  state?: string;

  @ApiPropertyOptional({ example: 'San Francisco' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiPropertyOptional({ example: ProjectStatus.DRAFT, enum: ProjectStatus })
  @IsOptional()
  @IsEnum(ProjectStatus)
  status?: ProjectStatus;

  @ApiPropertyOptional({
    example: 3750000,
    description: 'Target price in rupees (max: ₹9,99,99,999.99)',
    minimum: 0,
    maximum: 99999999.99
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: 'Target price must be a non-negative number' })
  @Max(99999999.99, { message: 'Target price cannot exceed ₹9,99,99,999.99' })
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
