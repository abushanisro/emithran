import { IsUUID, IsNumber, IsOptional, IsBoolean, IsObject } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class BomItemCostDto {
  @ApiProperty({ description: 'Unique identifier for the cost record' })
  @IsUUID()
  id: string;

  @ApiProperty({ description: 'BOM item this cost belongs to' })
  @IsUUID()
  bomItemId: string;

  @ApiProperty({ description: 'User who owns this record' })
  @IsUUID()
  userId: string;

  @ApiProperty({ description: 'Raw material cost', example: 125.50 })
  @IsNumber()
  rawMaterialCost: number;

@ApiProperty({ description: 'Process/manufacturing cost', example: 75.25 })
  @IsNumber()
  processCost: number;

  @ApiProperty({ description: 'Tooling and fixture cost', example: 15.50 })
  @IsNumber()
  toolingCost: number;

  @ApiProperty({ description: 'Packaging and logistics cost', example: 25.00 })
  @IsNumber()
  @IsOptional()
  packagingLogisticsCost?: number;

  @ApiProperty({ description: 'Procured parts cost', example: 50.00 })
  @IsNumber()
  @IsOptional()
  procuredPartsCost?: number;

  @ApiProperty({ description: 'Sum of immediate children costs', example: 200.00 })
  @IsNumber()
  directChildrenCost: number;

  @ApiProperty({ description: 'Own cost (material + process)', example: 200.75 })
  @IsNumber()
  ownCost: number;

  @ApiProperty({ description: 'Total cost including all children', example: 400.75 })
  @IsNumber()
  totalCost: number;

  @ApiProperty({ description: 'Cost per unit', example: 400.75 })
  @IsNumber()
  unitCost: number;

  @ApiProperty({ description: 'Extended cost (unit cost × quantity)', example: 4007.50 })
  @IsNumber()
  extendedCost: number;

  @ApiProperty({ description: 'SGA percentage', example: 15.5 })
  @IsNumber()
  @IsOptional()
  sgaPercentage?: number;

  @ApiProperty({ description: 'Profit percentage', example: 20.0 })
  @IsNumber()
  @IsOptional()
  profitPercentage?: number;

  @ApiProperty({ description: 'Final selling price', example: 542.00 })
  @IsNumber()
  sellingPrice: number;

  @ApiProperty({ description: 'Detailed cost breakdown', type: 'object', additionalProperties: true })
  @IsObject()
  @IsOptional()
  costBreakdown?: Record<string, any>;

  @ApiProperty({ description: 'Flag indicating if recalculation is needed' })
  @IsBoolean()
  isStale: boolean;

  @ApiProperty({ description: 'Last calculation timestamp' })
  lastCalculatedAt: Date;

  @ApiProperty({ description: 'Creation timestamp' })
  createdAt: Date;

  @ApiProperty({ description: 'Last update timestamp' })
  updatedAt: Date;
}

export class UpdateBomItemCostDto {
  @ApiProperty({ description: 'Raw material cost', required: false })
  @IsNumber()
  @IsOptional()
  rawMaterialCost?: number;

@ApiProperty({ description: 'Process cost', required: false })
  @IsNumber()
  @IsOptional()
  processCost?: number;

  @ApiProperty({ description: 'Tooling cost', required: false })
  @IsNumber()
  @IsOptional()
  toolingCost?: number;

  @ApiProperty({ description: 'Packaging and logistics cost', required: false })
  @IsNumber()
  @IsOptional()
  packagingLogisticsCost?: number;

  @ApiProperty({ description: 'Procured parts cost', required: false })
  @IsNumber()
  @IsOptional()
  procuredPartsCost?: number;

  @ApiProperty({ description: 'SGA percentage', required: false })
  @IsNumber()
  @IsOptional()
  sgaPercentage?: number;

  @ApiProperty({ description: 'Profit percentage', required: false })
  @IsNumber()
  @IsOptional()
  profitPercentage?: number;
}

export class BomItemCostSummaryDto {
  @ApiProperty({ description: 'BOM item ID' })
  bomItemId: string;

  @ApiProperty({ description: 'Item name' })
  name: string;

  @ApiProperty({ description: 'Item type' })
  itemType: 'assembly' | 'sub_assembly' | 'child_part' | 'bop';

  @ApiProperty({ description: 'Total cost' })
  totalCost: number;

  @ApiProperty({ description: 'Raw material cost' })
  rawMaterialCost: number;

  @ApiProperty({ description: 'Process cost' })
  processCost: number;

  @ApiProperty({ description: 'Tooling cost' })
  toolingCost: number;

  @ApiProperty({ description: 'Packaging and logistics cost' })
  packagingLogisticsCost: number;

  @ApiProperty({ description: 'Procured parts cost' })
  procuredPartsCost: number;

  @ApiProperty({ description: 'Direct children cost' })
  directChildrenCost: number;

  @ApiProperty({ description: 'Number of children' })
  childrenCount: number;

  @ApiProperty({ description: 'Is cost stale' })
  isStale: boolean;

  @ApiProperty({ description: 'Children costs', type: [BomItemCostSummaryDto] })
  children?: BomItemCostSummaryDto[];
}
