import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '@/common/supabase/supabase.service';
import { 
  CreateCommentDto, 
  UpdateCommentDto, 
  CommentResponseDto,
  CommentFilterDto 
} from '../dto/comment.dto';

@Injectable()
export class CommentService {
  private readonly logger = new Logger(CommentService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  /**
   * Create a new comment for a remark
   */
  async createComment(createDto: CreateCommentDto, userId: string): Promise<CommentResponseDto> {
    try {
      const supabase = this.supabaseService.getClient();

      // Verify the remark exists
      const { data: remarkExists } = await supabase
        .from('remarks_and_issues')
        .select('id')
        .eq('id', createDto.remarkId)
        .single();

      if (!remarkExists) {
        throw new NotFoundException('Remark not found');
      }

      const commentData = {
        remark_id: createDto.remarkId,
        comment_text: createDto.commentText,
        created_by: userId
      };

      const { data, error } = await supabase
        .from('remark_comments')
        .insert([commentData])
        .select()
        .single();

      if (error) {
        this.logger.error('Database error creating comment:', error);
        throw new BadRequestException('Failed to create comment');
      }

      // Update the comments count on the remark
      await supabase
        .from('remarks_and_issues')
        .update({ 
          comments_count: await this.getCommentsCount(createDto.remarkId)
        })
        .eq('id', createDto.remarkId);

      return this.mapToResponseDto(data);
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException('Failed to create comment');
    }
  }

  /**
   * Get comments for a remark
   */
  async getCommentsByRemark(remarkId: string, filters: CommentFilterDto = {}): Promise<CommentResponseDto[]> {
    try {
      const supabase = this.supabaseService.getClient();
      
      let query = supabase
        .from('remark_comments')
        .select('*')
        .eq('remark_id', remarkId)
        .order('created_at', { ascending: true });

      // Apply pagination if provided
      if (filters.page && filters.limit) {
        const offset = (filters.page - 1) * filters.limit;
        query = query.range(offset, offset + filters.limit - 1);
      }

      const { data, error } = await query;

      if (error) {
        this.logger.error('Database error fetching comments:', error);
        throw new BadRequestException('Failed to fetch comments');
      }

      return data ? data.map((comment: any) => this.mapToResponseDto(comment)) : [];
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException('Failed to fetch comments');
    }
  }

  /**
   * Update a comment
   */
  async updateComment(
    commentId: string, 
    updateDto: UpdateCommentDto, 
    userId: string
  ): Promise<CommentResponseDto> {
    try {
      const supabase = this.supabaseService.getClient();

      // Check if comment exists and user owns it
      const { data: existingComment } = await supabase
        .from('remark_comments')
        .select('*')
        .eq('id', commentId)
        .eq('created_by', userId)
        .single();

      if (!existingComment) {
        throw new NotFoundException('Comment not found or unauthorized');
      }

      const updateData = {
        ...(updateDto.commentText && { comment_text: updateDto.commentText }),
        updated_at: new Date().toISOString()
      };

      const { data, error } = await supabase
        .from('remark_comments')
        .update(updateData)
        .eq('id', commentId)
        .eq('created_by', userId)
        .select()
        .single();

      if (error) {
        this.logger.error('Database error updating comment:', error);
        throw new BadRequestException('Failed to update comment');
      }

      return this.mapToResponseDto(data);
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException('Failed to update comment');
    }
  }

  /**
   * Delete a comment
   */
  async deleteComment(commentId: string, userId: string): Promise<void> {
    try {
      const supabase = this.supabaseService.getClient();

      // Get the comment to check ownership and get remark_id
      const { data: comment } = await supabase
        .from('remark_comments')
        .select('remark_id, created_by')
        .eq('id', commentId)
        .single();

      if (!comment) {
        throw new NotFoundException('Comment not found');
      }

      if (comment.created_by !== userId) {
        throw new BadRequestException('Unauthorized to delete this comment');
      }

      const { error } = await supabase
        .from('remark_comments')
        .delete()
        .eq('id', commentId)
        .eq('created_by', userId);

      if (error) {
        this.logger.error('Database error deleting comment:', error);
        throw new BadRequestException('Failed to delete comment');
      }

      // Update the comments count on the remark
      await supabase
        .from('remarks_and_issues')
        .update({ 
          comments_count: await this.getCommentsCount(comment.remark_id)
        })
        .eq('id', comment.remark_id);

    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw new BadRequestException('Failed to delete comment');
    }
  }

  /**
   * Get comments count for a remark
   */
  private async getCommentsCount(remarkId: string): Promise<number> {
    const supabase = this.supabaseService.getClient();
    
    const { count, error } = await supabase
      .from('remark_comments')
      .select('id', { count: 'exact' })
      .eq('remark_id', remarkId);

    if (error) {
      this.logger.error('Error getting comments count:', error);
      return 0;
    }

    return count || 0;
  }

  /**
   * Map database row to response DTO
   */
  private mapToResponseDto(comment: any): CommentResponseDto {
    return {
      id: comment.id,
      remarkId: comment.remark_id,
      commentText: comment.comment_text,
      createdBy: comment.created_by,
      createdAt: comment.created_at,
      updatedAt: comment.updated_at
    };
  }
}