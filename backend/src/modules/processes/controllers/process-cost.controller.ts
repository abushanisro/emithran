/**
 * Process Cost Controller
 *
 * Production-grade REST API controller for process costs
 * - RESTful endpoints with proper HTTP methods
 * - Authentication with Supabase
 * - Request validation with DTOs
 * - Swagger API documentation
 *
 * @class ProcessCostController
 * @version 2.0.0
 */

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
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { SupabaseAuthGuard } from '../../../common/guards/supabase-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { AccessToken } from '../../../common/decorators/access-token.decorator';
import { ProcessCostService } from '../services/process-cost.service';
import {
  CreateProcessCostDto,
  UpdateProcessCostDto,
  QueryProcessCostsDto,
  ProcessCostResponseDto,
  ProcessCostListResponseDto,
} from '../dto/process-cost.dto';
import { ProcessCostInput } from '../engines/process-cost-calculation.engine';

@ApiTags('Process Costs')
@ApiBearerAuth()
@UseGuards(SupabaseAuthGuard)
@Controller('api/process-costs')
export class ProcessCostController {
  private readonly logger = new Logger(ProcessCostController.name);

  constructor(private readonly processCostService: ProcessCostService) {}

  /**
   * Get all process cost records with pagination and filtering
   */
  @Get()
  @ApiOperation({ summary: 'Get all process cost records' })
  @ApiResponse({
    status: 200,
    description: 'Returns paginated list of process cost records',
    type: ProcessCostListResponseDto,
  })
  async findAll(
    @Query() query: QueryProcessCostsDto,
    @CurrentUser('id') userId: string,
    @AccessToken() accessToken: string,
  ): Promise<ProcessCostListResponseDto> {
    // Handle multiple bomItemId query parameters
    // When multiple ?bomItemId=uuid1&bomItemId=uuid2 are sent, they are automatically parsed as array
    if (query.bomItemId && Array.isArray(query.bomItemId)) {
      query.bomItemIds = query.bomItemId;
      delete query.bomItemId; // Remove single bomItemId to avoid conflicts
    } else if (query.bomItemId && typeof query.bomItemId === 'string') {
      // If only one bomItemId is provided, keep it in the single field
      // No changes needed
    }

    try {
      this.logger.log(`Fetching process costs for user ${userId}`);
      return await this.processCostService.findAll(query, userId, accessToken);
    } catch (error) {
      this.logger.error(`Failed to fetch process costs: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get single process cost by ID
   */
  @Get(':id')
  @ApiOperation({ summary: 'Get process cost by ID' })
  @ApiResponse({
    status: 200,
    description: 'Returns single process cost record',
    type: ProcessCostResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Process cost not found' })
  async findOne(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @AccessToken() accessToken: string,
  ): Promise<ProcessCostResponseDto> {
    try {
      this.logger.log(`Fetching process cost ${id} for user ${userId}`);
      return await this.processCostService.findOne(id, userId, accessToken);
    } catch (error) {
      this.logger.error(`Failed to fetch process cost ${id}: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Create new process cost
   */
  @Post()
  @ApiOperation({ summary: 'Create new process cost' })
  @ApiResponse({
    status: 201,
    description: 'Process cost created successfully',
    type: ProcessCostResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  async create(
    @Body() dto: CreateProcessCostDto,
    @CurrentUser('id') userId: string,
    @AccessToken() accessToken: string,
  ): Promise<ProcessCostResponseDto> {
    try {
      this.logger.log(`Creating process cost for user ${userId}`);
      return await this.processCostService.create(dto, userId, accessToken);
    } catch (error) {
      this.logger.error(`Failed to create process cost: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Update existing process cost
   */
  @Put(':id')
  @ApiOperation({ summary: 'Update process cost' })
  @ApiResponse({
    status: 200,
    description: 'Process cost updated successfully',
    type: ProcessCostResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Process cost not found' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateProcessCostDto,
    @CurrentUser('id') userId: string,
    @AccessToken() accessToken: string,
  ): Promise<ProcessCostResponseDto> {
    try {
      this.logger.log(`Updating process cost ${id} for user ${userId}`);
      return await this.processCostService.update(id, dto, userId, accessToken);
    } catch (error) {
      this.logger.error(`Failed to update process cost ${id}: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Delete process cost
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete process cost' })
  @ApiResponse({ status: 204, description: 'Process cost deleted successfully' })
  @ApiResponse({ status: 404, description: 'Process cost not found' })
  async delete(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @AccessToken() accessToken: string,
  ): Promise<void> {
    try {
      this.logger.log(`Deleting process cost ${id} for user ${userId}`);
      await this.processCostService.remove(id, userId, accessToken);
    } catch (error) {
      this.logger.error(`Failed to delete process cost ${id}: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Calculate process cost without saving (preview/what-if analysis)
   */
  @Post('calculate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Calculate process cost without saving' })
  @ApiResponse({
    status: 200,
    description: 'Process cost calculated successfully',
  })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  async calculateOnly(@Body() input: ProcessCostInput): Promise<any> {
    try {
      this.logger.log('Calculating process cost without saving');
      return await this.processCostService.calculateOnly(input);
    } catch (error) {
      this.logger.error(`Failed to calculate process cost: ${error.message}`, error.stack);
      throw error;
    }
  }
}
