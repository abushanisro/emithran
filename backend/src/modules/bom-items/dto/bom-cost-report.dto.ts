import { ApiProperty } from '@nestjs/swagger';

export class CostByTypeDto {
  @ApiProperty({ description: 'Item type' })
  itemType: 'assembly' | 'sub_assembly' | 'child_part' | 'bop';

  @ApiProperty({ description: 'Number of items' })
  count: number;

  @ApiProperty({ description: 'Total raw material cost' })
  rawMaterialCost: number;

  @ApiProperty({ description: 'Total process cost' })
  processCost: number;

  @ApiProperty({ description: 'Total tooling cost' })
  toolingCost: number;

  @ApiProperty({ description: 'Total own cost (material + process + tooling)' })
  ownCost: number;

  @ApiProperty({ description: 'Total cost including children' })
  totalCost: number;
}

export class CostBreakdownDto {
  @ApiProperty({ description: 'Total raw material costs (summed from all items)' })
  totalRawMaterialCost: number;

  @ApiProperty({ description: 'Total process costs (summed from all items)' })
  totalProcessCost: number;

  @ApiProperty({ description: 'Total tooling costs (summed from all items)' })
  totalToolingCost: number;

  @ApiProperty({ description: 'Total packaging and logistics costs (summed from all items)' })
  totalPackagingLogisticsCost: number;

  @ApiProperty({ description: 'Total procured parts costs (summed from all items)' })
  totalProcuredPartsCost: number;

  @ApiProperty({ description: 'Overall total cost (summed from root items only to avoid double counting)' })
  overallTotalCost: number;

  @ApiProperty({ description: 'Average SGA percentage' })
  averageSgaPercentage: number;

  @ApiProperty({ description: 'Average profit percentage' })
  averageProfitPercentage: number;

  @ApiProperty({ description: 'Total selling price' })
  totalSellingPrice: number;
}

export class BomCostReportDto {
  @ApiProperty({ description: 'BOM ID' })
  bomId: string;

  @ApiProperty({ description: 'BOM name' })
  bomName: string;

  @ApiProperty({ description: 'Total number of items' })
  totalItems: number;

  @ApiProperty({ description: 'Number of items with costs calculated' })
  itemsWithCosts: number;

  @ApiProperty({ description: 'Number of stale cost records' })
  staleCosts: number;

  @ApiProperty({ description: 'Cost breakdown by type', type: [CostByTypeDto] })
  costByType: CostByTypeDto[];

  @ApiProperty({ description: 'Overall cost breakdown', type: CostBreakdownDto })
  breakdown: CostBreakdownDto;

  @ApiProperty({ description: 'Top-level assemblies', type: 'array' })
  topLevelAssemblies: Array<{
    id: string;
    name: string;
    itemType: string;
    totalCost: number;
    sellingPrice: number;
  }>;

  @ApiProperty({ description: 'Report generated timestamp' })
  generatedAt: string;
}
