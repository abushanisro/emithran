import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { SupplierEvaluationService } from './supplier-evaluation.service';
import {
  CreateSupplierEvaluationDto,
  QuerySupplierEvaluationDto,
  SupplierEvaluationResponseDto,
} from './dto/supplier-evaluation.dto';
import { RequestAuthGuard } from '../../common/guards/request-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AccessToken } from '../../common/decorators/access-token.decorator';
import { OrgRole } from '../../common/authz/authz-policy';

@ApiTags('Supplier Evaluation')
@ApiBearerAuth()
@OrgRole('member')
@Controller({ path: 'supplier-evaluations', version: '1' })
@UseGuards(RequestAuthGuard)
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
    @AccessToken() accessToken: string,
  ): Promise<SupplierEvaluationResponseDto> {
    try {
      this.logger.log(`Creating supplier evaluation for vendor ${dto.vendorId} and process ${dto.processId}`);
      return await this.evaluationService.create(dto, userId, accessToken);
    } catch (error) {
      this.logger.error(`Failed to create supplier evaluation: ${error.message}`, error.stack);
      throw error;
    }
  }

  @OrgRole('viewer')
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
    @AccessToken() accessToken: string,
  ): Promise<SupplierEvaluationResponseDto[]> {
    try {
      this.logger.log(`Fetching supplier evaluations for user ${userId}`);
      return await this.evaluationService.findAll(query, userId, accessToken);
    } catch (error) {
      this.logger.error(`Failed to fetch supplier evaluations: ${error.message}`, error.stack);
      throw error;
    }
  }




  // ============================================================================
  // STATE TRANSITION COMMANDS
  // ============================================================================


}
