interface User { id: string; email: string; [key: string]: any; }
import { 
  Controller, 
  Get, 
  Post, 
  Body, 
  Param, 
  Query,
  Patch,
  Delete,
  UseGuards,
  HttpStatus,
  BadRequestException,
  Logger
} from '@nestjs/common';
import { 
  ApiTags, 
  ApiOperation, 
  ApiResponse, 
  ApiParam, 
  ApiQuery,
  ApiBearerAuth 
} from '@nestjs/swagger';
import { RfqService } from './rfq.service';
import { CreateRfqDto } from './dto/create-rfq.dto';
import { RfqRecord, RfqSummary } from './dto/rfq-response.dto';
import { 
  CreateRfqTrackingDto, 
  UpdateVendorResponseDto, 
  UpdateTrackingStatusDto,
  RfqTrackingResponseDto,
  RfqTrackingStatsDto 
} from './dto/rfq-tracking.dto';
import { RfqTrackingService } from './services/rfq-tracking.service';
import { SupabaseAuthGuard } from '../../common/guards/supabase-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AccessToken } from '../../common/decorators/access-token.decorator';

@ApiTags('RFQ (Request for Quotation)')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard)
@Controller('api/rfq')
export class RfqController {
  private readonly logger = new Logger(RfqController.name);

  constructor(
    private readonly rfqService: RfqService,
    private readonly rfqTrackingService: RfqTrackingService
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a new RFQ' })
  @ApiResponse({ 
    status: HttpStatus.CREATED, 
    description: 'RFQ created successfully',
    type: RfqRecord
  })
  async create(
    @CurrentUser() user: User,
    @Body() createRfqDto: CreateRfqDto
  ): Promise<RfqRecord> {
    try {
      this.logger.log(`Creating RFQ '${createRfqDto.rfqName}' for user ${user.id}`);
      return await this.rfqService.create(user.id, createRfqDto);
    } catch (error) {
      this.logger.error(`Failed to create RFQ: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Get()
  @ApiOperation({ summary: 'Get all RFQs for the current user' })
  @ApiQuery({ 
    name: 'projectId', 
    required: false, 
    description: 'Filter by project ID' 
  })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'RFQs retrieved successfully',
    type: [RfqSummary]
  })
  async findAll(
    @CurrentUser() user: User,
    @Query('projectId') projectId?: string
  ): Promise<RfqSummary[]> {
    try {
      this.logger.log(`Fetching RFQs for user ${user.id}${projectId ? ` in project ${projectId}` : ''}`);
      return await this.rfqService.findByUser(user.id, projectId);
    } catch (error) {
      this.logger.error(`Failed to fetch RFQs: ${error.message}`, error.stack);
      throw error;
    }
  }

  // ============================================================================
  // RFQ TRACKING ENDPOINTS (Must be before parameterized routes)
  // ============================================================================

  @Post('tracking')
  @ApiOperation({ summary: 'Create RFQ tracking record' })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'RFQ tracking created successfully',
    type: RfqTrackingResponseDto
  })
  async createTracking(
    @CurrentUser() user: User,
    @AccessToken() token: string,
    @Body() createTrackingDto: CreateRfqTrackingDto
  ): Promise<RfqTrackingResponseDto> {
    try {
      this.logger.log(`Creating RFQ tracking for user ${user.id}`);
      return await this.rfqTrackingService.createTracking(user.id, token, createTrackingDto);
    } catch (error) {
      this.logger.error(`Failed to create RFQ tracking: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Get('tracking')
  @ApiOperation({ summary: 'Get all RFQ tracking records for user in project' })
  @ApiQuery({
    name: 'projectId',
    required: true,
    description: 'Project ID (required for data isolation)'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'RFQ tracking records retrieved successfully',
    type: [RfqTrackingResponseDto]
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Project ID is required'
  })
  async getTracking(
    @CurrentUser() user: User,
    @AccessToken() token: string,
    @Query('projectId') projectId: string
  ): Promise<RfqTrackingResponseDto[]> {
    if (!projectId) {
      throw new BadRequestException('Project ID is required for data isolation');
    }
    
    try {
      this.logger.log(`Fetching RFQ tracking records for user ${user.id} in project ${projectId}`);
      return await this.rfqTrackingService.getTrackingByUser(user.id, token, projectId);
    } catch (error) {
      this.logger.error(`Failed to fetch RFQ tracking records: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Get('tracking/stats')
  @ApiOperation({ summary: 'Get RFQ tracking statistics for project' })
  @ApiQuery({
    name: 'projectId',
    required: true,
    description: 'Project ID (required for data isolation)'
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'RFQ tracking statistics retrieved successfully',
    type: RfqTrackingStatsDto
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Project ID is required'
  })
  async getTrackingStats(
    @CurrentUser() user: User,
    @AccessToken() token: string,
    @Query('projectId') projectId: string
  ): Promise<RfqTrackingStatsDto> {
    if (!projectId) {
      throw new BadRequestException('Project ID is required for data isolation');
    }
    
    try {
      this.logger.log(`Fetching RFQ tracking stats for user ${user.id} in project ${projectId}`);
      return await this.rfqTrackingService.getTrackingStats(user.id, token, projectId);
    } catch (error) {
      this.logger.error(`Failed to fetch RFQ tracking stats: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Get('tracking/:id')
  @ApiOperation({ summary: 'Get RFQ tracking record by ID' })
  @ApiParam({ name: 'id', description: 'RFQ tracking ID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'RFQ tracking record retrieved successfully',
    type: RfqTrackingResponseDto
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'RFQ tracking not found' })
  async getTrackingById(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @AccessToken() token: string
  ): Promise<RfqTrackingResponseDto> {
    try {
      this.logger.log(`Fetching RFQ tracking ${id} for user ${user.id}`);
      return await this.rfqTrackingService.getTrackingById(id, user.id, token);
    } catch (error) {
      this.logger.error(`Failed to fetch RFQ tracking ${id}: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Patch('tracking/:id/status')
  @ApiOperation({ summary: 'Update RFQ tracking status' })
  @ApiParam({ name: 'id', description: 'RFQ tracking ID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'RFQ tracking status updated successfully'
  })
  async updateTrackingStatus(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @AccessToken() token: string,
    @Body() updateStatusDto: UpdateTrackingStatusDto
  ): Promise<{ message: string }> {
    try {
      this.logger.log(`Updating RFQ tracking status ${id} to ${updateStatusDto.status}`);
      await this.rfqTrackingService.updateTrackingStatus(id, user.id, token, updateStatusDto.status);
      return { message: 'RFQ tracking status updated successfully' };
    } catch (error) {
      this.logger.error(`Failed to update RFQ tracking status ${id}: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Patch('tracking/:trackingId/vendors/:vendorId/response')
  @ApiOperation({ summary: 'Update vendor response information' })
  @ApiParam({ name: 'trackingId', description: 'RFQ tracking ID' })
  @ApiParam({ name: 'vendorId', description: 'Vendor ID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Vendor response updated successfully'
  })
  async updateVendorResponse(
    @Param('trackingId') trackingId: string,
    @Param('vendorId') vendorId: string,
    @CurrentUser() user: User,
    @AccessToken() token: string,
    @Body() updateResponseDto: UpdateVendorResponseDto
  ): Promise<{ message: string }> {
    try {
      this.logger.log(`Updating vendor response for tracking ${trackingId}, vendor ${vendorId}`);
      await this.rfqTrackingService.updateVendorResponse(
        trackingId,
        vendorId,
        user.id,
        token,
        updateResponseDto
      );
      return { message: 'Vendor response updated successfully' };
    } catch (error) {
      this.logger.error(`Failed to update vendor response: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Delete('tracking/:id')
  @ApiOperation({ summary: 'Delete RFQ tracking record (cancel RFQ)' })
  @ApiParam({ name: 'id', description: 'RFQ tracking ID' })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'RFQ tracking record deleted successfully'
  })
  async deleteTracking(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @AccessToken() token: string
  ): Promise<{ message: string }> {
    try {
      this.logger.log(`Deleting RFQ tracking ${id}`);
      await this.rfqTrackingService.deleteTracking(id, user.id, token);
      return { message: 'RFQ tracking record deleted successfully' };
    } catch (error) {
      this.logger.error(`Failed to delete RFQ tracking ${id}: ${error.message}`, error.stack);
      throw error;
    }
  }

  // ============================================================================
  // STANDARD RFQ ENDPOINTS
  // ============================================================================

  @Get(':id')
  @ApiOperation({ summary: 'Get RFQ details by ID' })
  @ApiParam({ name: 'id', description: 'RFQ ID' })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'RFQ details retrieved successfully',
    type: RfqRecord
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'RFQ not found' })
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: User
  ): Promise<RfqRecord> {
    try {
      this.logger.log(`Fetching RFQ ${id} for user ${user.id}`);
      return await this.rfqService.findOne(id, user.id);
    } catch (error) {
      this.logger.error(`Failed to fetch RFQ ${id}: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Patch(':id/send')
  @ApiOperation({ summary: 'Send RFQ to vendors' })
  @ApiParam({ name: 'id', description: 'RFQ ID' })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'RFQ sent successfully' 
  })
  @ApiResponse({ 
    status: HttpStatus.BAD_REQUEST, 
    description: 'RFQ already sent or invalid status' 
  })
  async sendRfq(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @AccessToken() token: string
  ): Promise<{ message: string }> {
    try {
      this.logger.log(`Sending RFQ ${id} to vendors`);
      await this.rfqService.sendRfq(id, user.id, token);
      return { message: 'RFQ sent successfully to vendors' };
    } catch (error) {
      this.logger.error(`Failed to send RFQ ${id}: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Patch(':id/close')
  @ApiOperation({ summary: 'Close RFQ (no more responses accepted)' })
  @ApiParam({ name: 'id', description: 'RFQ ID' })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'RFQ closed successfully' 
  })
  async closeRfq(
    @Param('id') id: string,
    @CurrentUser() user: User
  ): Promise<{ message: string }> {
    try {
      this.logger.log(`Closing RFQ ${id}`);
      await this.rfqService.closeRfq(id, user.id);
      return { message: 'RFQ closed successfully' };
    } catch (error) {
      this.logger.error(`Failed to close RFQ ${id}: ${error.message}`, error.stack);
      throw error;
    }
  }
}