interface User { id: string; email: string; [key: string]: any; }
import { Throttle } from '@nestjs/throttler';
import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  ParseArrayPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { MAX_XLSX_UPLOAD_BYTES } from '../../common/archive/xlsx-limits';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { LHRService } from './lhr.service';
import { CreateLHRDto, UpdateLHRDto } from './lhr.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AccessToken } from '../../common/decorators/access-token.decorator';
import { AuditService } from '../../common/audit/audit.service';
import { requireBulkDeleteConfirmation } from '../../common/http/bulk-delete';
import { OrgRole } from '../../common/authz/authz-policy';

@ApiTags('LHR')
@ApiBearerAuth()
@OrgRole('member')
@Controller({ path: 'labour-rates', version: '1' })
export class LHRController {
  constructor(private readonly LHRService: LHRService, private readonly audit: AuditService) { }

  @OrgRole('admin')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create new LHR record' })
  @ApiResponse({ status: 201, description: 'LHR record created successfully' })
  @ApiResponse({ status: 409, description: 'Labour code already exists' })
  async create(
    @Body() CreateLHRDto: CreateLHRDto,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    return this.LHRService.create(CreateLHRDto, user.id, token);
  }

  @OrgRole('viewer')
  @Get()
  @ApiOperation({ summary: 'Get all LHR records with optional search' })
  @ApiResponse({ status: 200, description: 'LHR records retrieved successfully' })
  async findAll(
    @Query('search') search: string,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    return this.LHRService.findAll(search, user.id, token);
  }

  @OrgRole('viewer')
  @Get('count')
  @ApiOperation({ summary: 'Number of LHR records, without the rows' })
  async count(@AccessToken() token: string) {
    return this.LHRService.count(token);
  }


  @OrgRole('viewer')
  @Get('benchmark')
  @ApiOperation({ summary: 'Get global benchmark LHR rates (no auth required beyond JWT)' })
  @ApiResponse({ status: 200, description: 'Benchmark LHR rates from lhr_benchmark_rates table' })
  async getBenchmarkRates(@Query('location') location?: string) {
    return this.LHRService.getBenchmarkRates(location);
  }

  @OrgRole('viewer')
  @Get('effective-rate')
  @ApiOperation({ summary: 'Preview the real cost-engine-aligned labor rate for a (location, process_group)' })
  @ApiResponse({ status: 200, description: 'Resolved rate, or null with source "none" if nothing is on file' })
  async getEffectiveRate(
    @Query('location') location: string,
    @Query('processGroup') processGroup: string,
    @AccessToken() token: string,
  ) {
    if (!location || !processGroup) {
      throw new BadRequestException('location and processGroup are required');
    }
    return this.LHRService.getEffectiveRate(location, processGroup, token);
  }

  @OrgRole('viewer')
  @Get('code/:labourCode')
  @ApiOperation({ summary: 'Get LHR record by labour code' })
  @ApiResponse({ status: 200, description: 'LHR record retrieved successfully' })
  @ApiResponse({ status: 404, description: 'Labour code not found' })
  async findByLabourCode(
    @Param('labourCode') labourCode: string,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    return this.LHRService.findByLabourCode(labourCode, user.id, token);
  }

  @OrgRole('viewer')
  @Get(':id')
  @ApiOperation({ summary: 'Get LHR record by ID' })
  @ApiResponse({ status: 200, description: 'LHR record retrieved successfully' })
  @ApiResponse({ status: 404, description: 'LHR record not found' })
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    return this.LHRService.findOne(id, user.id, token);
  }

  @OrgRole('admin')
  @Put(':id')
  @ApiOperation({ summary: 'Update LHR record' })
  @ApiResponse({ status: 200, description: 'LHR record updated successfully' })
  @ApiResponse({ status: 404, description: 'LHR record not found' })
  async update(
    @Param('id') id: string,
    @Body() UpdateLHRDto: UpdateLHRDto,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    return this.LHRService.update(id, UpdateLHRDto, user.id, token);
  }

  @OrgRole('admin')
  @Delete()
  @ApiOperation({ summary: 'Delete all LHR records for the current user (administrators; needs ?confirm=delete-all)' })
  @ApiResponse({ status: 200, description: 'All LHR records deleted' })
  async removeAll(@CurrentUser() user: User, @AccessToken() token: string, @Query('confirm') confirm?: string) {
    requireBulkDeleteConfirmation(confirm);
    return this.audit.purged('lhr', () => this.LHRService.removeAll(user.id, token));
  }

  @OrgRole('admin')
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete LHR record' })
  @ApiResponse({ status: 204, description: 'LHR record deleted successfully' })
  @ApiResponse({ status: 404, description: 'LHR record not found' })
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    return this.LHRService.remove(id, user.id, token);
  }

  @OrgRole('admin')
  @Post('batches')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Bulk create LHR records' })
  @ApiResponse({ status: 201, description: 'LHR records created successfully' })
  async bulkCreate(
    @Body(new ParseArrayPipe({ items: CreateLHRDto, whitelist: true })) data: CreateLHRDto[],
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    return this.LHRService.bulkCreate(data, user.id, token);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } }) // heavy: parses or analyses a file
  @OrgRole('admin')
  @Post('imports')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_XLSX_UPLOAD_BYTES, files: 1 } }))
  @ApiOperation({ summary: 'Import LHR records from Excel (.xlsx)' })
  @ApiResponse({ status: 201, description: 'LHR records imported successfully' })
  async importFromExcel(
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    return this.LHRService.importFromExcel(file.buffer, user.id, token);
  }
}
