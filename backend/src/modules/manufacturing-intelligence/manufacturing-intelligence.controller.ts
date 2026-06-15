interface User { id: string; email: string; [key: string]: any; }
import {
  Controller, Get, Post, Put, Delete,
  Query, Param, Body, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { ManufacturingIntelligenceService } from './manufacturing-intelligence.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AccessToken } from '../../common/decorators/access-token.decorator';
import {
  QueryCompatibilityDto,
  QueryFeatureCostRulesDto,
  QueryDfmRulesDto,
  QuerySupplierKpiDto,
  QueryCommodityPricesDto,
  QuerySupplierPerformanceDto,
  CreateSupplierPerformanceDto,
  UpdateSupplierPerformanceDto,
} from './dto/manufacturing-intelligence.dto';

@ApiTags('Manufacturing Intelligence')
@ApiBearerAuth()
@Controller({ path: 'api/manufacturing-intelligence', version: '1' })
export class ManufacturingIntelligenceController {
  constructor(private readonly service: ManufacturingIntelligenceService) {}

  // ── Global knowledge tables ─────────────────────────────────────────────────

  @Get('material-process-compatibility')
  @ApiOperation({ summary: 'Material-process compatibility matrix with suitability scores (1-10)' })
  @ApiResponse({ status: 200, description: 'Compatibility data ordered by score descending' })
  getMaterialProcessCompatibility(
    @Query() query: QueryCompatibilityDto,
    @AccessToken() token: string,
  ) {
    return this.service.getMaterialProcessCompatibility(query, token);
  }

  @Get('feature-cost-rules')
  @ApiOperation({ summary: 'Feature-level cost rules: machining time and cost by feature type and size' })
  @ApiResponse({ status: 200, description: 'Feature cost rules for CAD-to-cost estimation' })
  getFeatureCostRules(
    @Query() query: QueryFeatureCostRulesDto,
    @AccessToken() token: string,
  ) {
    return this.service.getFeatureCostRules(query, token);
  }

  @Get('dfm-rules')
  @ApiOperation({ summary: 'DFM rules library: violations, cost impact, and recommendations by process' })
  @ApiResponse({ status: 200, description: 'DFM rules ordered Critical > Warning > Advisory' })
  getDfmRules(
    @Query() query: QueryDfmRulesDto,
    @AccessToken() token: string,
  ) {
    return this.service.getDfmRules(query, token);
  }

  @Get('supplier-kpi-benchmarks')
  @ApiOperation({ summary: 'Supplier KPI benchmarks: world-class / target / acceptable / poor thresholds' })
  @ApiResponse({ status: 200, description: 'KPI benchmark data by industry sector' })
  getSupplierKpiBenchmarks(
    @Query() query: QuerySupplierKpiDto,
    @AccessToken() token: string,
  ) {
    return this.service.getSupplierKpiBenchmarks(query, token);
  }

  @Get('commodity-prices')
  @ApiOperation({ summary: 'Commodity price history: LME metals, steel, polymers — quarterly 2021-2024' })
  @ApiResponse({ status: 200, description: 'Commodity price history data' })
  getCommodityPrices(
    @Query() query: QueryCommodityPricesDto,
    @AccessToken() token: string,
  ) {
    return this.service.getCommodityPrices(query, token);
  }

  // ── Supplier performance records (user-owned CRUD) ──────────────────────────

  @Get('supplier-performance')
  @ApiOperation({ summary: 'List supplier performance records for the authenticated user' })
  @ApiResponse({ status: 200, description: 'Supplier performance records' })
  getSupplierPerformance(
    @Query() query: QuerySupplierPerformanceDto,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    return this.service.getSupplierPerformance(query, user.id, token);
  }

  @Get('supplier-performance/:id')
  @ApiOperation({ summary: 'Get a single supplier performance record' })
  @ApiParam({ name: 'id', description: 'Record UUID' })
  @ApiResponse({ status: 200, description: 'Supplier performance record' })
  @ApiResponse({ status: 404, description: 'Not found' })
  getSupplierPerformanceById(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    return this.service.getSupplierPerformanceById(id, user.id, token);
  }

  @Post('supplier-performance')
  @ApiOperation({ summary: 'Create a supplier performance record' })
  @ApiResponse({ status: 201, description: 'Created supplier performance record' })
  createSupplierPerformance(
    @Body() dto: CreateSupplierPerformanceDto,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    return this.service.createSupplierPerformance(dto, user.id, token);
  }

  @Put('supplier-performance/:id')
  @ApiOperation({ summary: 'Update a supplier performance record' })
  @ApiParam({ name: 'id', description: 'Record UUID' })
  @ApiResponse({ status: 200, description: 'Updated supplier performance record' })
  updateSupplierPerformance(
    @Param('id') id: string,
    @Body() dto: UpdateSupplierPerformanceDto,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    return this.service.updateSupplierPerformance(id, dto, user.id, token);
  }

  @Delete('supplier-performance/:id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete a supplier performance record' })
  @ApiParam({ name: 'id', description: 'Record UUID' })
  @ApiResponse({ status: 200, description: 'Deleted successfully' })
  deleteSupplierPerformance(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    return this.service.deleteSupplierPerformance(id, user.id, token);
  }
}
