interface User { id: string; email: string; [key: string]: any; }
import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
  Logger,
  HttpException,
  HttpStatus,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { SupabaseAuthGuard } from '@/common/guards/supabase-auth.guard';
import { RateLimitGuard } from '@/common/guards/rate-limit.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { RateLimit, RateLimits } from '@/common/decorators/rate-limit.decorator';
import { createResponse, ApiResponse } from '@/common/dto/api-response.dto';
import { ProductionPlanningService } from './production-planning.service';
import { ProductionMaterialTrackingService } from './services/production-material-tracking.service';
import {
  CreateProductionLotDto,
  UpdateProductionLotDto,
  ProductionLotResponseDto,
} from './dto/production-lot.dto';
import {
  CreateLotVendorAssignmentDto,
  UpdateLotVendorAssignmentDto,
  BulkVendorAssignmentDto,
} from './dto/vendor-assignment.dto';
import {
  CreateProductionProcessDto,
  UpdateProductionProcessDto,
  CreateProcessSubtaskDto,
  UpdateProcessSubtaskDto,
} from './dto/production-process.dto';
import {
  CreateDailyProductionEntryDto,
  UpdateDailyProductionEntryDto,
  DailyProductionEntryResponseDto,
  ProductionSummaryDto,
} from './dto/daily-production.dto';

@Controller('api/production-planning')
@UseGuards(SupabaseAuthGuard, RateLimitGuard)
export class ProductionPlanningController {
  private readonly logger = new Logger(ProductionPlanningController.name);

  constructor(
    private readonly productionPlanningService: ProductionPlanningService,
    private readonly materialTrackingService: ProductionMaterialTrackingService,
  ) {}

  /**
   * Helper method to extract user ID from authenticated user object
   */
  private getUserId(user: any): string {
    if (!user?.id) {
      throw new UnauthorizedException('User ID not found in authenticated request');
    }
    return user.id;
  }

  // ============================================================================
  // PRODUCTION LOTS ENDPOINTS
  // ============================================================================

  @Post('lots')
  async createProductionLot(
    @Body() createDto: CreateProductionLotDto,
    @CurrentUser() user: User,
  ): Promise<ApiResponse<ProductionLotResponseDto>> {
    try {
      this.logger.log(`Creating production lot '${createDto.lotNumber}' for user ${this.getUserId(user)}`);
      const result = await this.productionPlanningService.createProductionLot(createDto, this.getUserId(user));
      return createResponse(result);
    } catch (error) {
      this.logger.error(`Failed to create production lot: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Get('lots')
  async getProductionLots(
    @CurrentUser() user: User,
    @Query('status') status?: string,
    @Query('bomId') bomId?: string,
    @Query('priority') priority?: string,
  ): Promise<ApiResponse<ProductionLotResponseDto[]>> {
    try {
      this.logger.log(`Fetching production lots for user ${this.getUserId(user)}`);
      const result = await this.productionPlanningService.getProductionLots(this.getUserId(user), {
        status,
        bomId,
        priority,
      });
      return createResponse(result);
    } catch (error) {
      this.logger.error(`Failed to fetch production lots: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Get('lots/:id')
  async getProductionLotById(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ): Promise<ApiResponse<ProductionLotResponseDto>> {
    try {
      this.logger.log(`Fetching production lot ${id} for user ${this.getUserId(user)}`);
      const result = await this.productionPlanningService.getProductionLotById(id, this.getUserId(user));
      return createResponse(result);
    } catch (error) {
      this.logger.error(`Failed to fetch production lot ${id}: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Get('lots/:id/bom-items')
  async getProductionLotBomItems(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ): Promise<ApiResponse<any[]>> {
    const result = await this.productionPlanningService.getProductionLotBomItems(id, this.getUserId(user));
    return createResponse(result);
  }

  @Get('lots/:id/vendor-assignments')
  async getProductionLotVendorAssignments(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ): Promise<ApiResponse<any[]>> {
    const result = await this.productionPlanningService.getProductionLotVendorAssignments(id, this.getUserId(user));
    return createResponse(result);
  }

  @Post('lots/:id/vendor-assignments')
  async createVendorAssignment(
    @Param('id', ParseUUIDPipe) lotId: string,
    @Body() assignmentData: any,
    @CurrentUser() user: User,
  ): Promise<ApiResponse<any>> {
    const result = await this.productionPlanningService.createVendorAssignment(assignmentData, this.getUserId(user));
    return createResponse(result);
  }

  @Patch('lots/:id/vendor-assignments/:assignmentId')
  async updateVendorAssignment(
    @Param('id', ParseUUIDPipe) lotId: string,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @Body() updateData: any,
    @CurrentUser() user: User,
  ): Promise<ApiResponse<any>> {
    const result = await this.productionPlanningService.updateVendorAssignment(assignmentId, updateData, this.getUserId(user));
    return createResponse(result);
  }

  @Put('lots/:id')
  @RateLimit(RateLimits.CRITICAL_OPERATIONS)
  async updateProductionLot(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateDto: UpdateProductionLotDto,
    @CurrentUser() user: User,
  ): Promise<ApiResponse<ProductionLotResponseDto>> {
    try {
      this.logger.log(`Updating production lot ${id} for user ${this.getUserId(user)}`);
      
      // Additional date validation
      if (updateDto.plannedStartDate && updateDto.plannedEndDate) {
        const startDate = new Date(updateDto.plannedStartDate);
        const endDate = new Date(updateDto.plannedEndDate);
        
        if (startDate >= endDate) {
          throw new HttpException(
            'Start date must be before end date',
            HttpStatus.BAD_REQUEST
          );
        }
        
        // Validate dates are not too far in the future (business rule)
        const maxFutureDate = new Date();
        maxFutureDate.setFullYear(maxFutureDate.getFullYear() + 2);
        
        if (startDate > maxFutureDate || endDate > maxFutureDate) {
          throw new HttpException(
            'Dates cannot be more than 2 years in the future',
            HttpStatus.BAD_REQUEST
          );
        }
      }
      
      const result = await this.productionPlanningService.updateProductionLot(id, updateDto, this.getUserId(user));
      this.logger.log(`Successfully updated production lot ${id}`);
      
      return createResponse(result);
    } catch (error) {
      this.logger.error(`Failed to update production lot ${id}:`, error);
      throw error;
    }
  }

  @Delete('lots/:id')
  async deleteProductionLot(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ): Promise<ApiResponse<void>> {
    await this.productionPlanningService.deleteProductionLot(id, this.getUserId(user));
    return createResponse(undefined);
  }


  // ============================================================================
  // PRODUCTION PROCESSES ENDPOINTS
  // ============================================================================

  @Post('lots/:lotId/processes')
  async createProductionProcess(
    @Param('lotId', ParseUUIDPipe) lotId: string,
    @Body() createDto: CreateProductionProcessDto,
    @CurrentUser() user: User,
  ): Promise<ApiResponse<any>> {
    const result = await this.productionPlanningService.createProductionProcess(createDto, this.getUserId(user));
    return createResponse(result);
  }

  @Get('lots/:lotId/processes')
  async getProductionProcesses(
    @Param('lotId', ParseUUIDPipe) lotId: string,
    @CurrentUser() user: User,
    @Query('status') status?: string,
  ): Promise<ApiResponse<any[]>> {
    const result = await this.productionPlanningService.getProductionProcesses(lotId, this.getUserId(user), { status });
    return createResponse(result);
  }

  @Put('processes/:id')
  async updateProductionProcess(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateDto: UpdateProductionProcessDto,
    @CurrentUser() user: User,
  ): Promise<ApiResponse<any>> {
    const result = await this.productionPlanningService.updateProductionProcess(id, updateDto, this.getUserId(user));
    return createResponse(result);
  }

  @Delete('processes/:id')
  async deleteProductionProcess(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ): Promise<ApiResponse<void>> {
    await this.productionPlanningService.deleteProductionProcess(id, this.getUserId(user));
    return createResponse(undefined);
  }

  // ============================================================================
  // PROCESS SUBTASKS ENDPOINTS
  // ============================================================================

  @Post('processes/:processId/subtasks')
  async createProcessSubtask(
    @Param('processId', ParseUUIDPipe) processId: string,
    @Body() createDto: CreateProcessSubtaskDto,
    @CurrentUser() user: User,
  ): Promise<ApiResponse<any>> {
    const userId = this.getUserId(user);
    
    // Validate that processId in URL matches productionProcessId in DTO
    if (processId !== createDto.productionProcessId) {
      throw new BadRequestException('Process ID in URL must match productionProcessId in request body');
    }
    
    const result = await this.productionPlanningService.createProcessSubtask(createDto, userId);
    return createResponse(result);
  }

  @Get('processes/:processId/subtasks')
  async getProcessSubtasks(
    @Param('processId', ParseUUIDPipe) processId: string,
    @CurrentUser() user: User,
  ): Promise<ApiResponse<any[]>> {
    const userId = this.getUserId(user);
    const result = await this.productionPlanningService.getProcessSubtasks(processId, userId);
    return createResponse(result);
  }

  @Put('subtasks/:id')
  async updateProcessSubtask(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateDto: UpdateProcessSubtaskDto,
    @CurrentUser() user: User,
  ): Promise<ApiResponse<any>> {
    const result = await this.productionPlanningService.updateProcessSubtask(id, updateDto, this.getUserId(user));
    return createResponse(result);
  }

  @Delete('subtasks/:id')
  async deleteProcessSubtask(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ): Promise<ApiResponse<void>> {
    await this.productionPlanningService.deleteProcessSubtask(id, this.getUserId(user));
    return createResponse(undefined);
  }

  // ============================================================================
  // DAILY PRODUCTION ENTRIES ENDPOINTS
  // ============================================================================

  @Post('lots/:lotId/production-entries')
  async createDailyProductionEntry(
    @Param('lotId', ParseUUIDPipe) lotId: string,
    @Body() createDto: CreateDailyProductionEntryDto,
    @CurrentUser() user: User,
  ): Promise<ApiResponse<DailyProductionEntryResponseDto>> {
    const result = await this.productionPlanningService.createDailyProductionEntry(createDto, this.getUserId(user));
    return createResponse(result);
  }

  @Get('lots/:lotId/production-entries')
  async getDailyProductionEntries(
    @Param('lotId', ParseUUIDPipe) lotId: string,
    @CurrentUser() user: User,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('entryType') entryType?: string,
  ): Promise<ApiResponse<DailyProductionEntryResponseDto[]>> {
    const result = await this.productionPlanningService.getDailyProductionEntries(lotId, this.getUserId(user), {
      startDate,
      endDate,
      entryType,
    });
    return createResponse(result);
  }

  @Put('production-entries/:id')
  async updateDailyProductionEntry(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateDto: UpdateDailyProductionEntryDto,
    @CurrentUser() user: User,
  ): Promise<ApiResponse<DailyProductionEntryResponseDto>> {
    const result = await this.productionPlanningService.updateDailyProductionEntry(id, updateDto, this.getUserId(user));
    return createResponse(result);
  }

  // ============================================================================
  // DASHBOARD & REPORTING ENDPOINTS
  // ============================================================================

  @Get('lots/:lotId/summary')
  async getProductionSummary(
    @Param('lotId', ParseUUIDPipe) lotId: string,
    @CurrentUser() user: User,
  ): Promise<ApiResponse<ProductionSummaryDto>> {
    const result = await this.productionPlanningService.getProductionSummary(lotId, this.getUserId(user));
    return createResponse(result);
  }

  @Get('dashboard')
  async getDashboardData(
    @CurrentUser() user: User,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ): Promise<ApiResponse<any>> {
    const result = await this.productionPlanningService.getDashboardData(this.getUserId(user), { startDate, endDate });
    return createResponse(result);
  }

  @Get('lots/:lotId/gantt')
  async getGanttData(
    @Param('lotId', ParseUUIDPipe) lotId: string,
    @CurrentUser() user: User,
  ): Promise<ApiResponse<any>> {
    const result = await this.productionPlanningService.getGanttData(lotId, this.getUserId(user));
    return createResponse(result);
  }


  // ============================================================================
  // MATERIAL TRACKING ENDPOINTS
  // ============================================================================

  @Post('lots/:lotId/materials/initialize')
  async initializeLotMaterials(
    @Param('lotId', ParseUUIDPipe) lotId: string,
    @CurrentUser() user: User,
  ): Promise<ApiResponse<any[]>> {
    const result = await this.materialTrackingService.initializeProductionLotMaterials(lotId, this.getUserId(user));
    return createResponse(result);
  }

  @Get('lots/:lotId/materials')
  async getLotMaterials(
    @Param('lotId', ParseUUIDPipe) lotId: string,
    @CurrentUser() user: User,
  ): Promise<ApiResponse<any[]>> {
    const result = await this.materialTrackingService.getProductionLotMaterials(lotId, this.getUserId(user));
    return createResponse(result);
  }

  @Put('materials/:materialId/status')
  async updateMaterialStatus(
    @Param('materialId', ParseUUIDPipe) materialId: string,
    @Body() updateData: any,
    @CurrentUser() user: User,
  ): Promise<ApiResponse<any>> {
    const result = await this.materialTrackingService.updateMaterialStatus(materialId, updateData, this.getUserId(user));
    return createResponse(result);
  }

  @Get('materials/:materialId/tracking-history')
  async getMaterialTrackingHistory(
    @Param('materialId', ParseUUIDPipe) materialId: string,
    @CurrentUser() user: User,
  ): Promise<ApiResponse<any[]>> {
    const result = await this.materialTrackingService.getMaterialTrackingHistory(materialId, this.getUserId(user));
    return createResponse(result);
  }

  // ============================================================================
  // INTEGRATED MONITORING ENDPOINTS
  // ============================================================================

  @Get('lots/:lotId/monitoring')
  async getProductionMonitoring(
    @Param('lotId', ParseUUIDPipe) lotId: string,
    @CurrentUser() user: User,
  ): Promise<ApiResponse<any>> {
    const result = await this.materialTrackingService.getProductionMonitoringData(lotId, this.getUserId(user));
    return createResponse(result);
  }

  @Get('lots/:lotId/integrated-dashboard')
  async getIntegratedDashboard(
    @Param('lotId', ParseUUIDPipe) lotId: string,
    @CurrentUser() user: User,
  ): Promise<ApiResponse<any>> {
    const result = await this.materialTrackingService.getIntegratedDashboardData(lotId, this.getUserId(user));
    return createResponse(result);
  }

  @Post('lots/:lotId/metrics')
  async recordProductionMetrics(
    @Param('lotId', ParseUUIDPipe) lotId: string,
    @Body() metricsData: any,
    @CurrentUser() user: User,
  ): Promise<ApiResponse<any>> {
    const result = await this.materialTrackingService.recordProductionMetrics(lotId, metricsData, this.getUserId(user));
    return createResponse(result);
  }

  // ============================================================================
  // ALERTS MANAGEMENT ENDPOINTS
  // ============================================================================

  @Get('lots/:lotId/alerts')
  async getProductionAlerts(
    @Param('lotId', ParseUUIDPipe) lotId: string,
    @CurrentUser() user: User,
  ): Promise<ApiResponse<any[]>> {
    const result = await this.materialTrackingService.getProductionAlerts(lotId, this.getUserId(user));
    return createResponse(result);
  }

  @Post('lots/:lotId/alerts')
  async createManualAlert(
    @Param('lotId', ParseUUIDPipe) lotId: string,
    @Body() alertData: any,
    @CurrentUser() user: User,
  ): Promise<ApiResponse<any>> {
    const result = await this.materialTrackingService.createManualAlert(lotId, alertData, this.getUserId(user));
    return createResponse(result);
  }

  @Put('alerts/:alertId/resolve')
  async resolveAlert(
    @Param('alertId', ParseUUIDPipe) alertId: string,
    @Body() resolutionData: { notes: string },
    @CurrentUser() user: User,
  ): Promise<ApiResponse<any>> {
    const result = await this.materialTrackingService.resolveAlert(alertId, resolutionData.notes, this.getUserId(user));
    return createResponse(result);
  }

  // ============================================================================
  // DIRECT SUBTASKS ENDPOINT
  // ============================================================================

  @Get('lots/:lotId/subtasks-direct')
  async getSubtasksDirectByLot(
    @Param('lotId', ParseUUIDPipe) lotId: string,
    @CurrentUser() user: User,
  ): Promise<ApiResponse<any[]>> {
    const result = await this.productionPlanningService.getSubtasksDirectByLot(lotId, this.getUserId(user));
    return createResponse(result);
  }

  // ============================================================================
  // PROCESS TEMPLATES ENDPOINTS
  // ============================================================================

  @Get('process-templates')
  async getDefaultProcessTemplates(
    @CurrentUser() user: User,
  ): Promise<ApiResponse<any[]>> {
    const result = await this.productionPlanningService.getDefaultProcessTemplates(this.getUserId(user));
    return createResponse(result);
  }

  @Post('process-templates')
  async createProcessTemplate(
    @Body() templateData: {
      name: string;
      description?: string;
      category?: string;
    },
    @CurrentUser() user: User,
  ): Promise<ApiResponse<any>> {
    const result = await this.productionPlanningService.createProcessTemplate(this.getUserId(user), templateData);
    return createResponse(result);
  }

  @Post('lots/:id/update-status-by-progress')
  async updateLotStatusByProgress(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ): Promise<ApiResponse<void>> {
    await this.productionPlanningService.updateLotStatusByProgress(id, this.getUserId(user));
    return createResponse(undefined);
  }

  @Post('lots/:id/cleanup-materials')
  async cleanupLotMaterials(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ): Promise<ApiResponse<void>> {
    await this.productionPlanningService.cleanupProductionLotMaterials(id, this.getUserId(user));
    return createResponse(undefined);
  }

}