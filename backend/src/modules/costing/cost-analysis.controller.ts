import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { CostAggregationService, BomItemCostDto } from './cost-aggregation.service';
import { LocationComparisonService, LocationComparisonDto } from './location-comparison.service';
import { AccessToken } from '../../common/decorators/access-token.decorator';

@ApiTags('Cost Analysis')
@ApiBearerAuth()
@Controller({ path: 'api/cost-analysis', version: '1' })
export class CostAnalysisController {
  constructor(
    private readonly costAggregation: CostAggregationService,
    private readonly locationComparison: LocationComparisonService,
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
