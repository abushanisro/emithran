import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '@/common/database/database.service';
import type { DbClient } from '@/common/db/postgrest-client';
import {
  CreateQualityInspectionDto,
  UpdateQualityInspectionDto,
  QualityInspectionResponseDto,
  InspectionResultDto,
  InspectionStatus,
} from '../dto/quality-inspection.dto';
import {
  CreateDetailedInspectionReportDto,
  DetailedInspectionReportResponseDto,
} from '../dto/detailed-inspection-report.dto';
import { qualityDbError } from '../quality-db-error';

/**
 * Quality inspections and the rows that hang off them. Every query runs as the signed-in user, so row-level security
 * (migration 936) limits it to the caller's organizations: another organization's inspection is simply not found.
 */
@Injectable()
export class QualityInspectionService {
  private readonly logger = new Logger(QualityInspectionService.name);

  constructor(private readonly database: DatabaseService) {}

  private db(): DbClient {
    return this.database.getUserClient();
  }

  /** The organization that owns an inspection the caller can see; 404 when they cannot see it. */
  private async getInspectionOrganization(inspectionId: string): Promise<string> {
    const { data, error } = await this.db()
      .from('quality_inspections')
      .select('organization_id')
      .eq('id', inspectionId)
      .single();
    if (error) throw qualityDbError(error, 'read the inspection');
    return data.organization_id;
  }

  async createInspection(
    createDto: CreateQualityInspectionDto,
    userId: string,
    organizationId: string,
  ): Promise<QualityInspectionResponseDto> {
    this.logger.log(`Creating inspection for project ${createDto.projectId} (user ${userId}, organization ${organizationId})`);

    const inspectionData = {
      name: createDto.name,
      description: createDto.description,
      type: createDto.type,
      status: InspectionStatus.PLANNED,
      project_id: createDto.projectId,
      bom_id: createDto.bomId,
      lot_id: createDto.lotId || null,
      inspector: createDto.inspector,
      planned_date: createDto.plannedDate,
      selected_items: createDto.selectedItems,
      quality_standards: createDto.qualityStandards || [],
      checklist: createDto.checklist,
      metadata: createDto.metadata || {},
      organization_id: organizationId,
      created_by: userId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await this.db()
      .from('quality_inspections')
      .insert(inspectionData)
      .select('*')
      .single();

    if (error) {
      this.logger.error(`Failed to create inspection: ${error.code} ${error.message}`);
      throw qualityDbError(error, 'create the inspection');
    }

    return this.mapToResponseDto(data);
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
    let query = this.db()
      .from('quality_inspections')
      .select('*')
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
      this.logger.error(`Failed to get inspections for user ${userId}: ${error.code} ${error.message}`);
      throw qualityDbError(error, 'retrieve inspections');
    }

    return (data || []).map(this.mapToResponseDto);
  }

  async getInspectionById(
    id: string,
    userId: string,
  ): Promise<QualityInspectionResponseDto> {
    const { data, error } = await this.db()
      .from('quality_inspections')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code !== 'PGRST116') {
        this.logger.error(`Failed to get inspection ${id} for user ${userId}: ${error.code} ${error.message}`);
      }
      throw qualityDbError(error, 'read the inspection');
    }

    return this.mapToResponseDto(data);
  }

  async updateInspection(
    id: string,
    updateDto: UpdateQualityInspectionDto,
    userId: string,
  ): Promise<QualityInspectionResponseDto> {
    // Transform camelCase DTO fields to snake_case database columns
    const updateData: any = {
      updated_at: new Date().toISOString(),
    };

    // Map DTO fields to database column names - only fields that exist in UpdateQualityInspectionDto
    if (updateDto.name !== undefined) updateData.name = updateDto.name;
    if (updateDto.description !== undefined) updateData.description = updateDto.description;
    if (updateDto.status !== undefined) updateData.status = updateDto.status;
    if (updateDto.inspector !== undefined) updateData.inspector = updateDto.inspector;
    if (updateDto.plannedDate !== undefined) updateData.planned_date = updateDto.plannedDate;
    if (updateDto.actualStartDate !== undefined) updateData.actual_start_date = updateDto.actualStartDate;
    if (updateDto.actualEndDate !== undefined) updateData.actual_end_date = updateDto.actualEndDate;
    if (updateDto.qualityStandards !== undefined) updateData.quality_standards = updateDto.qualityStandards;
    if (updateDto.notes !== undefined) updateData.notes = updateDto.notes;
    if (updateDto.metadata !== undefined) updateData.metadata = updateDto.metadata;

    this.logger.log(`Updating inspection ${id} (user ${userId})`);

    const { data, error } = await this.db()
      .from('quality_inspections')
      .update(updateData)
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      this.logger.error(`Failed to update inspection ${id}: ${error.code} ${error.message}`);
      throw qualityDbError(error, 'update the inspection');
    }

    return this.mapToResponseDto(data);
  }

  async deleteInspection(id: string, userId: string): Promise<void> {
    const { data, error } = await this.db()
      .from('quality_inspections')
      .delete()
      .eq('id', id)
      .select('id');

    if (error) {
      this.logger.error(`Failed to delete inspection ${id} (user ${userId}): ${error.code} ${error.message}`);
      throw qualityDbError(error, 'delete the inspection');
    }
    if (!data || data.length === 0) {
      throw new NotFoundException('Inspection not found');
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
    approvalData: { approverNotes?: string } = {},
    userId: string,
    userEmail?: string,
  ): Promise<QualityInspectionResponseDto> {
    // First, get the inspection details to access selected items
    const { data: inspection, error: inspectionError } = await this.db()
      .from('quality_inspections')
      .select('*')
      .eq('id', id)
      .single();

    if (inspectionError) {
      throw qualityDbError(inspectionError, 'read the inspection');
    }

    // Update the inspection status
    const updateData = {
      status: InspectionStatus.APPROVED,
      approved_by: userId,
      approved_by_name: userEmail || userId,
      approved_at: new Date().toISOString(),
      notes: approvalData.approverNotes,
    };

    this.logger.log(`Approving inspection ${id} (user ${userId})`);

    const { data: updatedInspection, error: updateError } = await this.db()
      .from('quality_inspections')
      .update(updateData)
      .eq('id', id)
      .select('*')
      .single();

    if (updateError) {
      this.logger.error(`Failed to approve inspection ${id}: ${updateError.code} ${updateError.message}`);
      throw qualityDbError(updateError, 'approve the inspection');
    }

    // Create quality approved items for each selected item
    if (inspection.selected_items && Array.isArray(inspection.selected_items)) {
      const qualityApprovedItems = inspection.selected_items.map((item: any) => ({
        bom_item_id: typeof item === 'string' ? item : (item.bomItemId || item.bom_item_id || item.id),
        inspection_id: id,
        organization_id: inspection.organization_id,
        approved_quantity: (typeof item === 'string' ? 1 : (item.quantity || item.approved_quantity || 1)),
        approval_status: 'approved',
        approval_notes: approvalData.approverNotes || 'Approved via quality inspection',
        delivery_ready: true,
        delivery_ready_date: new Date().toISOString(),
        approved_by: userId,
        approved_at: new Date().toISOString(),
        qc_certificate_number: null,
        quality_grade: 'A',
        created_by: userId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));

      const { error: approvedItemsError } = await this.db()
        .from('quality_approved_items')
        .insert(qualityApprovedItems);

      if (approvedItemsError) {
        // The inspection is approved but its items are not marked approved: report it, so the user can reset and approve again.
        this.logger.error(
          `Inspection ${id} approved but its ${qualityApprovedItems.length} approved items could not be recorded: ${approvedItemsError.code} ${approvedItemsError.message}`,
        );
        throw qualityDbError(approvedItemsError, 'record the approved items of the inspection');
      }
      this.logger.log(`Recorded ${qualityApprovedItems.length} quality approved items for inspection ${id}`);
    }

    return this.mapToResponseDto(updatedInspection);
  }

  async rejectInspection(
    id: string,
    rejectionData: { rejectionReason: string; correctiveAction?: string },
    userId: string,
    userEmail?: string,
  ): Promise<QualityInspectionResponseDto> {
    const updateData = {
      status: InspectionStatus.REJECTED,
      rejected_by: userId,
      rejected_by_name: userEmail || userId,
      rejected_at: new Date().toISOString(),
      rejection_reason: rejectionData.rejectionReason,
      notes: rejectionData.correctiveAction,
    };

    const { data, error } = await this.db()
      .from('quality_inspections')
      .update(updateData)
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      throw qualityDbError(error, 'reject the inspection');
    }

    return this.mapToResponseDto(data);
  }

  async resetInspectionStatus(
    id: string,
    userId: string,
  ): Promise<QualityInspectionResponseDto> {
    const { data: inspection, error: fetchError } = await this.db()
      .from('quality_inspections')
      .select('status')
      .eq('id', id)
      .single();

    if (fetchError) {
      throw qualityDbError(fetchError, 'read the inspection');
    }

    if (inspection.status !== InspectionStatus.APPROVED && inspection.status !== InspectionStatus.REJECTED) {
      throw new BadRequestException('Only approved or rejected inspections can be reset');
    }

    // If undoing approval, delete the quality_approved_items that were created for this inspection
    if (inspection.status === InspectionStatus.APPROVED) {
      const { error: deleteError } = await this.db()
        .from('quality_approved_items')
        .delete()
        .eq('inspection_id', id);

      if (deleteError) {
        this.logger.error(`Could not delete quality_approved_items for inspection ${id}: ${deleteError.code} ${deleteError.message}`);
        throw qualityDbError(deleteError, 'remove the approved items of the inspection');
      }
    }

    this.logger.log(`Resetting inspection ${id} (user ${userId})`);

    const { data, error } = await this.db()
      .from('quality_inspections')
      .update({
        status: InspectionStatus.COMPLETED,
        approved_by: null,
        approved_by_name: null,
        approved_at: null,
        rejected_by: null,
        rejected_by_name: null,
        rejected_at: null,
        rejection_reason: null,
      })
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      throw qualityDbError(error, 'reset the inspection status');
    }

    return this.mapToResponseDto(data);
  }

  async submitInspectionResults(
    inspectionId: string,
    resultsDto: InspectionResultDto,
    userId: string,
  ): Promise<any> {
    const organizationId = await this.getInspectionOrganization(inspectionId);

    const resultData = {
      inspection_id: inspectionId,
      organization_id: organizationId,
      checklist_results: resultsDto.checklistResults,
      overall_result: resultsDto.overallResult,
      notes: resultsDto.notes,
      recommendations: resultsDto.recommendations,
      attachments: resultsDto.attachments || [],
      submitted_by: userId,
      submitted_at: new Date().toISOString(),
    };

    const { data, error } = await this.db()
      .from('quality_inspection_results')
      .upsert(resultData, { onConflict: 'inspection_id' })
      .select('*')
      .single();

    if (error) {
      throw qualityDbError(error, 'submit the inspection results');
    }

    // Update inspection status
    await this.updateInspection(inspectionId, {
      status: InspectionStatus.COMPLETED,
      actualEndDate: new Date().toISOString(),
    }, userId);

    return data;
  }

  async getInspectionResults(
    inspectionId: string,
    userId: string,
  ): Promise<any> {
    // 404 for an inspection the caller cannot see, rather than "no results yet"
    await this.getInspectionOrganization(inspectionId);

    const { data, error } = await this.db()
      .from('quality_inspection_results')
      .select('*')
      .eq('inspection_id', inspectionId)
      .maybeSingle();

    if (error) {
      this.logger.error(`Failed to get results of inspection ${inspectionId} (user ${userId}): ${error.code} ${error.message}`);
      throw qualityDbError(error, 'read the inspection results');
    }

    return data;
  }

  async createNonConformance(
    inspectionId: string,
    nonConformanceData: any,
    userId: string,
  ): Promise<any> {
    const organizationId = await this.getInspectionOrganization(inspectionId);

    // The body describes the non-conformance; which inspection and organization it belongs to, and who made it, are set here.
    const ncData = {
      ...nonConformanceData,
      inspection_id: inspectionId,
      organization_id: organizationId,
      created_by: userId,
      created_at: new Date().toISOString(),
    };

    const { data, error } = await this.db()
      .from('quality_non_conformances')
      .insert(ncData)
      .select('*')
      .single();

    if (error) {
      throw qualityDbError(error, 'create the non-conformance');
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
    // !inner: a project filter on the embedded inspection must drop the non-conformances of other projects, not just blank the embed
    let query = this.db()
      .from('quality_non_conformances')
      .select(`
        *,
        quality_inspections!inspection_id!inner (id, name, project_id)
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
      this.logger.error(`Failed to get non-conformances for user ${userId}: ${error.code} ${error.message}`);
      throw qualityDbError(error, 'retrieve non-conformances');
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
      approvedBy: data.approved_by_name || data.approved_by,
      approvedAt: data.approved_at,
      rejectedBy: data.rejected_by_name || data.rejected_by,
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

  // ============================================================================
  // DETAILED INSPECTION REPORTS
  // ============================================================================

  async saveDetailedInspectionReport(
    inspectionId: string,
    reportDto: CreateDetailedInspectionReportDto,
    userId: string,
  ): Promise<DetailedInspectionReportResponseDto> {
    try {
      this.logger.log(`Saving detailed report for inspection ${inspectionId}`);

      // The inspection must be one the caller can see (404 otherwise); the report belongs to its organization.
      const organizationId = await this.getInspectionOrganization(inspectionId);

      // Prepare data for database
      const reportData = {
        inspection_id: inspectionId,
        organization_id: organizationId,
        part_name: reportDto.balloonDrawing.partName,
        material: reportDto.balloonDrawing.material,
        surface_treatment: reportDto.balloonDrawing.surfaceTreatment || null,
        drawing_title: reportDto.balloonDrawing.drawingTitle,
        drawing_size: reportDto.balloonDrawing.drawingSize,
        balloon_annotations: reportDto.balloonDrawing.balloonAnnotations,
        company_name: reportDto.finalInspectionReport.companyName,
        revision_number: reportDto.finalInspectionReport.revisionNumber || null,
        inspection_date: reportDto.finalInspectionReport.inspectionDate,
        raw_material: reportDto.finalInspectionReport.rawMaterial,
        inspection_by: reportDto.finalInspectionReport.inspectionBy,
        approved_by: reportDto.finalInspectionReport.approvedBy || null,
        general_remarks: reportDto.finalInspectionReport.generalRemarks || null,
        status: reportDto.finalInspectionReport.status,
        samples: reportDto.inspectionTable.samples,
        measurements: reportDto.inspectionTable.measurements,
      };

      // Upsert the detailed report
      const { data, error } = await this.db()
        .from('detailed_inspection_reports')
        .upsert(reportData, { 
          onConflict: 'inspection_id',
          ignoreDuplicates: false 
        })
        .select()
        .single();

      if (error) {
        this.logger.error(`Failed to save detailed report: ${error.message}`, error);
        throw new BadRequestException('Failed to save detailed inspection report');
      }

      return this.transformDetailedReportResponse(data);
    } catch (error) {
      this.logger.error(`Error saving detailed inspection report: ${error.message}`, error.stack);
      throw error;
    }
  }

  async getDetailedInspectionReport(
    inspectionId: string,
    userId: string,
  ): Promise<DetailedInspectionReportResponseDto | null> {
    try {
      this.logger.log(`Fetching detailed report for inspection ${inspectionId}`);

      // Check if inspection exists and user has access
      const inspection = await this.getInspectionById(inspectionId, userId);
      if (!inspection) {
        throw new NotFoundException('Inspection not found');
      }

      const { data, error } = await this.db()
        .from('detailed_inspection_reports')
        .select('*')
        .eq('inspection_id', inspectionId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') { // No rows — report not created yet
          return null;
        }
        this.logger.error(`Failed to fetch detailed report: ${error.message}`, error);
        throw new BadRequestException('Failed to fetch detailed inspection report');
      }

      return data ? this.transformDetailedReportResponse(data) : null;
    } catch (error) {
      this.logger.error(`Error fetching detailed inspection report: ${error.message}`, error.stack);
      throw error;
    }
  }

  async deleteDetailedInspectionReport(
    inspectionId: string,
    userId: string,
  ): Promise<{ deleted: boolean }> {
    try {
      this.logger.log(`Deleting detailed report for inspection ${inspectionId}`);

      // Check if inspection exists and user has access
      const inspection = await this.getInspectionById(inspectionId, userId);
      if (!inspection) {
        throw new NotFoundException('Inspection not found');
      }

      const { error } = await this.db()
        .from('detailed_inspection_reports')
        .delete()
        .eq('inspection_id', inspectionId);

      if (error) {
        this.logger.error(`Failed to delete detailed report: ${error.message}`, error);
        throw new BadRequestException('Failed to delete detailed inspection report');
      }

      return { deleted: true };
    } catch (error) {
      this.logger.error(`Error deleting detailed inspection report: ${error.message}`, error.stack);
      throw error;
    }
  }

  private transformDetailedReportResponse(data: any): DetailedInspectionReportResponseDto {
    return {
      inspectionId: data.inspection_id,
      balloonDrawing: {
        partName: data.part_name,
        material: data.material,
        surfaceTreatment: data.surface_treatment,
        drawingTitle: data.drawing_title,
        drawingSize: data.drawing_size,
        balloonAnnotations: data.balloon_annotations || [],
      },
      finalInspectionReport: {
        companyName: data.company_name,
        revisionNumber: data.revision_number,
        inspectionDate: data.inspection_date,
        rawMaterial: data.raw_material,
        inspectionBy: data.inspection_by,
        approvedBy: data.approved_by,
        generalRemarks: data.general_remarks,
        status: data.status,
      },
      inspectionTable: {
        samples: data.samples,
        measurements: data.measurements || [],
      },
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }
}