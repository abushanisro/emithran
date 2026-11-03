interface User { id: string; email: string; [key: string]: any; }
import { AuditService } from '../../common/audit/audit.service';
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
import { 
  CreateRfqTrackingDto, 
  UpdateTrackingStatusDto,
  RfqTrackingResponseDto,
  RfqTrackingStatsDto 
} from './dto/rfq-tracking.dto';
import { RfqTrackingService } from './services/rfq-tracking.service';
import { RequestAuthGuard } from '../../common/guards/request-auth.guard';
import { OrganizationContextGuard } from '../../common/guards/organization-context.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AccessToken } from '../../common/decorators/access-token.decorator';
import { CurrentOrganization } from '../../common/decorators/current-organization.decorator';
import { OrgRole } from '../../common/authz/authz-policy';

@ApiTags('RFQ tracking')
@ApiBearerAuth()
@UseGuards(RequestAuthGuard)
@OrgRole('member')
@Controller({ path: 'rfq-trackings', version: '1' })
export class RfqTrackingController {
  private readonly logger = new Logger(RfqTrackingController.name);

  constructor(
    private readonly rfqTrackingService: RfqTrackingService,
    private readonly audit: AuditService,
  ) {}


  // ============================================================================
  // RFQ TRACKING ENDPOINTS (Must be before parameterized routes)
  // ============================================================================

  @Post()
  @ApiOperation({ summary: 'Create RFQ tracking record' })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'RFQ tracking created successfully',
    type: RfqTrackingResponseDto
  })
  @UseGuards(OrganizationContextGuard)
  async createTracking(
    @CurrentUser() user: User,
    @AccessToken() token: string,
    @CurrentOrganization() organizationId: string,
    @Body() createTrackingDto: CreateRfqTrackingDto
  ): Promise<RfqTrackingResponseDto> {
    try {
      this.logger.log(`Creating RFQ tracking for user ${user.id}`);
      return await this.rfqTrackingService.createTracking(user.id, token, organizationId, createTrackingDto);
    } catch (error) {
      this.logger.error(`Failed to create RFQ tracking: ${error.message}`, error.stack);
      throw error;
    }
  }

  @OrgRole('viewer')
  @Get()
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

  @OrgRole('viewer')
  @Get('stats')
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

  @OrgRole('viewer')
  @Get(':id')
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

  @Patch(':id/status')
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


  @Delete(':id')
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
}
