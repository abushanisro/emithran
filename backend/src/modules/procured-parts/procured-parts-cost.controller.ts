interface User { id: string; email: string; [key: string]: any; }
/**
 * Procured Parts Cost Controller
 *
 * Production-grade REST API controller
 * - RESTful endpoints for procured/purchased parts
 * - Authentication and authorization
 * - Input validation with DTOs
 * - Comprehensive API documentation
 *
 * @class ProcuredPartsCostController
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
import { ProcuredPartsCostService } from './procured-parts-cost.service';
import {
  CreateProcuredPartsCostDto,
  UpdateProcuredPartsCostDto,
  QueryProcuredPartsCostsDto,
  ProcuredPartsCostResponseDto,
  ProcuredPartsCostListResponseDto,
} from './dto/procured-parts-cost.dto';

@ApiTags('Procured Parts Costs')
@ApiBearerAuth()
@Controller('api/procured-parts-costs')
@UseGuards(SupabaseAuthGuard)
export class ProcuredPartsCostController {
  constructor(
    private readonly procuredPartsCostService: ProcuredPartsCostService,
  ) {}

  /**
   * Get all procured parts costs with pagination and filtering
   */
  @Get()
  @ApiOperation({ summary: 'Get all procured parts costs' })
  @ApiResponse({
    status: 200,
    description: 'Returns paginated list of procured parts costs',
    type: ProcuredPartsCostListResponseDto,
  })
async findAll(
    @Query() query: QueryProcuredPartsCostsDto,
    @CurrentUser('id') userId: string,
    @AccessToken() accessToken: string,
  ): Promise<ProcuredPartsCostListResponseDto> {
    return this.procuredPartsCostService.findAll(query, userId, accessToken);
  }

  /**
   * Get single procured part cost by ID
   */
  @Get(':id')
  @ApiOperation({ summary: 'Get procured part cost by ID' })
  @ApiResponse({
    status: 200,
    description: 'Returns single procured part cost',
    type: ProcuredPartsCostResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Procured part cost not found' })
  async findOne(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @AccessToken() accessToken?: string,
  ): Promise<ProcuredPartsCostResponseDto> {
    return this.procuredPartsCostService.findOne(id, userId, accessToken);
  }

  /**
   * Create new procured part cost
   */
  @Post()
  @ApiOperation({ summary: 'Create new procured part cost' })
  @ApiResponse({
    status: 201,
    description: 'Procured part cost created successfully',
    type: ProcuredPartsCostResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  async create(
    @Body() dto: CreateProcuredPartsCostDto,
    @CurrentUser('id') userId: string,
    @AccessToken() accessToken?: string,
  ): Promise<ProcuredPartsCostResponseDto> {
    return this.procuredPartsCostService.create(dto, userId, accessToken);
  }

  /**
   * Update existing procured part cost
   */
  @Put(':id')
  @ApiOperation({ summary: 'Update procured part cost' })
  @ApiResponse({
    status: 200,
    description: 'Procured part cost updated successfully',
    type: ProcuredPartsCostResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Procured part cost not found' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateProcuredPartsCostDto,
    @CurrentUser('id') userId: string,
    @AccessToken() accessToken?: string,
  ): Promise<ProcuredPartsCostResponseDto> {
    return this.procuredPartsCostService.update(id, dto, userId, accessToken);
  }

  /**
   * Delete procured part cost
   */
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete procured part cost' })
  @ApiResponse({ status: 200, description: 'Procured part cost deleted successfully' })
  @ApiResponse({ status: 404, description: 'Procured part cost not found' })
  async delete(
    @Param('id') id: string,
    @CurrentUser('id') userId: string,
    @AccessToken() accessToken?: string,
  ): Promise<{ message: string }> {
    return this.procuredPartsCostService.delete(id, userId, accessToken);
  }
}
