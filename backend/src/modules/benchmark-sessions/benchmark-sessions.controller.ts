interface User { id: string; email: string; [key: string]: any; }
import {
  Controller, Get, Post, Put, Delete,
  Body, Param, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { BenchmarkSessionsService } from './benchmark-sessions.service';
import {
  CreateBenchmarkSessionDto,
  UpdateBenchmarkSessionDto,
} from './dto/benchmark-sessions.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AccessToken } from '../../common/decorators/access-token.decorator';

@ApiTags('Benchmark Sessions')
@ApiBearerAuth()
@Controller({ path: 'api/benchmark-sessions', version: '1' })
export class BenchmarkSessionsController {
  constructor(private readonly benchmarkSessionsService: BenchmarkSessionsService) {}

  @Get()
  @ApiOperation({ summary: 'List all benchmark sessions for the current user' })
  @ApiResponse({ status: 200 })
  async findAll(
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    return this.benchmarkSessionsService.findAll(user.id, token);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new benchmark session' })
  @ApiResponse({ status: 201 })
  async create(
    @Body() dto: CreateBenchmarkSessionDto,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    return this.benchmarkSessionsService.create(dto, user.id, token);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a benchmark session by ID' })
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    return this.benchmarkSessionsService.findOne(id, user.id, token);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a benchmark session' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateBenchmarkSessionDto,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    return this.benchmarkSessionsService.update(id, dto, user.id, token);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a benchmark session' })
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    return this.benchmarkSessionsService.remove(id, user.id, token);
  }
}
