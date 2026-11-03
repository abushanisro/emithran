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
  UseGuards,
  ParseUUIDPipe,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { RequestAuthGuard } from '@/common/guards/request-auth.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { CurrentOrganization } from '@/common/decorators/current-organization.decorator';
import { OrganizationContextGuard } from '@/common/guards/organization-context.guard';
import { createResponse, ApiResponse as CustomApiResponse } from '@/common/dto/api-response.dto';
import { QualityControlService } from './quality-control.service';
import { QualityInspectionService } from './services/quality-inspection.service';
import {
  CreateQualityInspectionDto,
  UpdateQualityInspectionDto,
  QualityInspectionResponseDto,
} from './dto/quality-inspection.dto';
import {
  CreateDetailedInspectionReportDto,
  DetailedInspectionReportResponseDto,
} from './dto/detailed-inspection-report.dto';
import { OrgRole } from '../../common/authz/authz-policy';

@ApiTags('Quality Control')
@ApiBearerAuth()
@OrgRole('member')
@Controller('api/quality-control')
@UseGuards(RequestAuthGuard)
export class QualityControlController {
  private readonly logger = new Logger(QualityControlController.name);

  constructor(
    private readonly qualityControlService: QualityControlService,
    private readonly qualityInspectionService: QualityInspectionService,
  ) {}

  // RequestAuthGuard puts the user on every request; a request without one is refused, never served as an anonymous user.
  private getUserId(user: User | undefined): string {
    if (!user?.id) throw new UnauthorizedException('Authentication required');
    return user.id;
  }

  private getUserEmail(user: User | undefined): string {
    return user?.email || this.getUserId(user);
  }

  // ============================================================================
  // QUALITY INSPECTIONS ENDPOINTS
  // ============================================================================

  // A new inspection belongs to the request's organization; every other write acts on an existing row, whose organization
  // row-level security (migration 936) already fixes.
  @Post('inspections')
  @UseGuards(OrganizationContextGuard)
  @ApiOperation({ summary: 'Create new quality inspection' })
  @ApiResponse({ status: 201, description: 'Inspection created successfully' })
  async createInspection(
    @Body() createDto: CreateQualityInspectionDto,
    @CurrentUser() user: User,
    @CurrentOrganization() organizationId: string,
  ): Promise<CustomApiResponse<QualityInspectionResponseDto>> {
    try {
      this.logger.log(`Creating quality inspection for project ${createDto.projectId}`);
      const result = await this.qualityInspectionService.createInspection(
        createDto,
        this.getUserId(user),
        organizationId,
      );
      return createResponse(result);
    } catch (error) {
      this.logger.error(`Failed to create quality inspection: ${error.message}`, error.stack);
      throw error;
    }
  }

  @OrgRole('viewer')
  @Get('inspections')
  @ApiOperation({ summary: 'Get all quality inspections' })
  @ApiResponse({ status: 200, description: 'Inspections retrieved successfully' })
  async getInspections(
    @CurrentUser() user: User,
    @Query('projectId') projectId?: string,
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('inspector') inspector?: string,
  ): Promise<CustomApiResponse<QualityInspectionResponseDto[]>> {
    try {
      this.logger.log(`Fetching quality inspections for user ${this.getUserId(user)}`);
      const result = await this.qualityInspectionService.getInspections(
        this.getUserId(user),
        { projectId, status, type, inspector }
      );
      return createResponse(result);
    } catch (error) {
      this.logger.error(`Failed to fetch quality inspections: ${error.message}`, error.stack);
      throw error;
    }
  }

  @OrgRole('viewer')
  @Get('inspections/:id')
  @ApiOperation({ summary: 'Get quality inspection by ID' })
  @ApiResponse({ status: 200, description: 'Inspection retrieved successfully' })
  async getInspectionById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ): Promise<CustomApiResponse<QualityInspectionResponseDto>> {
    try {
      this.logger.log(`Fetching quality inspection ${id}`);
      const result = await this.qualityInspectionService.getInspectionById(
        id,
        this.getUserId(user),
      );
      return createResponse(result);
    } catch (error) {
      this.logger.error(`Failed to fetch quality inspection ${id}: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Put('inspections/:id')
  @ApiOperation({ summary: 'Update quality inspection' })
  @ApiResponse({ status: 200, description: 'Inspection updated successfully' })
  async updateInspection(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateDto: UpdateQualityInspectionDto,
    @CurrentUser() user: User,
  ): Promise<CustomApiResponse<QualityInspectionResponseDto>> {
    try {
      this.logger.log(`Updating quality inspection ${id}`);
      const result = await this.qualityInspectionService.updateInspection(
        id,
        updateDto,
        this.getUserId(user),
      );
      return createResponse(result);
    } catch (error) {
      this.logger.error(`Failed to update quality inspection ${id}: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Delete('inspections/:id')
  @ApiOperation({ summary: 'Delete quality inspection' })
  @ApiResponse({ status: 200, description: 'Inspection deleted successfully' })
  async deleteInspection(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ): Promise<CustomApiResponse<void>> {
    try {
      this.logger.log(`Deleting quality inspection ${id}`);
      await this.qualityInspectionService.deleteInspection(
        id,
        this.getUserId(user),
      );
      return createResponse(undefined);
    } catch (error) {
      this.logger.error(`Failed to delete quality inspection ${id}: ${error.message}`, error.stack);
      throw error;
    }
  }

  // ============================================================================
  // INSPECTION RESULTS ENDPOINTS
  // ============================================================================



  // ============================================================================
  // INSPECTION WORKFLOW ENDPOINTS
  // ============================================================================



  @Post('inspections/:id/approve')
  @ApiOperation({ summary: 'Approve inspection' })
  @ApiResponse({ status: 200, description: 'Inspection approved successfully' })
  async approveInspection(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() approvalData: { approverNotes?: string },
    @CurrentUser() user: User,
  ): Promise<CustomApiResponse<QualityInspectionResponseDto>> {
    const result = await this.qualityInspectionService.approveInspection(
      id,
      approvalData,
      this.getUserId(user),
      this.getUserEmail(user),
    );
    return createResponse(result);
  }

  @Post('inspections/:id/reject')
  @ApiOperation({ summary: 'Reject inspection' })
  @ApiResponse({ status: 200, description: 'Inspection rejected successfully' })
  async rejectInspection(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() rejectionData: { rejectionReason: string; correctiveAction?: string },
    @CurrentUser() user: User,
  ): Promise<CustomApiResponse<QualityInspectionResponseDto>> {
    const result = await this.qualityInspectionService.rejectInspection(
      id,
      rejectionData,
      this.getUserId(user),
      this.getUserEmail(user),
    );
    return createResponse(result);
  }

  @Post('inspections/:id/reset')
  @ApiOperation({ summary: 'Reset inspection status (undo approve/reject)' })
  @ApiResponse({ status: 200, description: 'Inspection status reset successfully' })
  async resetInspectionStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ): Promise<CustomApiResponse<QualityInspectionResponseDto>> {
    const result = await this.qualityInspectionService.resetInspectionStatus(
      id,
      this.getUserId(user),
    );
    return createResponse(result);
  }

  // ============================================================================
  // NON-CONFORMANCE ENDPOINTS
  // ============================================================================



  // ============================================================================
  // QUALITY METRICS & REPORTING ENDPOINTS
  // ============================================================================



  // ============================================================================
  // DASHBOARD ENDPOINTS
  // ============================================================================


  // ============================================================================
  // DETAILED INSPECTION REPORTS ENDPOINTS
  // ============================================================================

  @Post('inspections/:id/detailed-report')
  @ApiOperation({ summary: 'Save or update detailed inspection report' })
  @ApiResponse({ status: 200, description: 'Report saved successfully', type: DetailedInspectionReportResponseDto })
  async saveDetailedInspectionReport(
    @Param('id', ParseUUIDPipe) inspectionId: string,
    @Body() reportDto: CreateDetailedInspectionReportDto,
    @CurrentUser() user: User,
  ): Promise<CustomApiResponse<DetailedInspectionReportResponseDto>> {
    try {
      this.logger.log(`Saving detailed inspection report for inspection ${inspectionId}`);
      const result = await this.qualityInspectionService.saveDetailedInspectionReport(
        inspectionId,
        reportDto,
        this.getUserId(user),
      );
      return createResponse(result);
    } catch (error) {
      this.logger.error(`Failed to save detailed inspection report for ${inspectionId}: ${error.message}`, error.stack);
      throw error;
    }
  }

  @OrgRole('viewer')
  @Get('inspections/:id/detailed-report')
  @ApiOperation({ summary: 'Get detailed inspection report' })
  @ApiResponse({ status: 200, description: 'Report retrieved successfully', type: DetailedInspectionReportResponseDto })
  @ApiResponse({ status: 404, description: 'No detailed report created yet for this inspection' })
  async getDetailedInspectionReport(
    @Param('id', ParseUUIDPipe) inspectionId: string,
    @CurrentUser() user: User,
  ): Promise<CustomApiResponse<DetailedInspectionReportResponseDto> | null> {
    try {
      const result = await this.qualityInspectionService.getDetailedInspectionReport(
        inspectionId,
        this.getUserId(user),
      );
      if (result === null) {
        throw new NotFoundException('Detailed inspection report not found');
      }
      return createResponse(result);
    } catch (error) {
      if (!(error instanceof NotFoundException)) {
        this.logger.error(`Failed to fetch detailed inspection report for ${inspectionId}: ${error.message}`, error.stack);
      }
      throw error;
    }
  }

  @Delete('inspections/:id/detailed-report')
  @ApiOperation({ summary: 'Delete detailed inspection report' })
  @ApiResponse({ status: 200, description: 'Report deleted successfully' })
  async deleteDetailedInspectionReport(
    @Param('id', ParseUUIDPipe) inspectionId: string,
    @CurrentUser() user: User,
  ): Promise<CustomApiResponse<{ deleted: boolean }>> {
    try {
      this.logger.log(`Deleting detailed inspection report for inspection ${inspectionId}`);
      const result = await this.qualityInspectionService.deleteDetailedInspectionReport(
        inspectionId,
        this.getUserId(user),
      );
      return createResponse(result);
    } catch (error) {
      this.logger.error(`Failed to delete detailed inspection report for ${inspectionId}: ${error.message}`, error.stack);
      throw error;
    }
  }
}