interface User { id: string; email: string; [key: string]: any; }
import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { ProcessTrackingService } from '../services/process-tracking.service';
import {
  CreateTimelineDto,
  UpdateTimelineDto,
  CreateProcessTrackingDto,
  UpdateProcessTrackingDto,
  CreateSubtaskTrackingDto,
  UpdateSubtaskTrackingDto,
  CreateBomTrackingDto,
  UpdateBomTrackingDto,
  QueryTrackingDto,
} from '../dto/process-tracking.dto';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { AccessToken } from '../../../common/decorators/access-token.decorator';

@ApiTags('Process Tracking')
@ApiBearerAuth()
@Controller({ path: 'api/production-planning/tracking', version: '1' })
export class ProcessTrackingController {
  constructor(private readonly processTrackingService: ProcessTrackingService) {}

  // =====================================================
  // TIMELINE MANAGEMENT
  // =====================================================

  @Post('timelines')
  @ApiOperation({ summary: 'Create timeline for production lot' })
  @ApiResponse({ status: 201, description: 'Timeline created successfully' })
  async createTimeline(
    @Body() createDto: CreateTimelineDto,
    @CurrentUser('id') userId: string,
    @AccessToken() token: string,
  ) {
    return this.processTrackingService.createTimeline(createDto, userId, token);
  }

  @Get('timelines/:lotId')
  @ApiOperation({ summary: 'Get timeline for production lot' })
  @ApiResponse({ status: 200, description: 'Timeline retrieved successfully' })
  async getTimelineByLot(
    @Param('lotId') lotId: string,
    @AccessToken() token: string,
  ) {
    return this.processTrackingService.getTimelineByLot(lotId, token);
  }

  @Put('timelines/:timelineId')
  @ApiOperation({ summary: 'Update timeline configuration' })
  @ApiResponse({ status: 200, description: 'Timeline updated successfully' })
  async updateTimeline(
    @Param('timelineId') timelineId: string,
    @Body() updateDto: UpdateTimelineDto,
    @CurrentUser('id') userId: string,
    @AccessToken() token: string,
  ) {
    return this.processTrackingService.updateTimeline(timelineId, updateDto, userId, token);
  }

  // =====================================================
  // PROCESS TRACKING
  // =====================================================

  @Post('processes')
  @ApiOperation({ summary: 'Create process tracking entry' })
  @ApiResponse({ status: 201, description: 'Process tracking created successfully' })
  async createProcessTracking(
    @Body() createDto: CreateProcessTrackingDto,
    @CurrentUser('id') userId: string,
    @AccessToken() token: string,
  ) {
    return this.processTrackingService.createProcessTracking(createDto, userId, token);
  }

  @Get('processes/:timelineId')
  @ApiOperation({ summary: 'Get all process tracking for timeline' })
  @ApiResponse({ status: 200, description: 'Process tracking retrieved successfully' })
  async getProcessTracking(
    @Param('timelineId') timelineId: string,
    @Query() query: QueryTrackingDto,
    @AccessToken() token: string,
  ) {
    return this.processTrackingService.getProcessTracking(timelineId, query, token);
  }

  @Put('processes/:trackingId')
  @ApiOperation({ summary: 'Update process tracking' })
  @ApiResponse({ status: 200, description: 'Process tracking updated successfully' })
  async updateProcessTracking(
    @Param('trackingId') trackingId: string,
    @Body() updateDto: UpdateProcessTrackingDto,
    @CurrentUser('id') userId: string,
    @AccessToken() token: string,
  ) {
    return this.processTrackingService.updateProcessTracking(trackingId, updateDto, userId, token);
  }

  // =====================================================
  // SUBTASK TRACKING
  // =====================================================

  @Post('subtasks')
  @ApiOperation({ summary: 'Create subtask tracking entry' })
  @ApiResponse({ status: 201, description: 'Subtask tracking created successfully' })
  async createSubtaskTracking(
    @Body() createDto: CreateSubtaskTrackingDto,
    @CurrentUser('id') userId: string,
    @AccessToken() token: string,
  ) {
    return this.processTrackingService.createSubtaskTracking(createDto, userId, token);
  }

  @Get('subtasks/:processTrackingId')
  @ApiOperation({ summary: 'Get subtask tracking for process' })
  @ApiResponse({ status: 200, description: 'Subtask tracking retrieved successfully' })
  async getSubtaskTracking(
    @Param('processTrackingId') processTrackingId: string,
    @AccessToken() token: string,
  ) {
    return this.processTrackingService.getSubtaskTracking(processTrackingId, token);
  }

  @Put('subtasks/:trackingId')
  @ApiOperation({ summary: 'Update subtask tracking' })
  @ApiResponse({ status: 200, description: 'Subtask tracking updated successfully' })
  async updateSubtaskTracking(
    @Param('trackingId') trackingId: string,
    @Body() updateDto: UpdateSubtaskTrackingDto,
    @CurrentUser('id') userId: string,
    @AccessToken() token: string,
  ) {
    return this.processTrackingService.updateSubtaskTracking(trackingId, updateDto, userId, token);
  }

  // =====================================================
  // BOM ITEM TRACKING
  // =====================================================

  @Post('bom-items')
  @ApiOperation({ summary: 'Create BOM item tracking entry' })
  @ApiResponse({ status: 201, description: 'BOM item tracking created successfully' })
  async createBomTracking(
    @Body() createDto: CreateBomTrackingDto,
    @CurrentUser('id') userId: string,
    @AccessToken() token: string,
  ) {
    return this.processTrackingService.createBomTracking(createDto, userId, token);
  }

  @Get('bom-items/:subtaskTrackingId')
  @ApiOperation({ summary: 'Get BOM item tracking for subtask' })
  @ApiResponse({ status: 200, description: 'BOM item tracking retrieved successfully' })
  async getBomTracking(
    @Param('subtaskTrackingId') subtaskTrackingId: string,
    @AccessToken() token: string,
  ) {
    return this.processTrackingService.getBomTracking(subtaskTrackingId, token);
  }

  @Put('bom-items/:trackingId')
  @ApiOperation({ summary: 'Update BOM item tracking' })
  @ApiResponse({ status: 200, description: 'BOM item tracking updated successfully' })
  async updateBomTracking(
    @Param('trackingId') trackingId: string,
    @Body() updateDto: UpdateBomTrackingDto,
    @CurrentUser('id') userId: string,
    @AccessToken() token: string,
  ) {
    return this.processTrackingService.updateBomTracking(trackingId, updateDto, userId, token);
  }

  // =====================================================
  // BULK OPERATIONS
  // =====================================================

  @Post('bulk/timeline-setup')
  @ApiOperation({ summary: 'Setup complete timeline with all tracking data' })
  @ApiResponse({ status: 201, description: 'Complete timeline setup created successfully' })
  async setupCompleteTimeline(
    @Body() setupData: any, // Complex nested data structure
    @CurrentUser('id') userId: string,
    @AccessToken() token: string,
  ) {
    return this.processTrackingService.setupCompleteTimeline(setupData, userId, token);
  }

  @Put('bulk/progress-update')
  @ApiOperation({ summary: 'Bulk update progress for multiple items' })
  @ApiResponse({ status: 200, description: 'Bulk progress update completed successfully' })
  async bulkUpdateProgress(
    @Body() progressData: any[],
    @CurrentUser('id') userId: string,
    @AccessToken() token: string,
  ) {
    return this.processTrackingService.bulkUpdateProgress(progressData, userId, token);
  }

  // =====================================================
  // GANTT CHART DATA
  // =====================================================

  @Get('gantt-data/:lotId')
  @ApiOperation({ summary: 'Get complete Gantt chart data for production lot' })
  @ApiResponse({ status: 200, description: 'Gantt chart data retrieved successfully' })
  async getGanttData(
    @Param('lotId') lotId: string,
    @Query('includeHistory') includeHistory: boolean = false,
    @AccessToken() token: string,
  ) {
    return this.processTrackingService.getCompleteGanttData(lotId, includeHistory, token);
  }

  // =====================================================
  // TRACKING HISTORY & AUDIT
  // =====================================================

  @Get('history/:timelineId')
  @ApiOperation({ summary: 'Get tracking update history' })
  @ApiResponse({ status: 200, description: 'Tracking history retrieved successfully' })
  async getTrackingHistory(
    @Param('timelineId') timelineId: string,
    @Query() query: QueryTrackingDto,
    @AccessToken() token: string,
  ) {
    return this.processTrackingService.getTrackingHistory(timelineId, query, token);
  }

  // =====================================================
  // UTILITY ENDPOINTS
  // =====================================================

  @Post('calculate-timeline')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Calculate optimal timeline based on dependencies' })
  @ApiResponse({ status: 200, description: 'Timeline calculation completed successfully' })
  async calculateTimeline(
    @Body() calculationData: { lotId: string; constraints: any },
    @AccessToken() token: string,
  ) {
    return this.processTrackingService.calculateOptimalTimeline(calculationData, token);
  }

  @Delete(':timelineId')
  @ApiOperation({ summary: 'Delete complete timeline and all tracking data' })
  @ApiResponse({ status: 200, description: 'Timeline deleted successfully' })
  async deleteTimeline(
    @Param('timelineId') timelineId: string,
    @CurrentUser('id') userId: string,
    @AccessToken() token: string,
  ) {
    return this.processTrackingService.deleteTimeline(timelineId, userId, token);
  }
}