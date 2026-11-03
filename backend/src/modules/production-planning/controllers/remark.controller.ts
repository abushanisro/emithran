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
  UseGuards,
  Request,
  HttpStatus,
  HttpCode,
  ParseUUIDPipe,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
  ApiBearerAuth,
  ApiBody,
} from '@nestjs/swagger';
import { RequestAuthGuard } from '../../../common/guards/request-auth.guard';
import { RemarkService } from '../services/remark.service';
import {
  CreateRemarkDto,
  UpdateRemarkDto,
  RemarkFilterDto,
  CreateCommentDto,
  UpdateCommentDto,
  RemarkResponseDto,
  CommentResponseDto,
  PaginatedRemarksResponseDto,
} from '../dto/remark.dto';
import { OrgRole } from '../../../common/authz/authz-policy';

@ApiTags('Remarks & Issues')
@ApiBearerAuth()
@OrgRole('member')
@Controller('remarks')
@UseGuards(RequestAuthGuard)
export class RemarkController {
  constructor(private readonly remarkService: RemarkService) {}

  @Post()
  @ApiOperation({ 
    summary: 'Create a new remark',
    description: 'Creates a new remark or issue for a production lot'
  })
  @ApiResponse({ 
    status: HttpStatus.CREATED, 
    description: 'Remark created successfully',
    schema: { type: 'object' }
  })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Invalid input data' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized access' })
  @ApiBody({ type: CreateRemarkDto })
  async createRemark(
    @Body(ValidationPipe) createRemarkDto: CreateRemarkDto,
    @Request() req: any,
  ): Promise<RemarkResponseDto> {
    const userId = req.user?.id;
    return this.remarkService.createRemark(createRemarkDto, userId);
  }

  @OrgRole('viewer')
  @Get()
  @ApiOperation({ 
    summary: 'Get filtered remarks',
    description: 'Retrieves remarks with pagination and filtering options'
  })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'Remarks retrieved successfully',
    schema: { type: 'object' }
  })
  @ApiQuery({ name: 'lotId', required: false, description: 'Filter by production lot ID' })
  @ApiQuery({ name: 'remarkType', required: false, description: 'Filter by remark type' })
  @ApiQuery({ name: 'priority', required: false, description: 'Filter by priority level' })
  @ApiQuery({ name: 'status', required: false, description: 'Filter by status' })
  @ApiQuery({ name: 'appliesTo', required: false, description: 'Filter by scope (LOT/PROCESS/SUBTASK)' })
  @ApiQuery({ name: 'assignedTo', required: false, description: 'Filter by assigned user' })
  @ApiQuery({ name: 'search', required: false, description: 'Search in title and description' })
  @ApiQuery({ name: 'page', required: false, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, description: 'Items per page (default: 20, max: 100)' })
  async getRemarks(
    @Query(ValidationPipe) filterDto: RemarkFilterDto,
  ): Promise<PaginatedRemarksResponseDto> {
    return this.remarkService.getRemarks(filterDto);
  }

  @OrgRole('viewer')
  @Get('lot/:lotId')
  @ApiOperation({ 
    summary: 'Get remarks for a specific lot',
    description: 'Retrieves all remarks associated with a production lot'
  })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'Lot remarks retrieved successfully',
    schema: { type: 'array' }
  })
  @ApiParam({ name: 'lotId', description: 'Production lot ID' })
  @ApiQuery({ name: 'status', required: false, description: 'Filter by status' })
  @ApiQuery({ name: 'remarkType', required: false, description: 'Filter by remark type' })
  @ApiQuery({ name: 'priority', required: false, description: 'Filter by priority' })
  async getRemarksByLot(
    @Param('lotId', ParseUUIDPipe) lotId: string,
    @Query() filterDto?: Partial<RemarkFilterDto>,
  ): Promise<RemarkResponseDto[]> {
    return this.remarkService.getRemarksByLot(lotId, filterDto);
  }


  @OrgRole('viewer')
  @Get(':id')
  @ApiOperation({ 
    summary: 'Get remark by ID',
    description: 'Retrieves a specific remark with its details and comments'
  })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'Remark retrieved successfully',
    schema: { type: 'object' }
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Remark not found' })
  @ApiParam({ name: 'id', description: 'Remark ID' })
  async getRemarkById(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<RemarkResponseDto> {
    return this.remarkService.getRemarkById(id);
  }

  @Put(':id')
  @ApiOperation({ 
    summary: 'Update a remark',
    description: 'Updates an existing remark. Only creator or assignee can update.'
  })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'Remark updated successfully',
    schema: { type: 'object' }
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Remark not found' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Not authorized to update this remark' })
  @ApiParam({ name: 'id', description: 'Remark ID' })
  @ApiBody({ type: UpdateRemarkDto })
  async updateRemark(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(ValidationPipe) updateRemarkDto: UpdateRemarkDto,
    @Request() req: any,
  ): Promise<RemarkResponseDto> {
    const userId = req.user?.id;
    return this.remarkService.updateRemark(id, updateRemarkDto, userId);
  }

  @Delete(':id')
  @ApiOperation({ 
    summary: 'Delete a remark',
    description: 'Deletes a remark. Only the creator can delete.'
  })
  @ApiResponse({ status: HttpStatus.NO_CONTENT, description: 'Remark deleted successfully' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Remark not found' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Not authorized to delete this remark' })
  @ApiParam({ name: 'id', description: 'Remark ID' })
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteRemark(
    @Param('id', ParseUUIDPipe) id: string,
    @Request() req: any,
  ): Promise<void> {
    const userId = req.user?.id;
    return this.remarkService.deleteRemark(id, userId);
  }

  // Comment endpoints
  @Post(':remarkId/comments')
  @ApiOperation({ 
    summary: 'Add a comment to a remark',
    description: 'Creates a new comment for a remark. Supports threaded discussions.'
  })
  @ApiResponse({ 
    status: HttpStatus.CREATED, 
    description: 'Comment created successfully',
    schema: { type: 'object' }
  })
  @ApiParam({ name: 'remarkId', description: 'Remark ID' })
  @ApiBody({ type: CreateCommentDto })
  async createComment(
    @Param('remarkId', ParseUUIDPipe) remarkId: string,
    @Body(ValidationPipe) createCommentDto: CreateCommentDto,
    @Request() req: any,
  ): Promise<CommentResponseDto> {
    const userId = req.user?.id;
    const userName = req.user?.name || req.user?.email;
    
    // Ensure remarkId matches the one in the DTO
    createCommentDto.remarkId = remarkId;
    
    return this.remarkService.createComment(createCommentDto, userId, userName);
  }

  @OrgRole('viewer')
  @Get(':remarkId/comments')
  @ApiOperation({ 
    summary: 'Get comments for a remark',
    description: 'Retrieves all comments for a specific remark in threaded order'
  })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'Comments retrieved successfully',
    schema: { type: 'array' }
  })
  @ApiParam({ name: 'remarkId', description: 'Remark ID' })
  async getCommentsByRemark(
    @Param('remarkId', ParseUUIDPipe) remarkId: string,
  ): Promise<CommentResponseDto[]> {
    return this.remarkService.getCommentsByRemark(remarkId);
  }

  @Put('comments/:commentId')
  @ApiOperation({ 
    summary: 'Update a comment',
    description: 'Updates a comment. Only the author can update their own comments.'
  })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'Comment updated successfully',
    schema: { type: 'object' }
  })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Comment not found' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Not authorized to update this comment' })
  @ApiParam({ name: 'commentId', description: 'Comment ID' })
  @ApiBody({ type: UpdateCommentDto })
  async updateComment(
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @Body(ValidationPipe) updateCommentDto: UpdateCommentDto,
    @Request() req: any,
  ): Promise<CommentResponseDto> {
    const userId = req.user?.id;
    return this.remarkService.updateComment(commentId, updateCommentDto, userId);
  }

  @Delete('comments/:commentId')
  @ApiOperation({ 
    summary: 'Delete a comment',
    description: 'Deletes a comment. Only the author can delete their own comments.'
  })
  @ApiResponse({ status: HttpStatus.NO_CONTENT, description: 'Comment deleted successfully' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Comment not found' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Not authorized to delete this comment' })
  @ApiParam({ name: 'commentId', description: 'Comment ID' })
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteComment(
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @Request() req: any,
  ): Promise<void> {
    const userId = req.user?.id;
    return this.remarkService.deleteComment(commentId, userId);
  }
}