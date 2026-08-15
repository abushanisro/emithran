import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { Logger } from '../../../common/logger/logger.service';
import {
  CreateTimelineDto,
  UpdateTimelineDto,
  CreateProcessTrackingDto,
  UpdateProcessTrackingDto,
  CreateSubtaskTrackingDto,
  UpdateSubtaskTrackingDto,
  CreateBomTrackingDto,
  UpdateBomTrackingDto,
  QueryTrackingDto,
  ChangeType,
  EntityType,
} from '../dto/process-tracking.dto';

@Injectable()
export class ProcessTrackingService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly logger: Logger,
  ) {}

  // =====================================================
  // TIMELINE MANAGEMENT
  // =====================================================

  async createTimeline(createDto: CreateTimelineDto, userId: string, accessToken: string) {
    this.logger.log(`Creating timeline for lot ${createDto.production_lot_id}`, 'ProcessTrackingService');

    const client = this.supabaseService.getClient(accessToken);

    // Validate that the production lot exists and user has access
    const { data: lot, error: lotError } = await client
      .from('production_lots')
      .select('id, lot_number')
      .eq('id', createDto.production_lot_id)
      .single();

    if (lotError || !lot) {
      throw new NotFoundException('Production lot not found or access denied');
    }

    // Create the timeline
    const { data: timeline, error: timelineError } = await client
      .from('process_tracking_timelines')
      .insert({
        production_lot_id: createDto.production_lot_id,
        timeline_start_date: createDto.timeline_start_date,
        timeline_end_date: createDto.timeline_end_date,
        total_weeks: createDto.total_weeks,
        week_config: createDto.week_config,
        created_by: userId,
        updated_by: userId,
      })
      .select()
      .single();

    if (timelineError) {
      this.logger.error('Failed to create timeline', timelineError.message, 'ProcessTrackingService');
      throw new BadRequestException('Failed to create timeline');
    }

    // Log the creation
    await this.logTrackingChange(
      timeline.id,
      EntityType.TIMELINE,
      timeline.id,
      ChangeType.SCHEDULE_UPDATE,
      null,
      timeline,
      userId,
      'Timeline created',
      accessToken,
    );

    return {
      data: timeline,
      timestamp: new Date().toISOString(),
    };
  }

  async getTimelineByLot(lotId: string, accessToken: string) {
    this.logger.log(`Fetching timeline for lot ${lotId}`, 'ProcessTrackingService');

    const client = this.supabaseService.getClient(accessToken);

    const { data: timeline, error } = await client
      .from('process_tracking_timelines')
      .select('*')
      .eq('production_lot_id', lotId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return {
          data: null,
          message: 'No timeline found for this production lot',
          timestamp: new Date().toISOString(),
        };
      }
      this.logger.error('Failed to fetch timeline', error.message, 'ProcessTrackingService');
      throw new BadRequestException('Failed to fetch timeline');
    }

    return {
      data: timeline,
      timestamp: new Date().toISOString(),
    };
  }

  async updateTimeline(timelineId: string, updateDto: UpdateTimelineDto, userId: string, accessToken: string) {
    this.logger.log(`Updating timeline ${timelineId}`, 'ProcessTrackingService');

    const client = this.supabaseService.getClient(accessToken);

    // Get current timeline for audit
    const { data: currentTimeline } = await client
      .from('process_tracking_timelines')
      .select('*')
      .eq('id', timelineId)
      .single();

    // Update the timeline
    const { data: timeline, error } = await client
      .from('process_tracking_timelines')
      .update({
        ...updateDto,
        updated_by: userId,
      })
      .eq('id', timelineId)
      .select()
      .single();

    if (error) {
      this.logger.error('Failed to update timeline', error.message, 'ProcessTrackingService');
      throw new BadRequestException('Failed to update timeline');
    }

    // Log the update
    await this.logTrackingChange(
      timelineId,
      EntityType.TIMELINE,
      timelineId,
      ChangeType.TIMELINE_ADJUSTMENT,
      currentTimeline,
      timeline,
      userId,
      'Timeline updated',
      accessToken,
    );

    return {
      data: timeline,
      timestamp: new Date().toISOString(),
    };
  }

  // =====================================================
  // PROCESS TRACKING
  // =====================================================

  async createProcessTracking(createDto: CreateProcessTrackingDto, userId: string, accessToken: string) {
    this.logger.log(`Creating process tracking for process ${createDto.production_process_id}`, 'ProcessTrackingService');

    const client = this.supabaseService.getClient(accessToken);

    const { data: tracking, error } = await client
      .from('process_schedule_tracking')
      .insert({
        ...createDto,
        last_updated_by: userId,
      })
      .select()
      .single();

    if (error) {
      this.logger.error('Failed to create process tracking', error.message, 'ProcessTrackingService');
      throw new BadRequestException('Failed to create process tracking');
    }

    // Log the creation
    await this.logTrackingChange(
      createDto.timeline_id,
      EntityType.PROCESS,
      tracking.id,
      ChangeType.SCHEDULE_UPDATE,
      null,
      tracking,
      userId,
      'Process tracking created',
      accessToken,
    );

    return {
      data: tracking,
      timestamp: new Date().toISOString(),
    };
  }

  async getProcessTracking(timelineId: string, query: QueryTrackingDto, accessToken: string) {
    this.logger.log(`Fetching process tracking for timeline ${timelineId}`, 'ProcessTrackingService');

    const client = this.supabaseService.getClient(accessToken);

    let queryBuilder = client
      .from('process_schedule_tracking')
      .select(`
        *,
        production_processes (
          id,
          process_name,
          description,
          status
        )
      `)
      .eq('timeline_id', timelineId);

    if (query.status) {
      queryBuilder = queryBuilder.eq('status', query.status);
    }

    const { data: processTracking, error } = await queryBuilder.order('created_at');

    if (error) {
      this.logger.error('Failed to fetch process tracking', error.message, 'ProcessTrackingService');
      throw new BadRequestException('Failed to fetch process tracking');
    }

    return {
      data: processTracking || [],
      timestamp: new Date().toISOString(),
    };
  }

  async updateProcessTracking(trackingId: string, updateDto: UpdateProcessTrackingDto, userId: string, accessToken: string) {
    this.logger.log(`Updating process tracking ${trackingId}`, 'ProcessTrackingService');

    const client = this.supabaseService.getClient(accessToken);

    // Get current tracking for audit
    const { data: currentTracking } = await client
      .from('process_schedule_tracking')
      .select('*, timeline_id')
      .eq('id', trackingId)
      .single();

    // Update the tracking
    const { data: tracking, error } = await client
      .from('process_schedule_tracking')
      .update({
        ...updateDto,
        last_updated_by: userId,
      })
      .eq('id', trackingId)
      .select()
      .single();

    if (error) {
      this.logger.error('Failed to update process tracking', error.message, 'ProcessTrackingService');
      throw new BadRequestException('Failed to update process tracking');
    }

    // Determine change type
    const changeType = updateDto.status && updateDto.status !== currentTracking?.status 
      ? ChangeType.STATUS_CHANGE 
      : updateDto.completion_percentage !== undefined 
        ? ChangeType.PROGRESS_UPDATE 
        : ChangeType.SCHEDULE_UPDATE;

    // Log the update
    await this.logTrackingChange(
      currentTracking.timeline_id,
      EntityType.PROCESS,
      trackingId,
      changeType,
      currentTracking,
      tracking,
      userId,
      'Process tracking updated',
      accessToken,
    );

    return {
      data: tracking,
      timestamp: new Date().toISOString(),
    };
  }

  // =====================================================
  // SUBTASK TRACKING
  // =====================================================

  async createSubtaskTracking(createDto: CreateSubtaskTrackingDto, userId: string, accessToken: string) {
    this.logger.log(`Creating subtask tracking for subtask ${createDto.subtask_id}`, 'ProcessTrackingService');

    const client = this.supabaseService.getClient(accessToken);

    const { data: tracking, error } = await client
      .from('subtask_schedule_tracking')
      .insert({
        ...createDto,
        last_updated_by: userId,
      })
      .select()
      .single();

    if (error) {
      this.logger.error('Failed to create subtask tracking', error.message, 'ProcessTrackingService');
      throw new BadRequestException('Failed to create subtask tracking');
    }

    // Log the creation
    await this.logTrackingChange(
      createDto.timeline_id,
      EntityType.SUBTASK,
      tracking.id,
      ChangeType.SCHEDULE_UPDATE,
      null,
      tracking,
      userId,
      'Subtask tracking created',
      accessToken,
    );

    return {
      data: tracking,
      timestamp: new Date().toISOString(),
    };
  }

  async getSubtaskTracking(processTrackingId: string, accessToken: string) {
    this.logger.log(`Fetching subtask tracking for process ${processTrackingId}`, 'ProcessTrackingService');

    const client = this.supabaseService.getClient(accessToken);

    const { data: subtaskTracking, error } = await client
      .from('subtask_schedule_tracking')
      .select(`
        *,
        process_subtasks (
          id,
          task_name,
          description,
          status
        )
      `)
      .eq('production_process_id', processTrackingId)
      .order('created_at');

    if (error) {
      this.logger.error('Failed to fetch subtask tracking', error.message, 'ProcessTrackingService');
      throw new BadRequestException('Failed to fetch subtask tracking');
    }

    return {
      data: subtaskTracking || [],
      timestamp: new Date().toISOString(),
    };
  }

  async updateSubtaskTracking(trackingId: string, updateDto: UpdateSubtaskTrackingDto, userId: string, accessToken: string) {
    this.logger.log(`Updating subtask tracking ${trackingId}`, 'ProcessTrackingService');

    const client = this.supabaseService.getClient(accessToken);

    // Get current tracking for audit
    const { data: currentTracking } = await client
      .from('subtask_schedule_tracking')
      .select('*, timeline_id')
      .eq('id', trackingId)
      .single();

    // Update the tracking
    const { data: tracking, error } = await client
      .from('subtask_schedule_tracking')
      .update({
        ...updateDto,
        last_updated_by: userId,
      })
      .eq('id', trackingId)
      .select()
      .single();

    if (error) {
      this.logger.error('Failed to update subtask tracking', error.message, 'ProcessTrackingService');
      throw new BadRequestException('Failed to update subtask tracking');
    }

    // Determine change type
    const changeType = updateDto.status && updateDto.status !== currentTracking?.status 
      ? ChangeType.STATUS_CHANGE 
      : updateDto.completion_percentage !== undefined 
        ? ChangeType.PROGRESS_UPDATE 
        : ChangeType.SCHEDULE_UPDATE;

    // Log the update
    await this.logTrackingChange(
      currentTracking.timeline_id,
      EntityType.SUBTASK,
      trackingId,
      changeType,
      currentTracking,
      tracking,
      userId,
      'Subtask tracking updated',
      accessToken,
    );

    return {
      data: tracking,
      timestamp: new Date().toISOString(),
    };
  }

  // =====================================================
  // BOM ITEM TRACKING
  // =====================================================

  async createBomTracking(createDto: CreateBomTrackingDto, userId: string, accessToken: string) {
    this.logger.log(`Creating BOM tracking for BOM item ${createDto.bom_item_id}`, 'ProcessTrackingService');

    const client = this.supabaseService.getClient(accessToken);

    const { data: tracking, error } = await client
      .from('bom_item_schedule_tracking')
      .insert({
        ...createDto,
        last_updated_by: userId,
      })
      .select()
      .single();

    if (error) {
      this.logger.error('Failed to create BOM tracking', error.message, 'ProcessTrackingService');
      throw new BadRequestException('Failed to create BOM tracking');
    }

    // Log the creation
    await this.logTrackingChange(
      createDto.timeline_id,
      EntityType.BOM_ITEM,
      tracking.id,
      ChangeType.SCHEDULE_UPDATE,
      null,
      tracking,
      userId,
      'BOM item tracking created',
      accessToken,
    );

    return {
      data: tracking,
      timestamp: new Date().toISOString(),
    };
  }

  async getBomTracking(subtaskTrackingId: string, accessToken: string) {
    this.logger.log(`Fetching BOM tracking for subtask ${subtaskTrackingId}`, 'ProcessTrackingService');

    const client = this.supabaseService.getClient(accessToken);

    const { data: bomTracking, error } = await client
      .from('bom_item_schedule_tracking')
      .select('*')
      .eq('subtask_tracking_id', subtaskTrackingId)
      .order('created_at');

    if (error) {
      this.logger.error('Failed to fetch BOM tracking', error.message, 'ProcessTrackingService');
      throw new BadRequestException('Failed to fetch BOM tracking');
    }

    return {
      data: bomTracking || [],
      timestamp: new Date().toISOString(),
    };
  }

  async updateBomTracking(trackingId: string, updateDto: UpdateBomTrackingDto, userId: string, accessToken: string) {
    this.logger.log(`Updating BOM tracking ${trackingId}`, 'ProcessTrackingService');

    const client = this.supabaseService.getClient(accessToken);

    // Get current tracking for audit
    const { data: currentTracking } = await client
      .from('bom_item_schedule_tracking')
      .select('*, timeline_id')
      .eq('id', trackingId)
      .single();

    // Update the tracking
    const { data: tracking, error } = await client
      .from('bom_item_schedule_tracking')
      .update({
        ...updateDto,
        last_updated_by: userId,
      })
      .eq('id', trackingId)
      .select()
      .single();

    if (error) {
      this.logger.error('Failed to update BOM tracking', error.message, 'ProcessTrackingService');
      throw new BadRequestException('Failed to update BOM tracking');
    }

    // Determine change type
    const changeType = updateDto.status && updateDto.status !== currentTracking?.status 
      ? ChangeType.STATUS_CHANGE 
      : updateDto.completion_percentage !== undefined 
        ? ChangeType.PROGRESS_UPDATE 
        : ChangeType.SCHEDULE_UPDATE;

    // Log the update
    await this.logTrackingChange(
      currentTracking.timeline_id,
      EntityType.BOM_ITEM,
      trackingId,
      changeType,
      currentTracking,
      tracking,
      userId,
      'BOM item tracking updated',
      accessToken,
    );

    return {
      data: tracking,
      timestamp: new Date().toISOString(),
    };
  }

  // =====================================================
  // BULK OPERATIONS
  // =====================================================

  async setupCompleteTimeline(setupData: any, userId: string, accessToken: string) {
    this.logger.log(`Setting up complete timeline for lot ${setupData.lotId}`, 'ProcessTrackingService');

    const client = this.supabaseService.getClient(accessToken);

    try {
      // Start transaction
      const { data, error } = await client.rpc('setup_complete_timeline', {
        setup_data: setupData,
        user_id: userId
      });

      if (error) {
        this.logger.error('Failed to setup complete timeline', error.message, 'ProcessTrackingService');
        throw new BadRequestException('Failed to setup complete timeline');
      }

      return {
        data: data,
        message: 'Complete timeline setup successfully',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error('Error in setupCompleteTimeline', error, 'ProcessTrackingService');
      throw new BadRequestException('Failed to setup timeline');
    }
  }

  async bulkUpdateProgress(progressData: any[], userId: string, accessToken: string) {
    this.logger.log(`Bulk updating progress for ${progressData.length} items`, 'ProcessTrackingService');

    const results = [];

    for (const item of progressData) {
      try {
        let updateResult;
        
        switch (item.entity_type) {
          case EntityType.PROCESS:
            updateResult = await this.updateProcessTracking(
              item.entity_id, 
              { completion_percentage: item.completion_percentage, status: item.status },
              userId, 
              accessToken
            );
            break;
            
          case EntityType.SUBTASK:
            updateResult = await this.updateSubtaskTracking(
              item.entity_id, 
              { completion_percentage: item.completion_percentage, status: item.status },
              userId, 
              accessToken
            );
            break;
            
          case EntityType.BOM_ITEM:
            updateResult = await this.updateBomTracking(
              item.entity_id, 
              { completion_percentage: item.completion_percentage, status: item.status, completed_quantity: item.completed_quantity },
              userId, 
              accessToken
            );
            break;
            
          default:
            throw new BadRequestException(`Unknown entity type: ${item.entity_type}`);
        }
        
        results.push({
          entity_id: item.entity_id,
          entity_type: item.entity_type,
          success: true,
          data: updateResult.data
        });
      } catch (error) {
        results.push({
          entity_id: item.entity_id,
          entity_type: item.entity_type,
          success: false,
          error: error.message
        });
      }
    }

    return {
      data: results,
      summary: {
        total: progressData.length,
        successful: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
      },
      timestamp: new Date().toISOString(),
    };
  }

  // =====================================================
  // GANTT CHART DATA
  // =====================================================

  async getCompleteGanttData(lotId: string, includeHistory: boolean, accessToken: string) {
    this.logger.log(`Fetching complete Gantt data for lot ${lotId}`, 'ProcessTrackingService');

    const client = this.supabaseService.getClient(accessToken);

    // Get timeline
    const { data: timeline } = await client
      .from('process_tracking_timelines')
      .select('*')
      .eq('production_lot_id', lotId)
      .single();

    if (!timeline) {
      throw new NotFoundException('No timeline found for this production lot');
    }

    // Get all tracking data
    const [
      { data: processTracking },
      { data: subtaskTracking },
      { data: bomTracking }
    ] = await Promise.all([
      client
        .from('process_schedule_tracking')
        .select(`
          *,
          production_processes (
            id,
            process_name,
            description,
            status,
            process_sequence
          )
        `)
        .eq('timeline_id', timeline.id)
        .order('created_at'),

      client
        .from('subtask_schedule_tracking')
        .select(`
          *,
          process_subtasks (
            id,
            task_name,
            description,
            status,
            task_sequence
          )
        `)
        .eq('timeline_id', timeline.id)
        .order('created_at'),

      client
        .from('bom_item_schedule_tracking')
        .select('*')
        .eq('timeline_id', timeline.id)
        .order('created_at')
    ]);

    // Get history if requested
    let history = [];
    if (includeHistory) {
      const { data: historyData } = await client
        .from('tracking_updates_log')
        .select('*')
        .eq('timeline_id', timeline.id)
        .order('created_at', { ascending: false })
        .limit(100);
      
      history = historyData || [];
    }

    return {
      data: {
        timeline,
        processes: processTracking || [],
        subtasks: subtaskTracking || [],
        bomItems: bomTracking || [],
        history,
      },
      timestamp: new Date().toISOString(),
    };
  }

  // =====================================================
  // TRACKING HISTORY & AUDIT
  // =====================================================

  async getTrackingHistory(timelineId: string, query: QueryTrackingDto, accessToken: string) {
    this.logger.log(`Fetching tracking history for timeline ${timelineId}`, 'ProcessTrackingService');

    const client = this.supabaseService.getClient(accessToken);

    let queryBuilder = client
      .from('tracking_updates_log')
      .select('*')
      .eq('timeline_id', timelineId);

    if (query.entity_type) {
      queryBuilder = queryBuilder.eq('entity_type', query.entity_type);
    }

    if (query.start_date && query.end_date) {
      queryBuilder = queryBuilder
        .gte('created_at', query.start_date)
        .lte('created_at', query.end_date);
    }

    // Pagination
    const page = query.page || 1;
    const limit = query.limit || 50;
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const { data: history, error, count } = await queryBuilder
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) {
      this.logger.error('Failed to fetch tracking history', error.message, 'ProcessTrackingService');
      throw new BadRequestException('Failed to fetch tracking history');
    }

    return {
      data: history || [],
      pagination: {
        page,
        limit,
        total: count || 0,
        pages: Math.ceil((count || 0) / limit),
      },
      timestamp: new Date().toISOString(),
    };
  }

  // =====================================================
  // UTILITY METHODS
  // =====================================================

  async calculateOptimalTimeline(calculationData: any, accessToken: string) {
    this.logger.log(`Calculating optimal timeline for lot ${calculationData.lotId}`, 'ProcessTrackingService');

    // This would implement smart timeline calculation based on:
    // - Process dependencies
    // - Resource availability
    // - Material lead times
    // - Historical performance data

    // For now, return a basic calculation
    return {
      data: {
        suggested_start_date: calculationData.constraints.earliest_start || new Date().toISOString().split('T')[0],
        suggested_end_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 30 days from now
        total_weeks: 4,
        critical_path: [],
        recommendations: [
          'Consider parallel execution of independent processes',
          'Review material lead times for early procurement',
          'Allocate additional resources to critical path items'
        ]
      },
      timestamp: new Date().toISOString(),
    };
  }

  async deleteTimeline(timelineId: string, userId: string, accessToken: string) {
    this.logger.log(`Deleting timeline ${timelineId}`, 'ProcessTrackingService');

    const client = this.supabaseService.getClient(accessToken);

    // Delete timeline (cascade will handle related data)
    const { error } = await client
      .from('process_tracking_timelines')
      .delete()
      .eq('id', timelineId);

    if (error) {
      this.logger.error('Failed to delete timeline', error.message, 'ProcessTrackingService');
      throw new BadRequestException('Failed to delete timeline');
    }

    return {
      message: 'Timeline deleted successfully',
      timestamp: new Date().toISOString(),
    };
  }

  // =====================================================
  // PRIVATE HELPER METHODS
  // =====================================================

  private async logTrackingChange(
    timelineId: string,
    entityType: EntityType,
    entityId: string,
    changeType: ChangeType,
    oldData: any,
    newData: any,
    changedBy: string,
    reason: string,
    accessToken: string,
  ) {
    try {
      const client = this.supabaseService.getClient(accessToken);
      
      await client.from('tracking_updates_log').insert({
        timeline_id: timelineId,
        entity_type: entityType,
        entity_id: entityId,
        change_type: changeType,
        old_data: oldData,
        new_data: newData,
        changed_by: changedBy,
        change_reason: reason,
      });
    } catch (error) {
      this.logger.error('Failed to log tracking change', error, 'ProcessTrackingService');
      // Don't throw error for logging failures
    }
  }
}