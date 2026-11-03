interface User { id: string; email: string; [key: string]: any; }
import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { RequestAuthGuard } from '@/common/guards/request-auth.guard';
import { CurrentUser } from '@/common/decorators/current-user.decorator';
import { SubtaskService } from '../services/subtask.service';
import { CreateSubtaskDto, UpdateSubtaskDto, SubtaskResponseDto } from '../dto/subtask.dto';
import { OrgRole } from '../../../common/authz/authz-policy';

@ApiTags('Production Subtasks')
@OrgRole('member')
@Controller('api/production-planning/processes/subtasks')
@UseGuards(RequestAuthGuard)
export class SubtaskController {
  constructor(private readonly subtaskService: SubtaskService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new subtask' })
  @ApiResponse({ type: SubtaskResponseDto })
  async createSubtask(
    @Body() createDto: CreateSubtaskDto,
    @CurrentUser() user: User
  ): Promise<SubtaskResponseDto> {
    return this.subtaskService.createSubtask(createDto, user.id);
  }

  @OrgRole('viewer')
  @Get(':id')
  @ApiOperation({ summary: 'Get subtask by ID' })
  @ApiResponse({ type: SubtaskResponseDto })
  async getSubtaskById(
    @Param('id') id: string,
    @CurrentUser() user: User
  ): Promise<SubtaskResponseDto> {
    return this.subtaskService.getSubtaskById(id, user.id);
  }


  @Put(':id')
  @ApiOperation({ summary: 'Update subtask' })
  @ApiResponse({ type: SubtaskResponseDto })
  async updateSubtask(
    @Param('id') id: string,
    @Body() updateDto: UpdateSubtaskDto,
    @CurrentUser() user: User
  ): Promise<SubtaskResponseDto> {
    return this.subtaskService.updateSubtask(id, updateDto, user.id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete subtask' })
  async deleteSubtask(
    @Param('id') id: string,
    @CurrentUser() user: User
  ): Promise<void> {
    return this.subtaskService.deleteSubtask(id, user.id);
  }
}