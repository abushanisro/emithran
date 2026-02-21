interface User { id: string; email: string; [key: string]: any; }
/**
 * Packaging & Logistics Cost Controller
 *
 * Production-grade REST API controller
 * - RESTful endpoints with proper HTTP methods
 * - Authentication with Supabase
 * - Request validation with DTOs
 * - Swagger API documentation
 *
 * @class PackagingLogisticsCostController
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
import { SupabaseAuthGuard } from '../../common/guards/supabase-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AccessToken } from '../../common/decorators/access-token.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { PackagingLogisticsCostService } from './packaging-logistics-cost.service';
import {
  CreatePackagingLogisticsCostDto,
  UpdatePackagingLogisticsCostDto,
  QueryPackagingLogisticsCostsDto,
  PackagingLogisticsCostResponseDto,
  PackagingLogisticsCostListResponseDto,
} from './dto/packaging-logistics-cost.dto';

@ApiTags('Packaging & Logistics Costs')
@ApiBearerAuth()
@Controller('api/packaging-logistics-costs')
@UseGuards(SupabaseAuthGuard)
export class PackagingLogisticsCostController {
  constructor(
    private readonly packagingLogisticsCostService: PackagingLogisticsCostService,
  ) {}

  /**
   * Get all packaging/logistics costs with pagination and filtering
   */
  @Get()
  @ApiOperation({ summary: 'Get all packaging/logistics costs' })
  @ApiResponse({
    status: 200,
    description: 'Returns paginated list of packaging/logistics costs',
    type: PackagingLogisticsCostListResponseDto,
  })
async findAll(
    @Query() query: QueryPackagingLogisticsCostsDto,
    @CurrentUser('id') userId: string,
    @AccessToken() accessToken: string,
  ): Promise<PackagingLogisticsCostListResponseDto> {
    return this.packagingLogisticsCostService.findAll(query, userId, accessToken);
  }

  /**
   * Get single packaging/logistics cost by ID
   */
  @Get(':id')
  @ApiOperation({ summary: 'Get packaging/logistics cost by ID' })
  @ApiResponse({
    status: 200,
    description: 'Returns single packaging/logistics cost',
    type: PackagingLogisticsCostResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Packaging/logistics cost not found' })
  async findOne(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @AccessToken() accessToken?: string,
  ): Promise<PackagingLogisticsCostResponseDto> {
    return this.packagingLogisticsCostService.findOne(id, userId, accessToken);
  }

  /**
   * Create new packaging/logistics cost
   */
  @Post()
  @ApiOperation({ summary: 'Create new packaging/logistics cost' })
  @ApiResponse({
    status: 201,
    description: 'Packaging/logistics cost created successfully',
    type: PackagingLogisticsCostResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  async create(
    @Body() dto: CreatePackagingLogisticsCostDto,
    @CurrentUser('id') userId: string,
    @AccessToken() accessToken?: string,
  ): Promise<PackagingLogisticsCostResponseDto> {
    return this.packagingLogisticsCostService.create(dto, userId, accessToken);
  }

  /**
   * Update existing packaging/logistics cost
   */
  @Put(':id')
  @ApiOperation({ summary: 'Update packaging/logistics cost' })
  @ApiResponse({
    status: 200,
    description: 'Packaging/logistics cost updated successfully',
    type: PackagingLogisticsCostResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Packaging/logistics cost not found' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdatePackagingLogisticsCostDto,
    @CurrentUser('id') userId: string,
    @AccessToken() accessToken?: string,
  ): Promise<PackagingLogisticsCostResponseDto> {
    return this.packagingLogisticsCostService.update(id, dto, userId, accessToken);
  }

  /**
   * Delete packaging/logistics cost
   */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete packaging/logistics cost' })
  @ApiResponse({ status: 200, description: 'Packaging/logistics cost deleted successfully' })
  @ApiResponse({ status: 404, description: 'Packaging/logistics cost not found' })
  async delete(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @AccessToken() accessToken?: string,
  ): Promise<{ message: string }> {
    return this.packagingLogisticsCostService.delete(id, userId, accessToken);
  }

  /**
   * Get total packaging/logistics cost for a BOM item
   */
  @Get('bom-item/:bomItemId/total')
  @ApiOperation({ summary: 'Get total packaging/logistics cost for a BOM item' })
  @ApiResponse({
    status: 200,
    description: 'Returns total packaging/logistics cost for the BOM item',
    schema: {
      type: 'object',
      properties: {
        totalCost: { type: 'number', example: 125.75 }
      }
    }
  })
  async getTotalCostForBomItem(
    @Param('bomItemId') bomItemId: string,
    @CurrentUser('id') userId: string,
    @AccessToken() accessToken?: string,
  ): Promise<{ totalCost: number }> {
    const totalCost = await this.packagingLogisticsCostService.getTotalCostForBomItem(bomItemId, userId, accessToken);
    return { totalCost };
  }
}
