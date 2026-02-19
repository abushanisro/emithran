import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsString, IsOptional, IsUUID, IsNumber, Min, Max, IsIn } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateBOMDto {
  @ApiProperty({ example: 'Main Assembly BOM' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ example: 'Primary bill of materials' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: 'project-uuid' })
  @IsUUID()
  projectId: string;

  @ApiPropertyOptional({ example: '1.0' })
  @IsOptional()
  @IsString()
  version?: string;

  @ApiPropertyOptional({ enum: ['draft', 'approved', 'released', 'obsolete'] })
  @IsOptional()
  @IsString()
  @IsIn(['draft', 'approved', 'released', 'obsolete'])
  status?: string;
}

export class UpdateBOMDto extends PartialType(CreateBOMDto) {}

export class QueryBOMsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ example: 1, description: 'Page number (starting from 1)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ example: 10, description: 'Items per page (max 100)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number;
}
