import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional, IsString, IsNumber, IsBoolean, IsDateString,
  IsUUID, IsIn, Min, Max, IsArray,
} from 'class-validator';
import { Type } from 'class-transformer';

export class PaginationQueryDto {
  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ example: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(200)
  limit?: number;
}

// ── RFQ History ──────────────────────────────────────────────────────────────

export class QueryRfqHistoryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: 'Open', enum: ['Open', 'Quoted', 'Won', 'Lost', 'No-bid', 'On Hold'] })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ example: 'Acme Corp' })
  @IsOptional()
  @IsString()
  customerName?: string;

  @ApiPropertyOptional({ example: 'CNC Machining' })
  @IsOptional()
  @IsString()
  processName?: string;
}

export class CreateRfqHistoryDto {
  @ApiProperty({ example: 'RFQ-2024-001' })
  @IsString()
  rfqNumber: string;

  @ApiProperty({ example: 'Acme Corp' })
  @IsString()
  customerName: string;

  @ApiProperty({ example: 'Bracket Assembly' })
  @IsString()
  partName: string;

  @ApiPropertyOptional({ example: 'BA-001' })
  @IsOptional()
  @IsString()
  partNumber?: string;

  @ApiPropertyOptional({ example: 500 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  quantity?: number;

  @ApiPropertyOptional({ example: 'Aluminium 6061' })
  @IsOptional()
  @IsString()
  material?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  processId?: string;

  @ApiPropertyOptional({ example: 'CNC Machining' })
  @IsOptional()
  @IsString()
  processName?: string;

  @ApiPropertyOptional({ example: 'Open', enum: ['Open', 'Quoted', 'Won', 'Lost', 'No-bid', 'On Hold'] })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ example: 'High', enum: ['Low', 'Medium', 'High', 'Critical'] })
  @IsOptional()
  @IsString()
  priority?: string;

  @ApiPropertyOptional({ example: 'Email' })
  @IsOptional()
  @IsString()
  source?: string;

  @ApiPropertyOptional({ example: '2024-03-31' })
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateRfqHistoryDto {
  @ApiPropertyOptional({ example: 'Won', enum: ['Open', 'Quoted', 'Won', 'Lost', 'No-bid', 'On Hold'] })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  priority?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  respondedAt?: string;
}

// ── Quote Line Items ─────────────────────────────────────────────────────────

export class QueryQuoteLineItemsDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  rfqId?: string;
}

export class CreateQuoteLineItemDto {
  @ApiProperty()
  @IsUUID()
  rfqId: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsNumber()
  lineNumber?: number;

  @ApiPropertyOptional({ example: 'CNC Milled Bracket' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: 500 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  quantity?: number;

  @ApiPropertyOptional({ example: 12.50 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  materialCostUsd?: number;

  @ApiPropertyOptional({ example: 8.75 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  processCostUsd?: number;

  @ApiPropertyOptional({ example: 3.20 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  overheadCostUsd?: number;

  @ApiPropertyOptional({ example: 15.0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  profitMarginPct?: number;

  @ApiPropertyOptional({ example: 27.85 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  unitPriceUsd?: number;

  @ApiPropertyOptional({ example: 13925.0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  totalPriceUsd?: number;

  @ApiPropertyOptional({ example: 'IN' })
  @IsOptional()
  @IsString()
  countryFactorApplied?: string;

  @ApiPropertyOptional({ example: 'Automotive-Medium-Asia' })
  @IsOptional()
  @IsString()
  overheadProfileApplied?: string;

  @ApiPropertyOptional({ example: 'process_scrap_rates table' })
  @IsOptional()
  @IsString()
  scrapRateSource?: string;

  @ApiPropertyOptional({ example: 'process_cycle_time_library' })
  @IsOptional()
  @IsString()
  cycleTimeSource?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateQuoteLineItemDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  materialCostUsd?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  processCostUsd?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  overheadCostUsd?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  profitMarginPct?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  unitPriceUsd?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  totalPriceUsd?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

// ── Quote Outcomes ────────────────────────────────────────────────────────────

export class QueryQuoteOutcomesDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  rfqId?: string;

  @ApiPropertyOptional({ example: 'Won', enum: ['Won', 'Lost', 'No-bid', 'Cancelled'] })
  @IsOptional()
  @IsString()
  outcome?: string;
}

export class CreateQuoteOutcomeDto {
  @ApiProperty()
  @IsUUID()
  rfqId: string;

  @ApiProperty({ example: '2024-03-15' })
  @IsDateString()
  outcomeDate: string;

  @ApiProperty({ example: 'Won', enum: ['Won', 'Lost', 'No-bid', 'Cancelled'] })
  @IsString()
  outcome: string;

  @ApiPropertyOptional({ example: 'Price too high', enum: ['Price too high', 'Lead time', 'Quality', 'Relationship', 'Technical', 'Other'] })
  @IsOptional()
  @IsString()
  lossReason?: string;

  @ApiPropertyOptional({ example: 24.50 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  competitorPriceUsd?: number;

  @ApiPropertyOptional({ example: 27.85 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  ourPriceUsd?: number;

  @ApiPropertyOptional({ example: 25.00 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  priceToWinUsd?: number;

  @ApiPropertyOptional({ example: 'On-time delivery track record' })
  @IsOptional()
  @IsString()
  keyWinFactor?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

// ── Actual vs Estimated ───────────────────────────────────────────────────────

export class QueryActualsDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  rfqId?: string;
}

export class CreateActualVsEstimatedDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  rfqId?: string;

  @ApiProperty({ example: 'Bracket Assembly' })
  @IsString()
  partName: string;

  @ApiPropertyOptional({ example: 12.50 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  estMaterialCostUsd?: number;

  @ApiPropertyOptional({ example: 13.20 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  actMaterialCostUsd?: number;

  @ApiPropertyOptional({ example: 8.75 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  estProcessCostUsd?: number;

  @ApiPropertyOptional({ example: 9.10 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  actProcessCostUsd?: number;

  @ApiPropertyOptional({ example: 3.20 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  estOverheadCostUsd?: number;

  @ApiPropertyOptional({ example: 3.50 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  actOverheadCostUsd?: number;

  @ApiPropertyOptional({ example: 24.45 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  estTotalCostUsd?: number;

  @ApiPropertyOptional({ example: 25.80 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  actTotalCostUsd?: number;

  @ApiPropertyOptional({ example: '2024-06-01' })
  @IsOptional()
  @IsDateString()
  productionDate?: string;

  @ApiPropertyOptional({ example: 500 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  quantityProduced?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

// ── BOM Cost Snapshots ────────────────────────────────────────────────────────

export class QueryBomSnapshotsDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  projectId?: string;
}

export class CreateBomSnapshotDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @ApiProperty({ example: 'Rev A BOM — June 2024' })
  @IsString()
  bomName: string;

  @ApiProperty({ example: '2024-06-14' })
  @IsDateString()
  snapshotDate: string;

  @ApiProperty({ example: 13925.0 })
  @IsNumber()
  @Min(0)
  totalCostUsd: number;

  @ApiProperty({ example: 500 })
  @IsNumber()
  @Min(1)
  quantity: number;

  @ApiPropertyOptional({ description: 'UUID of earlier snapshot for change tracking' })
  @IsOptional()
  @IsUUID()
  baselineSnapshotId?: string;

  @ApiPropertyOptional({ example: 'Material cost increase Q2' })
  @IsOptional()
  @IsString()
  changeReason?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}

// ── Assembly Cost Breakdown ───────────────────────────────────────────────────

export class QueryAssemblyBreakdownDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  bomSnapshotId?: string;
}

export class CreateAssemblyBreakdownDto {
  @ApiProperty()
  @IsUUID()
  bomSnapshotId: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  bomLevel?: number;

  @ApiPropertyOptional({ example: 'BA-001-SUB1' })
  @IsOptional()
  @IsString()
  partNumber?: string;

  @ApiProperty({ example: 'Side Plate' })
  @IsString()
  partName: string;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  qtyPerAssembly?: number;

  @ApiPropertyOptional({ example: 12.50 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  unitCostUsd?: number;

  @ApiPropertyOptional({ example: 'Material' })
  @IsOptional()
  @IsString()
  costDriver?: string;

  @ApiPropertyOptional({ example: 'Switch to recycled Al' })
  @IsOptional()
  @IsString()
  shouldCostOpportunity?: string;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  alternateProcessExists?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
