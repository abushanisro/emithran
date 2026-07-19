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
  HttpCode,
  HttpStatus,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { LHRService } from './lhr.service';
import { CreateLHRDto, UpdateLHRDto } from './lhr.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AccessToken } from '../../common/decorators/access-token.decorator';
import { Public } from '../../common/decorators/public.decorator';

@ApiTags('LHR')
@ApiBearerAuth()
@Controller({ path: 'api/lhr', version: '1' })
export class LHRController {
  constructor(private readonly LHRService: LHRService) { }

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


  @Get('benchmark')
  @ApiOperation({ summary: 'Get global benchmark LHR rates (no auth required beyond JWT)' })
  @ApiResponse({ status: 200, description: 'Benchmark LHR rates from lhr_benchmark_rates table' })
  async getBenchmarkRates(@Query('location') location?: string) {
    return this.LHRService.getBenchmarkRates(location);
  }

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

  @Delete()
  @ApiOperation({ summary: 'Delete all LHR records for the current user' })
  @ApiResponse({ status: 200, description: 'All LHR records deleted' })
  async removeAll(@CurrentUser() user: User, @AccessToken() token: string) {
    return this.LHRService.removeAll(user.id, token);
  }

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

  @Post('bulk')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Bulk create LHR records' })
  @ApiResponse({ status: 201, description: 'LHR records created successfully' })
  async bulkCreate(
    @Body() data: CreateLHRDto[],
    @CurrentUser() user: User,
    @AccessToken() token: string,
  ) {
    return this.LHRService.bulkCreate(data, user.id, token);
  }

  @Post('import-excel')
  @UseInterceptors(FileInterceptor('file'))
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
