interface User { id: string; email: string; [key: string]: any; }
/**
 * Raw Material Cost Controller
 *
 * Production-grade REST API controller for raw material costs
 * - RESTful endpoints with proper HTTP methods
 * - Authentication with Supabase
 * - Request validation with DTOs
 * - Swagger API documentation
 *
 * @class RawMaterialCostController
 * @version 1.0.0
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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { SupabaseAuthGuard } from '../../../common/guards/supabase-auth.guard';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { AccessToken } from '../../../common/decorators/access-token.decorator';
import { RawMaterialCostService } from '../services/raw-material-cost.service';
import {
  CreateRawMaterialCostDto,
  UpdateRawMaterialCostDto,
  QueryRawMaterialCostsDto,
  RawMaterialCostResponseDto,
  RawMaterialCostListResponseDto,
} from '../dto/raw-material-cost.dto';

@ApiTags('Raw Material Costs')
@ApiBearerAuth()
@Controller('api/raw-material-costs')
@UseGuards(SupabaseAuthGuard)
export class RawMaterialCostController {
  constructor(
    private readonly rawMaterialCostService: RawMaterialCostService,
  ) {}

  /**
   * Get all raw material costs with pagination and filtering
   */
  @Get()
  @ApiOperation({ summary: 'Get all raw material costs' })
  @ApiResponse({
    status: 200,
    description: 'Returns paginated list of raw material costs',
    type: RawMaterialCostListResponseDto,
  })
  async findAll(
    @Query() query: QueryRawMaterialCostsDto,
    @CurrentUser('id') userId: string,
    @AccessToken() accessToken: string,
  ): Promise<RawMaterialCostListResponseDto> {
    return this.rawMaterialCostService.findAll(query, userId, accessToken);
  }

  /**
   * Get single raw material cost by ID
   */
  @Get(':id')
  @ApiOperation({ summary: 'Get raw material cost by ID' })
  @ApiResponse({
    status: 200,
    description: 'Returns single raw material cost',
    type: RawMaterialCostResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Raw material cost not found' })
  async findOne(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @AccessToken() accessToken: string,
  ): Promise<RawMaterialCostResponseDto> {
    return this.rawMaterialCostService.findOne(id, userId, accessToken);
  }

  /**
   * Create new raw material cost
   */
  @Post()
  @ApiOperation({ summary: 'Create new raw material cost' })
  @ApiResponse({
    status: 201,
    description: 'Raw material cost created successfully',
    type: RawMaterialCostResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  async create(
    @Body() dto: CreateRawMaterialCostDto,
    @CurrentUser('id') userId: string,
    @AccessToken() accessToken: string,
  ): Promise<RawMaterialCostResponseDto> {
    return this.rawMaterialCostService.create(dto, userId, accessToken);
  }

  /**
   * Update existing raw material cost
   */
  @Put(':id')
  @ApiOperation({ summary: 'Update raw material cost' })
  @ApiResponse({
    status: 200,
    description: 'Raw material cost updated successfully',
    type: RawMaterialCostResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Raw material cost not found' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateRawMaterialCostDto,
    @CurrentUser('id') userId: string,
    @AccessToken() accessToken: string,
  ): Promise<RawMaterialCostResponseDto> {
    return this.rawMaterialCostService.update(id, dto, userId, accessToken);
  }

  /**
   * Delete raw material cost
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete raw material cost' })
  @ApiResponse({ status: 204, description: 'Raw material cost deleted successfully' })
  @ApiResponse({ status: 404, description: 'Raw material cost not found' })
  async delete(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @AccessToken() accessToken: string,
  ): Promise<void> {
    await this.rawMaterialCostService.remove(id, userId, accessToken);
  }
}
