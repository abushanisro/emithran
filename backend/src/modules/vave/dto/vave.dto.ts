import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsString, IsOptional, IsNumber, IsArray, IsIn, Min, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

// ─── Project DTOs ─────────────────────────────────────────────────────────────

export class CreateVaveProjectDto {
  @ApiProperty({ example: 'Motor Assembly VAVE 2026' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ example: 'Drive Systems' })
  @IsOptional()
  @IsString()
  productFamily?: string;

  @ApiPropertyOptional({ example: 'Q3 2026 cost-reduction initiative targeting 15% savings' })
  @IsOptional()
  @IsString()
  description?: string;
}

export class UpdateVaveProjectDto extends PartialType(CreateVaveProjectDto) {
  @ApiPropertyOptional({ enum: ['phase1', 'phase2', 'phase3', 'complete'] })
  @IsOptional()
  @IsString()
  @IsIn(['phase1', 'phase2', 'phase3', 'complete'])
  status?: string;
}

// ─── BOM Item DTOs ────────────────────────────────────────────────────────────

export class CreateVaveBomItemDto {
  @ApiProperty({ example: 'MTR-001' })
  @IsString()
  partNumber: string;

  @ApiPropertyOptional({ example: 'Motor Bracket Assembly' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  level?: number;

  @ApiPropertyOptional({ example: 'MTR-000' })
  @IsOptional()
  @IsString()
  parentPn?: string;

  @ApiPropertyOptional({ example: 4 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  quantity?: number;

  @ApiPropertyOptional({ example: 125.5 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  unitCost?: number;

  @ApiPropertyOptional({ example: 5000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  annualVolume?: number;

  @ApiPropertyOptional({ example: 'Steel 1018' })
  @IsOptional()
  @IsString()
  material?: string;

  @ApiPropertyOptional({ example: 'CNC Machining' })
  @IsOptional()
  @IsString()
  process?: string;

  @ApiPropertyOptional({ example: 'Precision Parts Ltd' })
  @IsOptional()
  @IsString()
  supplierName?: string;

  @ApiPropertyOptional({ example: 'https://example.com/drawing.pdf' })
  @IsOptional()
  @IsString()
  drawingUrl?: string;

  @ApiPropertyOptional({ example: 'https://example.com/model.step' })
  @IsOptional()
  @IsString()
  modelUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  drawingAnalysis?: Record<string, any>;
}

export class BulkImportVaveBomDto {
  @ApiProperty({ type: [CreateVaveBomItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateVaveBomItemDto)
  items: CreateVaveBomItemDto[];
}

// ─── Idea DTOs ────────────────────────────────────────────────────────────────

export class CreateVaveIdeaDto {
  @ApiProperty({ example: 'Substitute steel bracket with aluminium casting' })
  @IsString()
  title: string;

  @ApiPropertyOptional({ example: 'Replace the current steel bracket with die-cast aluminium...' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 'SCAMPER', enum: ['SCAMPER', 'TRIZ', 'FAST', 'Manual'] })
  @IsOptional()
  @IsString()
  @IsIn(['SCAMPER', 'TRIZ', 'FAST', 'Manual'])
  framework?: string;

  @ApiPropertyOptional({ example: 'Substitute' })
  @IsOptional()
  @IsString()
  scamperType?: string;

  @ApiPropertyOptional({ example: ['MTR-001', 'MTR-002'], type: [String] })
  @IsOptional()
  @IsArray()
  affectedParts?: string[];

  @ApiPropertyOptional({ example: 45000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  estSavingsUsd?: number;

  @ApiPropertyOptional({ example: 12000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  estInvestmentUsd?: number;

  @ApiPropertyOptional({ example: 'High', enum: ['High', 'Medium', 'Low'] })
  @IsOptional()
  @IsString()
  @IsIn(['High', 'Medium', 'Low'])
  feasibility?: string;

  @ApiPropertyOptional({ example: 'L1', enum: ['L1', 'L2', 'L3'] })
  @IsOptional()
  @IsString()
  @IsIn(['L1', 'L2', 'L3'])
  complexity?: string;

  @ApiPropertyOptional({ example: 'Low', enum: ['High', 'Medium', 'Low'] })
  @IsOptional()
  @IsString()
  @IsIn(['High', 'Medium', 'Low'])
  risk?: string;

  @ApiPropertyOptional({ example: 'QuickWin', enum: ['QuickWin', 'Strategic', 'FillIn', 'Avoid'] })
  @IsOptional()
  @IsString()
  @IsIn(['QuickWin', 'Strategic', 'FillIn', 'Avoid'])
  quadrant?: string;

  @ApiPropertyOptional({ example: 'draft', enum: ['draft', 'approved', 'in-progress', 'done'] })
  @IsOptional()
  @IsString()
  @IsIn(['draft', 'approved', 'in-progress', 'done'])
  status?: string;

  @ApiPropertyOptional({ example: 6 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  timeToImplementMonths?: number;
}

export class UpdateVaveIdeaDto extends PartialType(CreateVaveIdeaDto) {}

export class BulkCreateVaveIdeasDto {
  @ApiProperty({ type: [CreateVaveIdeaDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateVaveIdeaDto)
  ideas: CreateVaveIdeaDto[];
}

// ─── Should Cost DTOs ─────────────────────────────────────────────────────────

export class CreateVaveShouldCostDto {
  @ApiProperty({ example: 'MTR-001' })
  @IsString()
  partNumber: string;

  @ApiPropertyOptional({ example: 'Motor Bracket' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: 125.5 })
  @IsNumber()
  @Min(0)
  actualCost: number;

  @ApiProperty({ example: 98.2 })
  @IsNumber()
  @Min(0)
  shouldCost: number;

  @ApiPropertyOptional({ example: 0.22 })
  @IsOptional()
  @IsNumber()
  deltaPct?: number;

  @ApiPropertyOptional({ example: 44.19 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  materialCost?: number;

  @ApiPropertyOptional({ example: 29.46 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  processCost?: number;

  @ApiPropertyOptional({ example: 18.41 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  overhead?: number;

  @ApiPropertyOptional({ example: 14.73 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  margin?: number;

  @ApiPropertyOptional({ example: 'Bottom-up model v1' })
  @IsOptional()
  @IsString()
  benchmarkSource?: string;
}

// ─── Response DTOs ────────────────────────────────────────────────────────────

export class VaveProjectResponseDto {
  id: string;
  name: string;
  productFamily: string | null;
  description: string | null;
  status: string;
  ownerId: string | null;
  createdAt: string;
  updatedAt: string;

  static fromDatabase(row: Record<string, any>): VaveProjectResponseDto {
    const dto = new VaveProjectResponseDto();
    dto.id = row.id;
    dto.name = row.name;
    dto.productFamily = row.product_family ?? null;
    dto.description = row.description ?? null;
    dto.status = row.status;
    dto.ownerId = row.owner_id ?? null;
    dto.createdAt = row.created_at;
    dto.updatedAt = row.updated_at;
    return dto;
  }
}

export class VaveProjectDetailResponseDto extends VaveProjectResponseDto {
  bomCount: number;
  ideaCount: number;
  totalSavings: number;

  static fromDatabaseWithStats(
    row: Record<string, any>,
    bomCount: number,
    ideaCount: number,
    totalSavings: number,
  ): VaveProjectDetailResponseDto {
    const dto = new VaveProjectDetailResponseDto();
    Object.assign(dto, VaveProjectResponseDto.fromDatabase(row));
    dto.bomCount = bomCount;
    dto.ideaCount = ideaCount;
    dto.totalSavings = totalSavings;
    return dto;
  }
}

export class VaveBomItemResponseDto {
  id: string;
  projectId: string;
  partNumber: string;
  description: string | null;
  level: number;
  parentPn: string | null;
  quantity: number;
  unitCost: number;
  annualVolume: number;
  annualSpend: number;
  material: string | null;
  process: string | null;
  supplierName: string | null;
  drawingUrl: string | null;
  modelUrl: string | null;
  drawingAnalysis: Record<string, any> | null;
  createdAt: string;

  static fromDatabase(row: Record<string, any>): VaveBomItemResponseDto {
    const dto = new VaveBomItemResponseDto();
    dto.id = row.id;
    dto.projectId = row.project_id;
    dto.partNumber = row.part_number;
    dto.description = row.description ?? null;
    dto.level = row.level ?? 1;
    dto.parentPn = row.parent_pn ?? null;
    dto.quantity = Number(row.quantity ?? 1);
    dto.unitCost = Number(row.unit_cost ?? 0);
    dto.annualVolume = Number(row.annual_volume ?? 0);
    dto.annualSpend = Number(row.annual_spend ?? 0);
    dto.material = row.material ?? null;
    dto.process = row.process ?? null;
    dto.supplierName = row.supplier_name ?? null;
    dto.drawingUrl = row.drawing_url ?? null;
    dto.modelUrl = row.model_url ?? null;
    dto.drawingAnalysis = row.drawing_analysis ?? null;
    dto.createdAt = row.created_at;
    return dto;
  }
}

export class VaveIdeaResponseDto {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  framework: string;
  scamperType: string | null;
  affectedParts: string[];
  estSavingsUsd: number;
  estInvestmentUsd: number;
  feasibility: string;
  complexity: string;
  risk: string;
  quadrant: string | null;
  status: string;
  timeToImplementMonths: number | null;
  createdAt: string;
  updatedAt: string;

  static fromDatabase(row: Record<string, any>): VaveIdeaResponseDto {
    const dto = new VaveIdeaResponseDto();
    dto.id = row.id;
    dto.projectId = row.project_id;
    dto.title = row.title;
    dto.description = row.description ?? null;
    dto.framework = row.framework ?? 'Manual';
    dto.scamperType = row.scamper_type ?? null;
    dto.affectedParts = Array.isArray(row.affected_parts) ? row.affected_parts : [];
    dto.estSavingsUsd = Number(row.est_savings_usd ?? 0);
    dto.estInvestmentUsd = Number(row.est_investment_usd ?? 0);
    dto.feasibility = row.feasibility ?? 'Medium';
    dto.complexity = row.complexity ?? 'L2';
    dto.risk = row.risk ?? 'Medium';
    dto.quadrant = row.quadrant ?? null;
    dto.status = row.status ?? 'draft';
    dto.timeToImplementMonths = row.time_to_implement_months ?? null;
    dto.createdAt = row.created_at;
    dto.updatedAt = row.updated_at;
    return dto;
  }
}

export class VaveShouldCostResponseDto {
  id: string;
  projectId: string;
  partNumber: string;
  description: string | null;
  actualCost: number;
  shouldCost: number;
  delta: number;
  deltaPct: number | null;
  materialCost: number | null;
  processCost: number | null;
  overhead: number | null;
  margin: number | null;
  benchmarkSource: string | null;
  createdAt: string;

  static fromDatabase(row: Record<string, any>): VaveShouldCostResponseDto {
    const dto = new VaveShouldCostResponseDto();
    dto.id = row.id;
    dto.projectId = row.project_id;
    dto.partNumber = row.part_number;
    dto.description = row.description ?? null;
    dto.actualCost = Number(row.actual_cost ?? 0);
    dto.shouldCost = Number(row.should_cost ?? 0);
    dto.delta = Number(row.delta ?? 0);
    dto.deltaPct = row.delta_pct != null ? Number(row.delta_pct) : null;
    dto.materialCost = row.material_cost != null ? Number(row.material_cost) : null;
    dto.processCost = row.process_cost != null ? Number(row.process_cost) : null;
    dto.overhead = row.overhead != null ? Number(row.overhead) : null;
    dto.margin = row.margin != null ? Number(row.margin) : null;
    dto.benchmarkSource = row.benchmark_source ?? null;
    dto.createdAt = row.created_at;
    return dto;
  }
}
