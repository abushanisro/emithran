interface User { id: string; email: string; [key: string]: any; }
import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { SupabaseAuthGuard } from '@/common/guards/supabase-auth.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { ProductionProcessService } from '../services/production-process.service';
import {
  CreateLotVendorAssignmentDto,
  UpdateLotVendorAssignmentDto,
} from '../dto/vendor-assignment.dto';
import {
  ProductionProcessResponseDto,
  LotVendorAssignmentResponseDto as VendorAssignmentResponseDto,
} from '../dto/production-lot.dto';

@ApiTags('Production Processes')
@Controller('api/production-planning/processes')
@UseGuards(SupabaseAuthGuard)
export class ProductionProcessController {
  constructor(private readonly productionProcessService: ProductionProcessService) { }


  @Get('/:id')
  @ApiOperation({ summary: 'Get production process by ID' })
  @ApiResponse({ type: ProductionProcessResponseDto })
  async getProductionProcess(
    @Param('id') id: string,
    @CurrentUser() user: User
  ): Promise<ProductionProcessResponseDto> {
    return this.productionProcessService.getProductionProcessById(id, user.id);
  }


  @Delete('/:id')
  @ApiOperation({ summary: 'Delete production process' })
  async deleteProductionProcess(
    @Param('id') id: string,
    @CurrentUser() user: User
  ): Promise<void> {
    return this.productionProcessService.deleteProductionProcess(id, user.id);
  }

  @Get('/lot/:lotId')
  @ApiOperation({ summary: 'Get all processes for a production lot' })
  @ApiResponse({ type: [ProductionProcessResponseDto] })
  async getProcessesByLot(
    @Param('lotId') lotId: string,
    @CurrentUser() user: User
  ): Promise<ProductionProcessResponseDto[]> {
    return this.productionProcessService.getProcessesByLot(lotId, user.id);
  }

  @Post('/:processId/vendor-assignments')
  @ApiOperation({ summary: 'Assign vendor to process materials' })
  @ApiResponse({ type: VendorAssignmentResponseDto })
  async assignVendorToProcess(
    @Param('processId') processId: string,
    @Body() assignmentDto: CreateLotVendorAssignmentDto,
    @CurrentUser() user: User
  ): Promise<VendorAssignmentResponseDto> {
    return this.productionProcessService.assignVendorToProcess(processId, assignmentDto, user.id);
  }

  @Get('/:processId/vendor-assignments')
  @ApiOperation({ summary: 'Get vendor assignments for process' })
  @ApiResponse({ type: [VendorAssignmentResponseDto] })
  async getProcessVendorAssignments(
    @Param('processId') processId: string,
    @CurrentUser() user: User
  ): Promise<VendorAssignmentResponseDto[]> {
    return this.productionProcessService.getProcessVendorAssignments(processId, user.id);
  }

  @Put('/vendor-assignments/:assignmentId')
  @ApiOperation({ summary: 'Update vendor assignment' })
  @ApiResponse({ type: VendorAssignmentResponseDto })
  async updateVendorAssignment(
    @Param('assignmentId') assignmentId: string,
    @Body() updateDto: UpdateLotVendorAssignmentDto,
    @CurrentUser() user: User
  ): Promise<VendorAssignmentResponseDto> {
    return this.productionProcessService.updateVendorAssignment(assignmentId, updateDto, user.id);
  }

}