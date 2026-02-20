import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '@/common/supabase/supabase.service';
import {
  CreateQualityInspectionDto,
  UpdateQualityInspectionDto,
  QualityInspectionResponseDto,
  InspectionResultDto,
  InspectionStatus,
  InspectionResult,
} from '../dto/quality-inspection.dto';

@Injectable()
export class QualityInspectionService {
  private readonly logger = new Logger(QualityInspectionService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async createInspection(
    createDto: CreateQualityInspectionDto,
    userId: string,
  ): Promise<QualityInspectionResponseDto> {
    try {
      this.logger.log(`Creating inspection: ${createDto.name} for user: ${userId}`);

      const inspectionData = {
        name: createDto.name,
        description: createDto.description,
        type: createDto.type,
        status: InspectionStatus.PLANNED,
        project_id: createDto.projectId,
        bom_id: createDto.bomId,
        inspector: createDto.inspector,
        planned_date: createDto.plannedDate,
        selected_items: createDto.selectedItems,
        quality_standards: createDto.qualityStandards || [],
        checklist: createDto.checklist,
        metadata: createDto.metadata || {},
        created_by: userId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await this.supabase.client
        .from('quality_inspections')
        .insert(inspectionData)
        .select('*')
        .single();

      if (error) {
        this.logger.error('Failed to create inspection:', error);
        throw new BadRequestException('Failed to create inspection');
      }

      return this.mapToResponseDto(data);
    } catch (error) {
      this.logger.error('Error creating inspection:', error);
      throw error;
    }
  }

  async getInspections(
    userId: string,
    filters: {
      projectId?: string;
      status?: string;
      type?: string;
      inspector?: string;
    } = {},
  ): Promise<QualityInspectionResponseDto[]> {
    try {
      let query = this.supabase.client
        .from('quality_inspections')
        .select(`
          *,
          projects:project_id (id, name),
          boms:bom_id (id, name, version)
        `)
        .order('created_at', { ascending: false });

      if (filters.projectId) {
        query = query.eq('project_id', filters.projectId);
      }

      if (filters.status) {
        query = query.eq('status', filters.status);
      }

      if (filters.type) {
        query = query.eq('type', filters.type);
      }

      if (filters.inspector) {
        query = query.ilike('inspector', `%${filters.inspector}%`);
      }

      const { data, error } = await query;

      if (error) {
        this.logger.error('Failed to get inspections:', error);
        throw new BadRequestException('Failed to retrieve inspections');
      }

      return data.map(this.mapToResponseDto);
    } catch (error) {
      this.logger.error('Error getting inspections:', error);
      throw error;
    }
  }

  async getInspectionById(
    id: string,
    userId: string,
  ): Promise<QualityInspectionResponseDto> {
    try {
      const { data, error } = await this.supabase.client
        .from('quality_inspections')
        .select(`
          *,
          projects:project_id (id, name),
          boms:bom_id (id, name, version),
          quality_inspection_results (*)
        `)
        .eq('id', id)
        .single();

      if (error || !data) {
        throw new NotFoundException('Inspection not found');
      }

      return this.mapToResponseDto(data);
    } catch (error) {
      this.logger.error('Error getting inspection by ID:', error);
      throw error;
    }
  }

  async updateInspection(
    id: string,
    updateDto: UpdateQualityInspectionDto,
    userId: string,
  ): Promise<QualityInspectionResponseDto> {
    try {
      const updateData = {
        ...updateDto,
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await this.supabase.client
        .from('quality_inspections')
        .update(updateData)
        .eq('id', id)
        .select('*')
        .single();

      if (error) {
        this.logger.error('Failed to update inspection:', error);
        throw new BadRequestException('Failed to update inspection');
      }

      return this.mapToResponseDto(data);
    } catch (error) {
      this.logger.error('Error updating inspection:', error);
      throw error;
    }
  }

  async deleteInspection(id: string, userId: string): Promise<void> {
    try {
      const { error } = await this.supabase.client
        .from('quality_inspections')
        .delete()
        .eq('id', id);

      if (error) {
        this.logger.error('Failed to delete inspection:', error);
        throw new BadRequestException('Failed to delete inspection');
      }
    } catch (error) {
      this.logger.error('Error deleting inspection:', error);
      throw error;
    }
  }

  async startInspection(
    id: string,
    userId: string,
  ): Promise<QualityInspectionResponseDto> {
    return this.updateInspection(id, {
      status: InspectionStatus.IN_PROGRESS,
      actualStartDate: new Date().toISOString(),
    }, userId);
  }

  async completeInspection(
    id: string,
    completionData: { notes?: string; finalResult: 'pass' | 'fail' | 'conditional' },
    userId: string,
  ): Promise<QualityInspectionResponseDto> {
    return this.updateInspection(id, {
      status: InspectionStatus.COMPLETED,
      actualEndDate: new Date().toISOString(),
      notes: completionData.notes,
    }, userId);
  }

  async approveInspection(
    id: string,
    approvalData: { approverNotes?: string },
    userId: string,
  ): Promise<QualityInspectionResponseDto> {
    const updateData = {
      status: InspectionStatus.APPROVED,
      approved_by: userId,
      approved_at: new Date().toISOString(),
      notes: approvalData.approverNotes,
    };

    const { data, error } = await this.supabase.client
      .from('quality_inspections')
      .update(updateData)
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      throw new BadRequestException('Failed to approve inspection');
    }

    return this.mapToResponseDto(data);
  }

  async rejectInspection(
    id: string,
    rejectionData: { rejectionReason: string; correctiveAction?: string },
    userId: string,
  ): Promise<QualityInspectionResponseDto> {
    const updateData = {
      status: InspectionStatus.REJECTED,
      rejected_by: userId,
      rejected_at: new Date().toISOString(),
      rejection_reason: rejectionData.rejectionReason,
      notes: rejectionData.correctiveAction,
    };

    const { data, error } = await this.supabase.client
      .from('quality_inspections')
      .update(updateData)
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      throw new BadRequestException('Failed to reject inspection');
    }

    return this.mapToResponseDto(data);
  }

  async submitInspectionResults(
    inspectionId: string,
    resultsDto: InspectionResultDto,
    userId: string,
  ): Promise<any> {
    try {
      const resultData = {
        inspection_id: inspectionId,
        checklist_results: resultsDto.checklistResults,
        overall_result: resultsDto.overallResult,
        notes: resultsDto.notes,
        recommendations: resultsDto.recommendations,
        attachments: resultsDto.attachments || [],
        submitted_by: userId,
        submitted_at: new Date().toISOString(),
      };

      const { data, error } = await this.supabase.client
        .from('quality_inspection_results')
        .upsert(resultData, { onConflict: 'inspection_id' })
        .select('*')
        .single();

      if (error) {
        throw new BadRequestException('Failed to submit results');
      }

      // Update inspection status
      await this.updateInspection(inspectionId, {
        status: InspectionStatus.COMPLETED,
        actualEndDate: new Date().toISOString(),
      }, userId);

      return data;
    } catch (error) {
      this.logger.error('Error submitting inspection results:', error);
      throw error;
    }
  }

  async getInspectionResults(
    inspectionId: string,
    userId: string,
  ): Promise<any> {
    const { data, error } = await this.supabase.client
      .from('quality_inspection_results')
      .select('*')
      .eq('inspection_id', inspectionId)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
      throw new BadRequestException('Failed to get results');
    }

    return data;
  }

  async createNonConformance(
    inspectionId: string,
    nonConformanceData: any,
    userId: string,
  ): Promise<any> {
    const ncData = {
      inspection_id: inspectionId,
      ...nonConformanceData,
      created_by: userId,
      created_at: new Date().toISOString(),
    };

    const { data, error } = await this.supabase.client
      .from('quality_non_conformances')
      .insert(ncData)
      .select('*')
      .single();

    if (error) {
      throw new BadRequestException('Failed to create non-conformance');
    }

    return data;
  }

  async getNonConformances(
    userId: string,
    filters: {
      projectId?: string;
      status?: string;
      severity?: string;
    } = {},
  ): Promise<any[]> {
    let query = this.supabase.client
      .from('quality_non_conformances')
      .select(`
        *,
        quality_inspections!inspection_id (id, name, project_id)
      `)
      .order('created_at', { ascending: false });

    if (filters.projectId) {
      query = query.eq('quality_inspections.project_id', filters.projectId);
    }

    if (filters.status) {
      query = query.eq('status', filters.status);
    }

    if (filters.severity) {
      query = query.eq('severity', filters.severity);
    }

    const { data, error } = await query;

    if (error) {
      throw new BadRequestException('Failed to get non-conformances');
    }

    return data || [];
  }

  private mapToResponseDto(data: any): QualityInspectionResponseDto {
    return {
      id: data.id,
      name: data.name,
      description: data.description,
      type: data.type,
      status: data.status,
      projectId: data.project_id,
      bomId: data.bom_id,
      inspector: data.inspector,
      plannedDate: data.planned_date,
      actualStartDate: data.actual_start_date,
      actualEndDate: data.actual_end_date,
      selectedItems: data.selected_items || [],
      qualityStandards: data.quality_standards || [],
      checklist: data.checklist || [],
      results: data.quality_inspection_results,
      overallResult: data.overall_result,
      notes: data.notes,
      approvedBy: data.approved_by,
      approvedAt: data.approved_at,
      rejectedBy: data.rejected_by,
      rejectedAt: data.rejected_at,
      rejectionReason: data.rejection_reason,
      createdBy: data.created_by,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
      metadata: data.metadata,
      project: data.projects,
      bom: data.boms,
      bomItems: data.bom_items,
      nonConformances: data.quality_non_conformances,
    };
  }
}