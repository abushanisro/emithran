import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { CostAggregationService, BomItemCostDto } from './cost-aggregation.service';
import { LocationComparisonService, LocationComparisonDto } from './location-comparison.service';
import { ExcelReportService } from './excel-report.service';
import { AccessToken } from '../../common/decorators/access-token.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Cost Analysis')
@ApiBearerAuth()
@Controller({ path: 'api/cost-analysis', version: '1' })
export class CostAnalysisController {
  constructor(
    private readonly costAggregation: CostAggregationService,
    private readonly locationComparison: LocationComparisonService,
    private readonly excelReport: ExcelReportService,
  ) {}

  @Get('bom-item/:bomItemId')
  @ApiOperation({ summary: 'Get authoritative aggregated cost breakdown for a BOM item. Computes from raw source fields — never reads stale stored totals.' })
  @ApiResponse({ status: 200, description: 'BOM item cost breakdown computed successfully' })
  async getBomItemCost(
    @Param('bomItemId') bomItemId: string,
    @AccessToken() token: string,
  ): Promise<BomItemCostDto> {
    return this.costAggregation.computeBomItemCost(bomItemId, token);
  }

  @Get('bom-item/:bomItemId/excel')
  @ApiOperation({ summary: 'Download a formula-driven Part Cost Report workbook (.xlsx) for a BOM item — editable process/material cost formulas plus a live CAD-calculation-trace verification sheet, all sourced from the same data as the on-screen cost analysis.' })
  @ApiResponse({ status: 200, description: 'XLSX file stream' })
  async downloadBomItemExcel(
    @Param('bomItemId') bomItemId: string,
    @Query('batchSize') batchSize: string,
    @Query('location') location: string,
    @CurrentUser('id') userId: string,
    @AccessToken() token: string,
    @Res() res: Response,
  ): Promise<void> {
    const { buffer, filename } = await this.excelReport.generateBomItemReport(
      bomItemId,
      userId,
      token,
      batchSize ? parseInt(batchSize, 10) : undefined,
      location || undefined,
    );
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  }

  @Get('bom-item/:bomItemId/location-comparison')
  @ApiOperation({ summary: 'Re-cost the same route across all 10 digital factory locations using their actual MHR+LHR rates, sorted cheapest to most expensive.' })
  @ApiResponse({ status: 200, description: 'Location comparison matrix returned successfully' })
  async getLocationComparison(
    @Param('bomItemId') bomItemId: string,
    @AccessToken() token: string,
  ): Promise<LocationComparisonDto> {
    return this.locationComparison.computeLocationComparison(bomItemId, token);
  }
}
