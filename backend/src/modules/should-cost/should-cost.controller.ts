interface User { id: string; email: string; [key: string]: any; }
import {
  Controller, Get, Post, Put, Delete,
  Query, Param, Body, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { ShouldCostService } from './should-cost.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AccessToken } from '../../common/decorators/access-token.decorator';
import {
  QueryRfqHistoryDto,
  CreateRfqHistoryDto,
  UpdateRfqHistoryDto,
  QueryQuoteLineItemsDto,
  CreateQuoteLineItemDto,
  UpdateQuoteLineItemDto,
  QueryQuoteOutcomesDto,
  CreateQuoteOutcomeDto,
  QueryActualsDto,
  CreateActualVsEstimatedDto,
  QueryBomSnapshotsDto,
  CreateBomSnapshotDto,
  QueryAssemblyBreakdownDto,
  CreateAssemblyBreakdownDto,
} from './dto/should-cost.dto';

@ApiTags('Should-Cost Intelligence')
@ApiBearerAuth()
@Controller({ path: 'api/should-cost', version: '1' })
export class ShouldCostController {
  constructor(private readonly service: ShouldCostService) {}

  // ── Analytics views (before parameterised routes to prevent routing conflict) ─

  @Get('analytics/win-rate')
  @ApiOperation({ summary: 'Win rate by process — from rfq_win_rate_by_process view' })
  @ApiResponse({ status: 200, description: 'Win rate analytics per process' })
  getWinRate(@CurrentUser() user: User, @AccessToken() token: string) {
    return this.service.getWinRateByProcess(user.id, token);
  }

  @Get('analytics/estimation-accuracy')
  @ApiOperation({ summary: 'Estimation accuracy by process — avg variance % from actuals' })
  @ApiResponse({ status: 200, description: 'Estimation accuracy analytics' })
  getEstimationAccuracy(@CurrentUser() user: User, @AccessToken() token: string) {
    return this.service.getEstimationAccuracy(user.id, token);
  }

  @Get('analytics/price-to-win')
  @ApiOperation({ summary: 'Price-to-win intelligence — lost RFQ price gap analysis' })
  @ApiResponse({ status: 200, description: 'Price-to-win analytics per process' })
  getPriceToWin(@CurrentUser() user: User, @AccessToken() token: string) {
    return this.service.getPriceToWin(user.id, token);
  }

  @Get('analytics/bom-cost-drivers')
  @ApiOperation({ summary: 'BOM cost driver analysis — top cost contributors across assemblies' })
  @ApiResponse({ status: 200, description: 'BOM cost driver analytics' })
  getBomCostDrivers(@CurrentUser() user: User, @AccessToken() token: string) {
    return this.service.getBomCostDrivers(user.id, token);
  }

  // ── RFQ History ──────────────────────────────────────────────────────────────

  @Get('rfq')
  @ApiOperation({ summary: 'List RFQ history with status and process filters' })
  @ApiResponse({ status: 200, description: 'Paginated RFQ history' })
  listRfq(
    @Query() query: QueryRfqHistoryDto,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    return this.service.listRfq(query, user.id, token);
  }

  @Get('rfq/:id')
  @ApiParam({ name: 'id', description: 'RFQ UUID' })
  @ApiOperation({ summary: 'Get a single RFQ record' })
  getRfq(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    return this.service.getRfq(id, user.id, token);
  }

  @Post('rfq')
  @ApiOperation({ summary: 'Create a new RFQ record' })
  @ApiResponse({ status: 201, description: 'Created RFQ' })
  createRfq(
    @Body() dto: CreateRfqHistoryDto,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    return this.service.createRfq(dto, user.id, token);
  }

  @Put('rfq/:id')
  @ApiParam({ name: 'id', description: 'RFQ UUID' })
  @ApiOperation({ summary: 'Update RFQ status, priority, or notes' })
  updateRfq(
    @Param('id') id: string,
    @Body() dto: UpdateRfqHistoryDto,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    return this.service.updateRfq(id, dto, user.id, token);
  }

  @Delete('rfq/:id')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id', description: 'RFQ UUID' })
  @ApiOperation({ summary: 'Delete an RFQ record' })
  deleteRfq(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    return this.service.deleteRfq(id, user.id, token);
  }

  // ── Quote Line Items ─────────────────────────────────────────────────────────

  @Get('quote-line-items')
  @ApiOperation({ summary: 'List quote line items; filter by rfqId' })
  listLineItems(
    @Query() query: QueryQuoteLineItemsDto,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    return this.service.listLineItems(query, user.id, token);
  }

  @Get('quote-line-items/:id')
  @ApiParam({ name: 'id', description: 'Line item UUID' })
  @ApiOperation({ summary: 'Get a single quote line item' })
  getLineItem(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    return this.service.getLineItem(id, user.id, token);
  }

  @Post('quote-line-items')
  @ApiOperation({ summary: 'Add a quote line item to an RFQ' })
  createLineItem(
    @Body() dto: CreateQuoteLineItemDto,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    return this.service.createLineItem(dto, user.id, token);
  }

  @Put('quote-line-items/:id')
  @ApiParam({ name: 'id', description: 'Line item UUID' })
  @ApiOperation({ summary: 'Update a quote line item' })
  updateLineItem(
    @Param('id') id: string,
    @Body() dto: UpdateQuoteLineItemDto,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    return this.service.updateLineItem(id, dto, user.id, token);
  }

  @Delete('quote-line-items/:id')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id', description: 'Line item UUID' })
  @ApiOperation({ summary: 'Delete a quote line item' })
  deleteLineItem(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    return this.service.deleteLineItem(id, user.id, token);
  }

  // ── Quote Outcomes ────────────────────────────────────────────────────────────

  @Get('quote-outcomes')
  @ApiOperation({ summary: 'List quote outcomes; filter by rfqId or outcome (Won/Lost)' })
  listOutcomes(
    @Query() query: QueryQuoteOutcomesDto,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    return this.service.listOutcomes(query, user.id, token);
  }

  @Post('quote-outcomes')
  @ApiOperation({ summary: 'Record a quote outcome; auto-updates rfq_history status for Won/Lost' })
  createOutcome(
    @Body() dto: CreateQuoteOutcomeDto,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    return this.service.createOutcome(dto, user.id, token);
  }

  @Delete('quote-outcomes/:id')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id', description: 'Outcome UUID' })
  @ApiOperation({ summary: 'Delete a quote outcome' })
  deleteOutcome(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    return this.service.deleteOutcome(id, user.id, token);
  }

  // ── Actual vs Estimated ───────────────────────────────────────────────────────

  @Get('actuals')
  @ApiOperation({ summary: 'List actual vs estimated cost records; total_variance_pct is DB-computed' })
  listActuals(
    @Query() query: QueryActualsDto,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    return this.service.listActuals(query, user.id, token);
  }

  @Post('actuals')
  @ApiOperation({ summary: 'Record actual production costs against estimate' })
  createActual(
    @Body() dto: CreateActualVsEstimatedDto,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    return this.service.createActual(dto, user.id, token);
  }

  @Delete('actuals/:id')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id', description: 'Actuals UUID' })
  @ApiOperation({ summary: 'Delete an actuals record' })
  deleteActual(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    return this.service.deleteActual(id, user.id, token);
  }

  // ── BOM Cost Snapshots ────────────────────────────────────────────────────────

  @Get('bom-snapshots')
  @ApiOperation({ summary: 'List BOM cost snapshots; filter by projectId' })
  listBomSnapshots(
    @Query() query: QueryBomSnapshotsDto,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    return this.service.listBomSnapshots(query, user.id, token);
  }

  @Get('bom-snapshots/:id')
  @ApiParam({ name: 'id', description: 'Snapshot UUID' })
  @ApiOperation({ summary: 'Get a BOM snapshot with cost_per_unit_usd computed column' })
  getBomSnapshot(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    return this.service.getBomSnapshot(id, user.id, token);
  }

  @Post('bom-snapshots')
  @ApiOperation({ summary: 'Create a BOM cost snapshot; cost_per_unit_usd is auto-computed by DB' })
  createBomSnapshot(
    @Body() dto: CreateBomSnapshotDto,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    return this.service.createBomSnapshot(dto, user.id, token);
  }

  @Delete('bom-snapshots/:id')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id', description: 'Snapshot UUID' })
  @ApiOperation({ summary: 'Delete a BOM cost snapshot' })
  deleteBomSnapshot(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    return this.service.deleteBomSnapshot(id, user.id, token);
  }

  // ── Assembly Cost Breakdown ───────────────────────────────────────────────────

  @Get('assembly-breakdown')
  @ApiOperation({ summary: 'List assembly cost breakdown rows; filter by bomSnapshotId' })
  listAssemblyBreakdown(
    @Query() query: QueryAssemblyBreakdownDto,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    return this.service.listAssemblyBreakdown(query, user.id, token);
  }

  @Post('assembly-breakdown')
  @ApiOperation({ summary: 'Add a part row to assembly breakdown; extended_total_usd is DB-computed' })
  createAssemblyBreakdown(
    @Body() dto: CreateAssemblyBreakdownDto,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    return this.service.createAssemblyBreakdown(dto, user.id, token);
  }

  @Delete('assembly-breakdown/:id')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id', description: 'Breakdown row UUID' })
  @ApiOperation({ summary: 'Delete an assembly breakdown row' })
  deleteAssemblyBreakdown(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    return this.service.deleteAssemblyBreakdown(id, user.id, token);
  }
}
