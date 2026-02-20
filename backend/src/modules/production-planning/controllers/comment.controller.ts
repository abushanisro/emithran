interface User { id: string; email: string; [key: string]: any; }
import { 
  Controller, 
  Post, 
  Get, 
  Put, 
  Delete, 
  Body, 
  Param, 
  Query,
  UseGuards,
  Request 
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { CommentService } from '../services/comment.service';
import { SupabaseAuthGuard } from '@/common/guards/supabase-auth.guard';
import { 
  CreateCommentDto, 
  UpdateCommentDto, 
  CommentResponseDto,
  CommentFilterDto 
} from '../dto/comment.dto';

@ApiTags('Comments')
@Controller('api/comments')
@UseGuards(SupabaseAuthGuard)
@ApiBearerAuth()
export class CommentController {
  constructor(private readonly commentService: CommentService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new comment for a remark' })
  @ApiResponse({ 
    status: 201, 
    description: 'Comment created successfully',
    type: CommentResponseDto 
  })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  @ApiResponse({ status: 404, description: 'Remark not found' })
  async createComment(
    @Body() createDto: CreateCommentDto,
    @Request() req: any
  ): Promise<CommentResponseDto> {
    const userId = req.user?.id;
    return this.commentService.createComment(createDto, userId);
  }

  @Get('remark/:remarkId')
  @ApiOperation({ summary: 'Get comments for a specific remark' })
  @ApiResponse({ 
    status: 200, 
    description: 'Comments retrieved successfully',
    type: [CommentResponseDto] 
  })
  @ApiResponse({ status: 400, description: 'Invalid remark ID' })
  async getCommentsByRemark(
    @Param('remarkId') remarkId: string,
    @Query() filters: CommentFilterDto
  ): Promise<CommentResponseDto[]> {
    return this.commentService.getCommentsByRemark(remarkId, filters);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a comment' })
  @ApiResponse({ 
    status: 200, 
    description: 'Comment updated successfully',
    type: CommentResponseDto 
  })
  @ApiResponse({ status: 400, description: 'Invalid input data' })
  @ApiResponse({ status: 404, description: 'Comment not found or unauthorized' })
  async updateComment(
    @Param('id') commentId: string,
    @Body() updateDto: UpdateCommentDto,
    @Request() req: any
  ): Promise<CommentResponseDto> {
    const userId = req.user?.id;
    return this.commentService.updateComment(commentId, updateDto, userId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a comment' })
  @ApiResponse({ status: 204, description: 'Comment deleted successfully' })
  @ApiResponse({ status: 404, description: 'Comment not found or unauthorized' })
  async deleteComment(
    @Param('id') commentId: string,
    @Request() req: any
  ): Promise<void> {
    const userId = req.user?.id;
    return this.commentService.deleteComment(commentId, userId);
  }
}