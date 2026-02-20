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
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { MHRService } from './mhr.service';
import { CreateMHRDto, UpdateMHRDto, QueryMHRDto } from './dto/mhr.dto';
import { MHRResponseDto, MHRListResponseDto } from './dto/mhr-response.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AccessToken } from '../../common/decorators/access-token.decorator';
import { Public } from '../../common/decorators/public.decorator';

@ApiTags('MHR')
@ApiBearerAuth()
@Controller({ path: 'api/mhr', version: '1' })
export class MHRController {
  private readonly logger = new Logger(MHRController.name);

  constructor(private readonly mhrService: MHRService) {}

  @Get()
  @ApiOperation({ summary: 'Get all MHR records with pagination and filters' })
  @ApiResponse({ status: 200, description: 'MHR records retrieved successfully', type: MHRListResponseDto })
  async findAll(@Query() query: QueryMHRDto, @CurrentUser() user: User, @AccessToken() token: string): Promise<MHRListResponseDto> {
    try {
      this.logger.log(`Fetching MHR records for user ${user.id}${query.search ? ` with search: ${query.search}` : ''}`);
      return await this.mhrService.findAll(query, user.id, token);
    } catch (error) {
      this.logger.error(`Failed to fetch MHR records: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get MHR record by ID' })
  @ApiResponse({ status: 200, description: 'MHR record retrieved successfully', type: MHRResponseDto })
  @ApiResponse({ status: 404, description: 'MHR record not found' })
  async findOne(@Param('id') id: string, @CurrentUser() user: User, @AccessToken() token: string): Promise<MHRResponseDto> {
    try {
      this.logger.log(`Fetching MHR record ${id} for user ${user.id}`);
      return await this.mhrService.findOne(id, user.id, token);
    } catch (error) {
      this.logger.error(`Failed to fetch MHR record ${id}: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Post()
  @ApiOperation({ summary: 'Create new MHR record' })
  @ApiResponse({ status: 201, description: 'MHR record created successfully', type: MHRResponseDto })
  async create(@Body() createMHRDto: CreateMHRDto, @CurrentUser() user: User, @AccessToken() token: string): Promise<MHRResponseDto> {
    try {
      this.logger.log(`Creating MHR record '${createMHRDto.machineName}' for user ${user.id}`);
      return await this.mhrService.create(createMHRDto, user.id, token);
    } catch (error) {
      this.logger.error(`Failed to create MHR record: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update MHR record' })
  @ApiResponse({ status: 200, description: 'MHR record updated successfully', type: MHRResponseDto })
  async update(@Param('id') id: string, @Body() updateMHRDto: UpdateMHRDto, @CurrentUser() user: User, @AccessToken() token: string): Promise<MHRResponseDto> {
    try {
      this.logger.log(`Updating MHR record ${id} for user ${user.id}`);
      return await this.mhrService.update(id, updateMHRDto, user.id, token);
    } catch (error) {
      this.logger.error(`Failed to update MHR record ${id}: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete MHR record' })
  @ApiResponse({ status: 200, description: 'MHR record deleted successfully' })
  async remove(@Param('id') id: string, @CurrentUser() user: User, @AccessToken() token: string) {
    try {
      this.logger.log(`Deleting MHR record ${id} for user ${user.id}`);
      return await this.mhrService.remove(id, user.id, token);
    } catch (error) {
      this.logger.error(`Failed to delete MHR record ${id}: ${error.message}`, error.stack);
      throw error;
    }
  }
}
