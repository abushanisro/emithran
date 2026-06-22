import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { CostAggregationService, BomItemCostDto } from './cost-aggregation.service';
import { AccessToken } from '../../common/decorators/access-token.decorator';

@ApiTags('Cost Analysis')
@ApiBearerAuth()
@Controller({ path: 'api/cost-analysis', version: '1' })
export class CostAnalysisController {
  constructor(private readonly costAggregation: CostAggregationService) {}

  @Get('bom-item/:bomItemId')
  @ApiOperation({ summary: 'Get authoritative aggregated cost breakdown for a BOM item. Computes from raw source fields — never reads stale stored totals.' })
  @ApiResponse({ status: 200, description: 'BOM item cost breakdown computed successfully' })
  async getBomItemCost(
    @Param('bomItemId') bomItemId: string,
    @AccessToken() token: string,
  ): Promise<BomItemCostDto> {
    return this.costAggregation.computeBomItemCost(bomItemId, token);
  }
}
