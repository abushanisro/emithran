import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString, IsOptional, IsNumber, IsArray, IsIn, Min, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

// ─── Nested types ──────────────────────────────────────────────────────────────

export class SelectedProjectDto {
  @ApiProperty()
  @IsString()
  id: string;

  @ApiProperty()
  @IsString()
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  targetPrice?: number;
}

export class SelectedBomDto {
  @ApiProperty()
  @IsString()
  id: string;

  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty()
  @IsString()
  projectId: string;

  @ApiProperty()
  @IsString()
  projectName: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  version?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  status?: string;
}

// ─── Create / Update DTOs ─────────────────────────────────────────────────────

export class CreateBenchmarkSessionDto {
  @ApiProperty({ example: 'Q2 2026 Motor Assembly Benchmark' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ example: 'Comparing three BOM variants for cost reduction' })
  @IsOptional()
  @IsString()
  description?: string;
}

export class UpdateBenchmarkSessionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ enum: ['draft', 'active', 'archived'] })
  @IsOptional()
  @IsString()
  @IsIn(['draft', 'active', 'archived'])
  status?: string;

  @ApiPropertyOptional({ type: [SelectedProjectDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SelectedProjectDto)
  selectedProjects?: SelectedProjectDto[];

  @ApiPropertyOptional({ type: [SelectedBomDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SelectedBomDto)
  selectedBoms?: SelectedBomDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  bomCount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  savedInsights?: any;
}

// ─── Response DTO ─────────────────────────────────────────────────────────────

export class BenchmarkSessionResponseDto {
  id: string;
  name: string;
  description: string | null;
  status: 'draft' | 'active' | 'archived';
  ownerId: string;
  selectedProjects: SelectedProjectDto[];
  selectedBoms: SelectedBomDto[];
  bomCount: number;
  savedInsights: any | null;
  createdAt: string;
  updatedAt: string;

  static fromDatabase(row: any): BenchmarkSessionResponseDto {
    const dto = new BenchmarkSessionResponseDto();
    dto.id              = row.id;
    dto.name            = row.name;
    dto.description     = row.description ?? null;
    dto.status          = row.status;
    dto.ownerId         = row.owner_id;
    dto.selectedProjects = row.selected_projects ?? [];
    dto.selectedBoms     = row.selected_boms ?? [];
    dto.bomCount         = row.bom_count ?? 0;
    dto.savedInsights    = row.saved_insights ?? null;
    dto.createdAt        = row.created_at;
    dto.updatedAt        = row.updated_at;
    return dto;
  }
}
