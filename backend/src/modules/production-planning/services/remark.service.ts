import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { SupabaseService } from '@/common/supabase/supabase.service';
import { 
  CreateRemarkDto, 
  UpdateRemarkDto, 
  RemarkFilterDto, 
  CreateCommentDto, 
  UpdateCommentDto,
  RemarkResponseDto,
  CommentResponseDto,
  PaginatedRemarksResponseDto,
  RemarkScope
} from '../dto/remark.dto';

@Injectable()
export class RemarkService {
  private readonly logger = new Logger(RemarkService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  async createRemark(createDto: CreateRemarkDto, createdBy: string): Promise<RemarkResponseDto> {
    const supabase = this.supabaseService.getClient();

    try {
      // Validate scope-specific constraints
      await this.validateRemarkScope(createDto);

      const remarkData = {
        lot_id: createDto.lotId,
        title: createDto.title,
        description: createDto.description,
        remark_type: createDto.remarkType,
        priority: createDto.priority,
        status: 'OPEN',
        applies_to: createDto.appliesTo,
        process_id: createDto.processId || null,
        subtask_id: createDto.subtaskId || null,
        bom_part_id: createDto.bomPartId || null,
        context_reference: createDto.contextReference || null,
        created_by: createdBy,
        assigned_to: createDto.assignedTo || null,
        reported_date: new Date().toISOString(),
        due_date: createDto.dueDate || null,
        impact_level: createDto.impactLevel || null,
        estimated_delay_hours: createDto.estimatedDelayHours || 0,
        actual_delay_hours: 0,
        tags: createDto.tags || [],
        attachments: []
      };

      const { data, error } = await supabase
        .from('remarks_and_issues')
        .insert([remarkData])
        .select()
        .single();

      if (error) {
        this.logger.error('Database error creating remark:', error);
        throw new BadRequestException('Failed to create remark');
      }

      return this.mapToResponseDto(data);
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof ConflictException) {
        throw error;
      }
      this.logger.error('Error creating remark:', error);
      throw new BadRequestException('Failed to create remark');
    }
  }

  async updateRemark(id: string, updateDto: UpdateRemarkDto, userId: string): Promise<RemarkResponseDto> {
    const supabase = this.supabaseService.getClient();

    // First, get the remark to check permissions
    const { data: remark, error: fetchError } = await supabase
      .from('remarks_and_issues')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !remark) {
      throw new NotFoundException('Remark not found');
    }

    // Business rule: Only creator or assignee can update
    if (remark.created_by !== userId && remark.assigned_to !== userId) {
      throw new BadRequestException('You can only update remarks you created or are assigned to');
    }

    // Auto-set resolved date when status changes to RESOLVED
    const updateData = { ...updateDto };
    if (updateDto.status === 'RESOLVED' && remark.status !== 'RESOLVED') {
      updateData.resolvedDate = new Date().toISOString();
    }

    // Clear resolved date when status changes from RESOLVED
    if (updateDto.status && updateDto.status !== 'RESOLVED' && remark.status === 'RESOLVED') {
      updateData.resolvedDate = undefined;
      updateData.resolutionNotes = undefined;
    }

    // Convert camelCase to snake_case for database
    const dbUpdateData: any = {};
    if (updateData.title) dbUpdateData.title = updateData.title;
    if (updateData.description !== undefined) dbUpdateData.description = updateData.description;
    if (updateData.priority) dbUpdateData.priority = updateData.priority;
    if (updateData.status) dbUpdateData.status = updateData.status;
    if (updateData.assignedTo !== undefined) dbUpdateData.assigned_to = updateData.assignedTo;
    if (updateData.dueDate !== undefined) dbUpdateData.due_date = updateData.dueDate;
    if (updateData.resolutionNotes !== undefined) dbUpdateData.resolution_notes = updateData.resolutionNotes;
    if (updateData.resolvedDate !== undefined) dbUpdateData.resolved_date = updateData.resolvedDate;
    if (updateData.impactLevel !== undefined) dbUpdateData.impact_level = updateData.impactLevel;
    if (updateData.estimatedDelayHours !== undefined) dbUpdateData.estimated_delay_hours = updateData.estimatedDelayHours;
    if (updateData.actualDelayHours !== undefined) dbUpdateData.actual_delay_hours = updateData.actualDelayHours;
    if (updateData.tags !== undefined) dbUpdateData.tags = updateData.tags;

    const { data, error } = await supabase
      .from('remarks_and_issues')
      .update(dbUpdateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      this.logger.error('Database error updating remark:', error);
      throw new BadRequestException('Failed to update remark');
    }

    return this.mapToResponseDto(data);
  }

  async deleteRemark(id: string, userId: string): Promise<void> {
    const supabase = this.supabaseService.getClient();

    // First, get the remark to check permissions
    const { data: remark, error: fetchError } = await supabase
      .from('remarks_and_issues')
      .select('id, created_by')
      .eq('id', id)
      .single();

    if (fetchError || !remark) {
      throw new NotFoundException('Remark not found');
    }

    // Business rule: Only creator can delete
    if (remark.created_by !== userId) {
      throw new BadRequestException('You can only delete remarks you created');
    }

    const { error } = await supabase
      .from('remarks_and_issues')
      .delete()
      .eq('id', id);

    if (error) {
      this.logger.error('Database error deleting remark:', error);
      throw new BadRequestException('Failed to delete remark');
    }
  }

  async getRemarkById(id: string): Promise<RemarkResponseDto> {
    const supabase = this.supabaseService.getClient();

    const { data, error } = await supabase
      .from('remarks_and_issues')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      throw new NotFoundException('Remark not found');
    }

    return this.mapToResponseDto(data);
  }

  async getRemarks(filterDto: RemarkFilterDto): Promise<PaginatedRemarksResponseDto> {
    const supabase = this.supabaseService.getClient();

    let query = supabase
      .from('remarks_and_issues')
      .select('*', { count: 'exact' });

    // Apply filters
    if (filterDto.lotId) {
      query = query.eq('lot_id', filterDto.lotId);
    }

    if (filterDto.remarkType) {
      query = query.eq('remark_type', filterDto.remarkType);
    }

    if (filterDto.priority) {
      query = query.eq('priority', filterDto.priority);
    }

    if (filterDto.status) {
      query = query.eq('status', filterDto.status);
    }

    if (filterDto.appliesTo) {
      query = query.eq('applies_to', filterDto.appliesTo);
    }

    if (filterDto.assignedTo) {
      query = query.eq('assigned_to', filterDto.assignedTo);
    }

    if (filterDto.createdBy) {
      query = query.eq('created_by', filterDto.createdBy);
    }

    if (filterDto.search) {
      query = query.or(`title.ilike.%${filterDto.search}%,description.ilike.%${filterDto.search}%`);
    }

    // Add pagination
    const page = filterDto.page || 1;
    const limit = filterDto.limit || 20;
    const offset = (page - 1) * limit;

    query = query
      .order('reported_date', { ascending: false })
      .order('priority', { ascending: false })
      .range(offset, offset + limit - 1);

    const { data, error, count } = await query;

    if (error) {
      this.logger.error('Database error fetching remarks:', error);
      throw new BadRequestException('Failed to fetch remarks');
    }

    return {
      data: (data || []).map(remark => this.mapToResponseDto(remark)),
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit),
      },
    };
  }

  async getRemarksByLot(lotId: string, filterDto?: Partial<RemarkFilterDto>): Promise<RemarkResponseDto[]> {
    const supabase = this.supabaseService.getClient();

    let query = supabase
      .from('remarks_and_issues')
      .select('*')
      .eq('lot_id', lotId);

    if (filterDto?.status) {
      query = query.eq('status', filterDto.status);
    }

    if (filterDto?.remarkType) {
      query = query.eq('remark_type', filterDto.remarkType);
    }

    if (filterDto?.priority) {
      query = query.eq('priority', filterDto.priority);
    }

    query = query
      .order('priority', { ascending: false })
      .order('reported_date', { ascending: false });

    const { data, error } = await query;

    if (error) {
      this.logger.error('Database error fetching remarks by lot:', error);
      throw new BadRequestException('Failed to fetch remarks for lot');
    }

    return (data || []).map(remark => this.mapToResponseDto(remark));
  }

  // Comment methods
  async createComment(createDto: CreateCommentDto, authorId: string, authorName?: string): Promise<CommentResponseDto> {
    const supabase = this.supabaseService.getClient();

    // Verify remark exists
    const { data: remark, error: remarkError } = await supabase
      .from('remarks_and_issues')
      .select('id')
      .eq('id', createDto.remarkId)
      .single();

    if (remarkError || !remark) {
      throw new NotFoundException('Remark not found');
    }

    // Calculate thread level if it's a reply
    let threadLevel = 0;
    if (createDto.parentCommentId) {
      const { data: parentComment, error: parentError } = await supabase
        .from('remarks_comments')
        .select('thread_level')
        .eq('id', createDto.parentCommentId)
        .single();
      
      if (parentError || !parentComment) {
        throw new BadRequestException('Parent comment not found');
      }
      
      threadLevel = parentComment.thread_level + 1;
    }

    const commentData = {
      remark_id: createDto.remarkId,
      comment_text: createDto.commentText,
      author_id: authorId,
      author_name: authorName,
      parent_comment_id: createDto.parentCommentId || null,
      thread_level: threadLevel,
    };

    const { data, error } = await supabase
      .from('remarks_comments')
      .insert([commentData])
      .select()
      .single();

    if (error) {
      this.logger.error('Database error creating comment:', error);
      throw new BadRequestException('Failed to create comment');
    }

    return this.mapCommentToResponseDto(data);
  }

  async updateComment(id: string, updateDto: UpdateCommentDto, userId: string): Promise<CommentResponseDto> {
    const supabase = this.supabaseService.getClient();

    // Check permissions
    const { data: comment, error: fetchError } = await supabase
      .from('remarks_comments')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError || !comment) {
      throw new NotFoundException('Comment not found');
    }

    if (comment.author_id !== userId) {
      throw new BadRequestException('You can only update your own comments');
    }

    const { data, error } = await supabase
      .from('remarks_comments')
      .update({ comment_text: updateDto.commentText })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      this.logger.error('Database error updating comment:', error);
      throw new BadRequestException('Failed to update comment');
    }

    return this.mapCommentToResponseDto(data);
  }

  async deleteComment(id: string, userId: string): Promise<void> {
    const supabase = this.supabaseService.getClient();

    // Check permissions
    const { data: comment, error: fetchError } = await supabase
      .from('remarks_comments')
      .select('id, author_id')
      .eq('id', id)
      .single();

    if (fetchError || !comment) {
      throw new NotFoundException('Comment not found');
    }

    if (comment.author_id !== userId) {
      throw new BadRequestException('You can only delete your own comments');
    }

    const { error } = await supabase
      .from('remarks_comments')
      .delete()
      .eq('id', id);

    if (error) {
      this.logger.error('Database error deleting comment:', error);
      throw new BadRequestException('Failed to delete comment');
    }
  }

  async getCommentsByRemark(remarkId: string): Promise<CommentResponseDto[]> {
    const supabase = this.supabaseService.getClient();

    const { data, error } = await supabase
      .from('remarks_comments')
      .select('*')
      .eq('remark_id', remarkId)
      .order('created_at', { ascending: true });

    if (error) {
      this.logger.error('Database error fetching comments:', error);
      throw new BadRequestException('Failed to fetch comments');
    }

    return (data || []).map(comment => this.mapCommentToResponseDto(comment));
  }

  // Analytics methods
  async getRemarkStats(lotId: string): Promise<{
    total: number;
    byStatus: Record<string, number>;
    byPriority: Record<string, number>;
    byType: Record<string, number>;
  }> {
    const supabase = this.supabaseService.getClient();

    const { data, error } = await supabase
      .from('remarks_and_issues')
      .select('status, priority, remark_type')
      .eq('lot_id', lotId);

    if (error) {
      this.logger.error('Database error fetching remark stats:', error);
      throw new BadRequestException('Failed to fetch remark statistics');
    }

    const remarks = data || [];
    const stats = {
      total: remarks.length,
      byStatus: {} as Record<string, number>,
      byPriority: {} as Record<string, number>,
      byType: {} as Record<string, number>,
    };

    remarks.forEach(remark => {
      stats.byStatus[remark.status] = (stats.byStatus[remark.status] || 0) + 1;
      stats.byPriority[remark.priority] = (stats.byPriority[remark.priority] || 0) + 1;
      stats.byType[remark.remark_type] = (stats.byType[remark.remark_type] || 0) + 1;
    });

    return stats;
  }

  // Private helper methods
  private async validateRemarkScope(createDto: CreateRemarkDto): Promise<void> {
    const supabase = this.supabaseService.getClient();

    // Validate that lot exists
    const { data: lot, error: lotError } = await supabase
      .from('production_lots')
      .select('id')
      .eq('id', createDto.lotId)
      .single();

    if (lotError || !lot) {
      throw new BadRequestException('Production lot not found');
    }

    // Validate process/subtask references based on scope
    if (createDto.appliesTo === RemarkScope.PROCESS && !createDto.processId) {
      throw new BadRequestException('Process ID is required when scope is PROCESS');
    }

    if (createDto.appliesTo === RemarkScope.SUBTASK) {
      if (!createDto.processId || !createDto.subtaskId) {
        throw new BadRequestException('Process ID and Subtask ID are required when scope is SUBTASK');
      }
    }

    if (createDto.appliesTo === RemarkScope.BOM_PART) {
      if (!createDto.processId || !createDto.subtaskId || !createDto.bomPartId) {
        throw new BadRequestException('Process ID, Subtask ID, and BOM Part ID are required when scope is BOM_PART');
      }
    }

    // Clear irrelevant IDs based on scope
    if (createDto.appliesTo === RemarkScope.LOT) {
      createDto.processId = undefined;
      createDto.subtaskId = undefined;
      createDto.bomPartId = undefined;
    } else if (createDto.appliesTo === RemarkScope.PROCESS) {
      createDto.subtaskId = undefined;
      createDto.bomPartId = undefined;
    } else if (createDto.appliesTo === RemarkScope.SUBTASK) {
      createDto.bomPartId = undefined;
    }
  }

  private mapToResponseDto(remark: any): RemarkResponseDto {
    return {
      id: remark.id,
      lotId: remark.lot_id,
      title: remark.title,
      description: remark.description,
      remarkType: remark.remark_type,
      priority: remark.priority,
      status: remark.status,
      appliesTo: remark.applies_to,
      processId: remark.process_id,
      subtaskId: remark.subtask_id,
      bomPartId: remark.bom_part_id,
      contextReference: remark.context_reference,
      createdBy: remark.created_by,
      assignedTo: remark.assigned_to,
      reportedDate: remark.reported_date,
      dueDate: remark.due_date,
      resolvedDate: remark.resolved_date,
      resolutionNotes: remark.resolution_notes,
      impactLevel: remark.impact_level,
      estimatedDelayHours: remark.estimated_delay_hours || 0,
      actualDelayHours: remark.actual_delay_hours || 0,
      tags: remark.tags || [],
      attachments: remark.attachments || [],
      createdAt: remark.created_at,
      updatedAt: remark.updated_at,
      commentsCount: 0, // We'd need a separate query to get this efficiently
    };
  }

  private mapCommentToResponseDto(comment: any): CommentResponseDto {
    return {
      id: comment.id,
      remarkId: comment.remark_id,
      commentText: comment.comment_text,
      authorId: comment.author_id,
      authorName: comment.author_name,
      parentCommentId: comment.parent_comment_id,
      threadLevel: comment.thread_level,
      createdAt: comment.created_at,
      updatedAt: comment.updated_at,
    };
  }
}