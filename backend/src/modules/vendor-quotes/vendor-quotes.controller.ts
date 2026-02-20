interface User { id: string; email: string; [key: string]: any; }
import { Controller, Get, Post, Put, Delete, Body, Param, Query, ParseUUIDPipe, ValidationPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import { VendorQuotesService } from './vendor-quotes.service';
import { CreateVendorQuoteDto, UpdateVendorQuoteDto, VendorQuoteLineItemDto, VendorAssignmentDto } from './dto/vendor-quotes.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Vendor Quotes')
@ApiBearerAuth()
@Controller('v1/vendor-quotes')
export class VendorQuotesController {
  constructor(private readonly vendorQuotesService: VendorQuotesService) { }

  @Post()
  @ApiOperation({ summary: 'Create vendor quote' })
  @ApiResponse({ status: 201, description: 'Quote created successfully' })
  async createQuote(
    @Body(ValidationPipe) createQuoteDto: CreateVendorQuoteDto,
    @CurrentUser() user: User
  ) {
    return this.vendorQuotesService.createQuote(createQuoteDto, user.id);
  }

  @Get('/nomination/:nominationId')
  @ApiOperation({ summary: 'Get all quotes for a supplier nomination' })
  @ApiResponse({ status: 200, description: 'Quotes retrieved successfully' })
  async getQuotesByNomination(
    @Param('nominationId', ParseUUIDPipe) nominationId: string,
    @CurrentUser() user: User,
    @Query('status') status?: string
  ) {
    return this.vendorQuotesService.getQuotesByNomination(nominationId, user.id, status);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get quote by ID with line items' })
  @ApiResponse({ status: 200, description: 'Quote retrieved successfully' })
  async getQuoteById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User
  ) {
    return this.vendorQuotesService.getQuoteById(id, user.id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update vendor quote' })
  @ApiResponse({ status: 200, description: 'Quote updated successfully' })
  async updateQuote(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(ValidationPipe) updateQuoteDto: UpdateVendorQuoteDto,
    @CurrentUser() user: User
  ) {
    return this.vendorQuotesService.updateQuote(id, updateQuoteDto, user.id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete vendor quote' })
  @ApiResponse({ status: 200, description: 'Quote deleted successfully' })
  async deleteQuote(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User
  ) {
    return this.vendorQuotesService.deleteQuote(id, user.id);
  }

  @Post(':id/line-items')
  @ApiOperation({ summary: 'Add line item to quote' })
  @ApiResponse({ status: 201, description: 'Line item added successfully' })
  async addLineItem(
    @Param('id', ParseUUIDPipe) quoteId: string,
    @Body(ValidationPipe) lineItemDto: VendorQuoteLineItemDto,
    @CurrentUser() user: User
  ) {
    return this.vendorQuotesService.addLineItem(quoteId, lineItemDto, user.id);
  }

  @Put(':id/line-items/:lineItemId')
  @ApiOperation({ summary: 'Update quote line item' })
  @ApiResponse({ status: 200, description: 'Line item updated successfully' })
  async updateLineItem(
    @Param('id', ParseUUIDPipe) quoteId: string,
    @Param('lineItemId', ParseUUIDPipe) lineItemId: string,
    @Body(ValidationPipe) lineItemDto: VendorQuoteLineItemDto,
    @CurrentUser() user: User
  ) {
    return this.vendorQuotesService.updateLineItem(quoteId, lineItemId, lineItemDto, user.id);
  }

  @Delete(':id/line-items/:lineItemId')
  @ApiOperation({ summary: 'Delete quote line item' })
  @ApiResponse({ status: 200, description: 'Line item deleted successfully' })
  async deleteLineItem(
    @Param('id', ParseUUIDPipe) quoteId: string,
    @Param('lineItemId', ParseUUIDPipe) lineItemId: string,
    @CurrentUser() user: User
  ) {
    return this.vendorQuotesService.deleteLineItem(quoteId, lineItemId, user.id);
  }

  @Post(':id/submit')
  @ApiOperation({ summary: 'Submit quote for review' })
  @ApiResponse({ status: 200, description: 'Quote submitted successfully' })
  async submitQuote(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User
  ) {
    return this.vendorQuotesService.submitQuote(id, user.id);
  }

  @Post(':id/approve')
  @ApiOperation({ summary: 'Approve submitted quote' })
  @ApiResponse({ status: 200, description: 'Quote approved successfully' })
  async approveQuote(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() reviewData: { reviewNotes?: string },
    @CurrentUser() user: User
  ) {
    return this.vendorQuotesService.approveQuote(id, user.id, reviewData.reviewNotes);
  }

  @Post(':id/reject')
  @ApiOperation({ summary: 'Reject submitted quote' })
  @ApiResponse({ status: 200, description: 'Quote rejected successfully' })
  async rejectQuote(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() reviewData: { reviewNotes: string },
    @CurrentUser() user: User
  ) {
    return this.vendorQuotesService.rejectQuote(id, user.id, reviewData.reviewNotes);
  }

  @Get('/comparison/:nominationId/:bomItemId')
  @ApiOperation({ summary: 'Compare vendor quotes for a specific BOM item' })
  @ApiResponse({ status: 200, description: 'Quote comparison retrieved successfully' })
  async compareQuotes(
    @Param('nominationId', ParseUUIDPipe) nominationId: string,
    @Param('bomItemId', ParseUUIDPipe) bomItemId: string,
    @CurrentUser() user: User
  ) {
    return this.vendorQuotesService.compareQuotesForBomItem(nominationId, bomItemId, user.id);
  }

  @Post('/assign-vendor')
  @ApiOperation({ summary: 'Assign vendor to BOM part with quote selection' })
  @ApiResponse({ status: 201, description: 'Vendor assigned successfully' })
  async assignVendorToBomPart(
    @Body(ValidationPipe) assignmentDto: VendorAssignmentDto,
    @CurrentUser() user: User
  ) {
    return this.vendorQuotesService.assignVendorToBomPart(assignmentDto, user.id);
  }

  @Get('/assignments/nomination/:nominationId')
  @ApiOperation({ summary: 'Get all vendor assignments for a nomination' })
  @ApiResponse({ status: 200, description: 'Vendor assignments retrieved successfully' })
  async getVendorAssignments(
    @Param('nominationId', ParseUUIDPipe) nominationId: string,
    @CurrentUser() user: User
  ) {
    return this.vendorQuotesService.getVendorAssignments(nominationId, user.id);
  }

  @Put('/assignments/:assignmentId')
  @ApiOperation({ summary: 'Update vendor assignment' })
  @ApiResponse({ status: 200, description: 'Assignment updated successfully' })
  async updateVendorAssignment(
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @Body(ValidationPipe) updateData: Partial<VendorAssignmentDto>,
    @CurrentUser() user: User
  ) {
    return this.vendorQuotesService.updateVendorAssignment(assignmentId, updateData, user.id);
  }

  @Post('/calculate-competitiveness/:nominationId/:bomItemId')
  @ApiOperation({ summary: 'Calculate vendor competitiveness scores for BOM item' })
  @ApiResponse({ status: 200, description: 'Competitiveness scores calculated successfully' })
  async calculateCompetitivenessScores(
    @Param('nominationId', ParseUUIDPipe) nominationId: string,
    @Param('bomItemId', ParseUUIDPipe) bomItemId: string,
    @CurrentUser() user: User
  ) {
    return this.vendorQuotesService.calculateCompetitivenessScores(nominationId, bomItemId, user.id);
  }

  @Get('/dashboard/nomination/:nominationId')
  @ApiOperation({ summary: 'Get vendor quotes dashboard data' })
  @ApiResponse({ status: 200, description: 'Dashboard data retrieved successfully' })
  @ApiQuery({ name: 'includeUnquoted', required: false, type: Boolean })
  async getQuotesDashboard(
    @Param('nominationId', ParseUUIDPipe) nominationId: string,
    @Query('includeUnquoted') includeUnquoted: boolean = false,
    @CurrentUser() user: User
  ) {
    return this.vendorQuotesService.getQuotesDashboard(nominationId, user.id, includeUnquoted);
  }
}