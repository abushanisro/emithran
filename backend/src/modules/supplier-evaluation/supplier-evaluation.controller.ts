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
import { SupplierEvaluationService } from './supplier-evaluation.service';
import {
  CreateSupplierEvaluationDto,
  UpdateSupplierEvaluationDto,
  QuerySupplierEvaluationDto,
  SupplierEvaluationResponseDto,
} from './dto/supplier-evaluation.dto';
import { SupabaseAuthGuard } from '../../common/guards/supabase-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Supplier Evaluation')
@ApiBearerAuth()
@Controller({ path: 'api/supplier-evaluations', version: '1' })
@UseGuards(SupabaseAuthGuard)
export class SupplierEvaluationController {
  private readonly logger = new Logger(SupplierEvaluationController.name);

  constructor(private readonly evaluationService: SupplierEvaluationService) {}

  // ============================================================================
  // CRUD OPERATIONS
  // ============================================================================

  @Post()
  @ApiOperation({ summary: 'Create a new supplier evaluation' })
  @ApiResponse({
    status: 201,
    description: 'Evaluation created successfully',
    type: SupplierEvaluationResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async create(
    @Body() dto: CreateSupplierEvaluationDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('accessToken') accessToken: string,
  ): Promise<SupplierEvaluationResponseDto> {
    try {
      this.logger.log(`Creating supplier evaluation for vendor ${dto.vendorId} and process ${dto.processId}`);
      return await this.evaluationService.create(dto, userId, accessToken);
    } catch (error) {
      this.logger.error(`Failed to create supplier evaluation: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Get()
  @ApiOperation({ summary: 'Get all supplier evaluations with optional filters' })
  @ApiResponse({
    status: 200,
    description: 'List of evaluations',
    type: [SupplierEvaluationResponseDto],
  })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async findAll(
    @Query() query: QuerySupplierEvaluationDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('accessToken') accessToken: string,
  ): Promise<SupplierEvaluationResponseDto[]> {
    try {
      this.logger.log(`Fetching supplier evaluations for user ${userId}`);
      return await this.evaluationService.findAll(query, userId, accessToken);
    } catch (error) {
      this.logger.error(`Failed to fetch supplier evaluations: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get supplier evaluation by ID' })
  @ApiResponse({
    status: 200,
    description: 'Evaluation found',
    type: SupplierEvaluationResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Evaluation not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async findOne(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('accessToken') accessToken: string,
  ): Promise<SupplierEvaluationResponseDto> {
    try {
      this.logger.log(`Fetching supplier evaluation ${id}`);
      return await this.evaluationService.findOne(id, userId, accessToken);
    } catch (error) {
      this.logger.error(`Failed to fetch supplier evaluation ${id}: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update supplier evaluation (only if not frozen)' })
  @ApiResponse({
    status: 200,
    description: 'Evaluation updated successfully',
    type: SupplierEvaluationResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid input' })
  @ApiResponse({ status: 403, description: 'Cannot update frozen evaluation' })
  @ApiResponse({ status: 404, description: 'Evaluation not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateSupplierEvaluationDto,
    @CurrentUser('id') userId: string,
    @CurrentUser('accessToken') accessToken: string,
  ): Promise<SupplierEvaluationResponseDto> {
    try {
      this.logger.log(`Updating supplier evaluation ${id}`);
      return await this.evaluationService.update(id, dto, userId, accessToken);
    } catch (error) {
      this.logger.error(`Failed to update supplier evaluation ${id}: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete supplier evaluation (only if not frozen)' })
  @ApiResponse({ status: 204, description: 'Evaluation deleted successfully' })
  @ApiResponse({ status: 403, description: 'Cannot delete frozen evaluation' })
  @ApiResponse({ status: 404, description: 'Evaluation not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async delete(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('accessToken') accessToken: string,
  ): Promise<void> {
    try {
      this.logger.log(`Deleting supplier evaluation ${id}`);
      return await this.evaluationService.delete(id, userId, accessToken);
    } catch (error) {
      this.logger.error(`Failed to delete supplier evaluation ${id}: ${error.message}`, error.stack);
      throw error;
    }
  }

  // ============================================================================
  // STATE TRANSITION COMMANDS
  // ============================================================================

  @Post(':id/complete')
  @ApiOperation({ summary: 'Mark evaluation as completed' })
  @ApiResponse({
    status: 200,
    description: 'Evaluation marked as completed',
    type: SupplierEvaluationResponseDto,
  })
  @ApiResponse({ status: 403, description: 'Cannot change status of frozen evaluation' })
  @ApiResponse({ status: 404, description: 'Evaluation not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async complete(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('accessToken') accessToken: string,
  ): Promise<SupplierEvaluationResponseDto> {
    try {
      this.logger.log(`Marking supplier evaluation ${id} as completed`);
      return await this.evaluationService.complete(id, userId, accessToken);
    } catch (error) {
      this.logger.error(`Failed to complete supplier evaluation ${id}: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Post(':id/approve')
  @ApiOperation({
    summary: 'Approve and freeze evaluation (creates immutable snapshot)',
    description: 'This freezes the evaluation and creates an immutable snapshot. Returns snapshot_id for nomination reference.',
  })
  @ApiResponse({
    status: 200,
    description: 'Evaluation approved and frozen. Snapshot created.',
    schema: {
      type: 'object',
      properties: {
        snapshotId: { type: 'string', format: 'uuid' },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Evaluation already approved' })
  @ApiResponse({ status: 404, description: 'Evaluation not found' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async approve(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @CurrentUser('accessToken') accessToken: string,
  ): Promise<{ snapshotId: string }> {
    try {
      this.logger.log(`Approving and freezing supplier evaluation ${id}`);
      return await this.evaluationService.approve(id, userId, accessToken);
    } catch (error) {
      this.logger.error(`Failed to approve supplier evaluation ${id}: ${error.message}`, error.stack);
      throw error;
    }
  }
}
