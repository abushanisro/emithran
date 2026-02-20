import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
  Logger,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { SupabaseAuthGuard } from '@/common/guards/supabase-auth.guard';
import { RateLimitGuard } from '@/common/guards/rate-limit.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { createResponse, ApiResponse as CustomApiResponse } from '@/common/dto/api-response.dto';
import { QualityControlService } from './quality-control.service';
import { QualityInspectionService } from './services/quality-inspection.service';
import {
  CreateQualityInspectionDto,
  UpdateQualityInspectionDto,
  QualityInspectionResponseDto,
  InspectionResultDto,
} from './dto/quality-inspection.dto';

@ApiTags('Quality Control')
@ApiBearerAuth()
@Controller('api/quality-control')
@UseGuards(SupabaseAuthGuard, RateLimitGuard)
export class QualityControlController {
  private readonly logger = new Logger(QualityControlController.name);

  constructor(
    private readonly qualityControlService: QualityControlService,
    private readonly qualityInspectionService: QualityInspectionService,
  ) {}

  private getUserId(user: any): string {
    return user?.id || '';
  }

  // ============================================================================
  // QUALITY INSPECTIONS ENDPOINTS
  // ============================================================================

  @Post('inspections')
  @ApiOperation({ summary: 'Create new quality inspection' })
  @ApiResponse({ status: 201, description: 'Inspection created successfully' })
  async createInspection(
    @Body() createDto: CreateQualityInspectionDto,
    @CurrentUser() user: any,
  ): Promise<CustomApiResponse<QualityInspectionResponseDto>> {
    this.logger.log(`Creating quality inspection: ${createDto.name}`);
    const result = await this.qualityInspectionService.createInspection(
      createDto,
      this.getUserId(user),
    );
    return createResponse(result);
  }

  @Get('inspections')
  @ApiOperation({ summary: 'Get all quality inspections' })
  @ApiResponse({ status: 200, description: 'Inspections retrieved successfully' })
  async getInspections(
    @CurrentUser() user: any,
    @Query('projectId') projectId?: string,
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('inspector') inspector?: string,
  ): Promise<CustomApiResponse<QualityInspectionResponseDto[]>> {
    const result = await this.qualityInspectionService.getInspections(
      this.getUserId(user),
      { projectId, status, type, inspector }
    );
    return createResponse(result);
  }

  @Get('inspections/:id')
  @ApiOperation({ summary: 'Get quality inspection by ID' })
  @ApiResponse({ status: 200, description: 'Inspection retrieved successfully' })
  async getInspectionById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
  ): Promise<CustomApiResponse<QualityInspectionResponseDto>> {
    const result = await this.qualityInspectionService.getInspectionById(
      id,
      this.getUserId(user),
    );
    return createResponse(result);
  }

  @Put('inspections/:id')
  @ApiOperation({ summary: 'Update quality inspection' })
  @ApiResponse({ status: 200, description: 'Inspection updated successfully' })
  async updateInspection(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateDto: UpdateQualityInspectionDto,
    @CurrentUser() user: any,
  ): Promise<CustomApiResponse<QualityInspectionResponseDto>> {
    const result = await this.qualityInspectionService.updateInspection(
      id,
      updateDto,
      this.getUserId(user),
    );
    return createResponse(result);
  }

  @Delete('inspections/:id')
  @ApiOperation({ summary: 'Delete quality inspection' })
  @ApiResponse({ status: 200, description: 'Inspection deleted successfully' })
  async deleteInspection(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
  ): Promise<CustomApiResponse<void>> {
    await this.qualityInspectionService.deleteInspection(
      id,
      this.getUserId(user),
    );
    return createResponse(undefined);
  }

  // ============================================================================
  // INSPECTION RESULTS ENDPOINTS
  // ============================================================================

  @Post('inspections/:id/results')
  @ApiOperation({ summary: 'Submit inspection results' })
  @ApiResponse({ status: 201, description: 'Results submitted successfully' })
  async submitInspectionResults(
    @Param('id', ParseUUIDPipe) inspectionId: string,
    @Body() resultsDto: InspectionResultDto,
    @CurrentUser() user: any,
  ): Promise<CustomApiResponse<any>> {
    const result = await this.qualityInspectionService.submitInspectionResults(
      inspectionId,
      resultsDto,
      this.getUserId(user),
    );
    return createResponse(result);
  }

  @Get('inspections/:id/results')
  @ApiOperation({ summary: 'Get inspection results' })
  @ApiResponse({ status: 200, description: 'Results retrieved successfully' })
  async getInspectionResults(
    @Param('id', ParseUUIDPipe) inspectionId: string,
    @CurrentUser() user: any,
  ): Promise<CustomApiResponse<any>> {
    const result = await this.qualityInspectionService.getInspectionResults(
      inspectionId,
      this.getUserId(user),
    );
    return createResponse(result);
  }

  // ============================================================================
  // INSPECTION WORKFLOW ENDPOINTS
  // ============================================================================

  @Post('inspections/:id/start')
  @ApiOperation({ summary: 'Start inspection' })
  @ApiResponse({ status: 200, description: 'Inspection started successfully' })
  async startInspection(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
  ): Promise<CustomApiResponse<QualityInspectionResponseDto>> {
    const result = await this.qualityInspectionService.startInspection(
      id,
      this.getUserId(user),
    );
    return createResponse(result);
  }

  @Post('inspections/:id/complete')
  @ApiOperation({ summary: 'Complete inspection' })
  @ApiResponse({ status: 200, description: 'Inspection completed successfully' })
  async completeInspection(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() completionData: { notes?: string; finalResult: 'pass' | 'fail' | 'conditional' },
    @CurrentUser() user: any,
  ): Promise<CustomApiResponse<QualityInspectionResponseDto>> {
    const result = await this.qualityInspectionService.completeInspection(
      id,
      completionData,
      this.getUserId(user),
    );
    return createResponse(result);
  }

  @Post('inspections/:id/approve')
  @ApiOperation({ summary: 'Approve inspection' })
  @ApiResponse({ status: 200, description: 'Inspection approved successfully' })
  async approveInspection(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() approvalData: { approverNotes?: string },
    @CurrentUser() user: any,
  ): Promise<CustomApiResponse<QualityInspectionResponseDto>> {
    const result = await this.qualityInspectionService.approveInspection(
      id,
      approvalData,
      this.getUserId(user),
    );
    return createResponse(result);
  }

  @Post('inspections/:id/reject')
  @ApiOperation({ summary: 'Reject inspection' })
  @ApiResponse({ status: 200, description: 'Inspection rejected successfully' })
  async rejectInspection(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() rejectionData: { rejectionReason: string; correctiveAction?: string },
    @CurrentUser() user: any,
  ): Promise<CustomApiResponse<QualityInspectionResponseDto>> {
    const result = await this.qualityInspectionService.rejectInspection(
      id,
      rejectionData,
      this.getUserId(user),
    );
    return createResponse(result);
  }

  // ============================================================================
  // NON-CONFORMANCE ENDPOINTS
  // ============================================================================

  @Post('inspections/:id/non-conformances')
  @ApiOperation({ summary: 'Create non-conformance report' })
  @ApiResponse({ status: 201, description: 'Non-conformance created successfully' })
  async createNonConformance(
    @Param('id', ParseUUIDPipe) inspectionId: string,
    @Body() nonConformanceData: any,
    @CurrentUser() user: any,
  ): Promise<CustomApiResponse<any>> {
    const result = await this.qualityInspectionService.createNonConformance(
      inspectionId,
      nonConformanceData,
      this.getUserId(user),
    );
    return createResponse(result);
  }

  @Get('non-conformances')
  @ApiOperation({ summary: 'Get all non-conformances' })
  @ApiResponse({ status: 200, description: 'Non-conformances retrieved successfully' })
  async getNonConformances(
    @CurrentUser() user: any,
    @Query('projectId') projectId?: string,
    @Query('status') status?: string,
    @Query('severity') severity?: string,
  ): Promise<CustomApiResponse<any[]>> {
    const result = await this.qualityInspectionService.getNonConformances(
      this.getUserId(user),
      { projectId, status, severity }
    );
    return createResponse(result);
  }

  // ============================================================================
  // QUALITY METRICS & REPORTING ENDPOINTS
  // ============================================================================

  @Get('projects/:projectId/metrics')
  @ApiOperation({ summary: 'Get quality metrics for project' })
  @ApiResponse({ status: 200, description: 'Metrics retrieved successfully' })
  async getQualityMetrics(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: any,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ): Promise<CustomApiResponse<any>> {
    const result = await this.qualityControlService.getQualityMetrics(
      projectId,
      this.getUserId(user),
      { startDate, endDate }
    );
    return createResponse(result);
  }

  @Get('projects/:projectId/quality-report')
  @ApiOperation({ summary: 'Generate quality report' })
  @ApiResponse({ status: 200, description: 'Report generated successfully' })
  async generateQualityReport(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: any,
    @Query('reportType') reportType?: string,
  ): Promise<CustomApiResponse<any>> {
    const result = await this.qualityControlService.generateQualityReport(
      projectId,
      this.getUserId(user),
      reportType,
    );
    return createResponse(result);
  }

  // ============================================================================
  // DASHBOARD ENDPOINTS
  // ============================================================================

  @Get('projects/:projectId/dashboard')
  @ApiOperation({ summary: 'Get quality control dashboard data' })
  @ApiResponse({ status: 200, description: 'Dashboard data retrieved successfully' })
  async getQualityDashboard(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @CurrentUser() user: any,
  ): Promise<CustomApiResponse<any>> {
    const result = await this.qualityControlService.getQualityDashboard(
      projectId,
      this.getUserId(user),
    );
    return createResponse(result);
  }
}