import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { Logger } from '../../common/logger/logger.service';
import {
  CreateSupplierEvaluationGroupDto,
  UpdateSupplierEvaluationGroupDto,
  SupplierEvaluationGroupDto,
  SupplierEvaluationGroupSummaryDto,
} from './dto/supplier-evaluation-group.dto';

@Injectable()
export class SupplierEvaluationGroupsService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly logger: Logger,
  ) {}

  async create(
    userId: string,
    createDto: CreateSupplierEvaluationGroupDto,
    accessToken: string,
    organizationId?: string,
  ): Promise<SupplierEvaluationGroupDto> {
    this.logger.log(`Creating supplier evaluation group for user ${userId}`);

    try {
      // Generate evaluation group name if not provided
      const evaluationName = createDto.name || `Evaluation ${new Date().toISOString().slice(0, 16)}`;

      // 1. Create the main evaluation group
      const supabase = this.supabaseService.getClient(accessToken);
      const { data: groupData, error: groupError } = await supabase
        .from('supplier_evaluation_groups')
        .insert({
          user_id: userId,
          organization_id: organizationId ?? null,
          project_id: createDto.projectId,
          name: evaluationName,
          description: createDto.description,
          notes: createDto.notes,
          status: 'active',
        })
        .select('*')
        .single();

      if (groupError) {
        this.logger.error('Error creating evaluation group:', groupError.message);
        throw new Error(`Failed to create evaluation group: ${groupError.message}`);
      }

      const groupId = groupData.id;

      // 2. Insert BOM items
      if (createDto.bomItems?.length > 0) {
        const bomItemsData = createDto.bomItems.map(item => ({
          evaluation_group_id: groupId,
          organization_id: organizationId ?? null,
          bom_item_id: item.id,
          bom_item_name: item.name,
          part_number: item.partNumber,
          material: item.material,
          quantity: item.quantity,
        }));

        const { error: bomError } = await supabase
          .from('supplier_evaluation_group_bom_items')
          .insert(bomItemsData);

        if (bomError) {
          this.logger.error('Error creating BOM items:', bomError.message);
          throw new Error(`Failed to create BOM items: ${bomError.message}`);
        }
      }

      // 3. Insert processes
      if (createDto.processes?.length > 0) {
        const processesData = createDto.processes.map(process => ({
          evaluation_group_id: groupId,
          organization_id: organizationId ?? null,
          process_id: process.id,
          process_name: process.name,
          process_group: process.processGroup,
          process_type: process.type,
          is_predefined: process.isPredefined,
        }));

        const { error: processError } = await supabase
          .from('supplier_evaluation_group_processes')
          .insert(processesData);

        if (processError) {
          this.logger.error('Error creating processes:', processError.message);
          throw new Error(`Failed to create processes: ${processError.message}`);
        }
      }

      // 4. Return the complete evaluation group
      return this.findOne(userId, groupId, accessToken);
    } catch (error) {
      this.logger.error('Failed to create supplier evaluation group:', error);
      throw error;
    }
  }

  async findAll(
    userId: string,
    accessToken: string,
  ): Promise<SupplierEvaluationGroupSummaryDto[]> {
    this.logger.log(`Finding all evaluation groups for user ${userId}`);

    try {
      const supabase = this.supabaseService.getClient(accessToken);
      const { data, error } = await supabase
        .from('supplier_evaluation_groups')
        .select(`
          id,
          project_id,
          name,
          description,
          notes,
          status,
          created_at,
          updated_at,
          projects!inner(name),
          supplier_evaluation_group_bom_items(count),
          supplier_evaluation_group_processes(count)
        `)
        .order('created_at', { ascending: false });

      if (error) {
        this.logger.error('Error fetching all evaluation groups:', error.message);
        throw new Error(`Failed to fetch evaluation groups: ${error.message}`);
      }

      return (data || []).map((group: any) => ({
        id: group.id,
        projectId: group.project_id,
        projectName: group.projects?.name,
        name: group.name,
        description: group.description,
        notes: group.notes,
        status: group.status,
        createdAt: new Date(group.created_at),
        updatedAt: new Date(group.updated_at),
        bomItemsCount: group.supplier_evaluation_group_bom_items?.length || 0,
        processesCount: group.supplier_evaluation_group_processes?.length || 0,
      }));
    } catch (error) {
      this.logger.error('Failed to find all evaluation groups:', error);
      throw error;
    }
  }

  async findByProject(
    userId: string,
    projectId: string,
    accessToken: string,
  ): Promise<SupplierEvaluationGroupSummaryDto[]> {
    this.logger.log(`Finding evaluation groups for project ${projectId}`);

    try {
      const supabase = this.supabaseService.getClient(accessToken);
      const { data, error } = await supabase.rpc(
        'get_supplier_evaluation_groups_by_project',
        {
          p_project_id: projectId,
          p_user_id: userId,
        },
      );

      if (error) {
        this.logger.error('Error fetching evaluation groups:', error.message);
        throw new Error(`Failed to fetch evaluation groups: ${error.message}`);
      }

      return (data || []).map((group: any) => ({
        id: group.id,
        projectId: group.project_id,
        name: group.name,
        description: group.description,
        notes: group.notes,
        status: group.status,
        createdAt: new Date(group.created_at),
        updatedAt: new Date(group.updated_at),
        bomItemsCount: parseInt(group.bom_items_count) || 0,
        processesCount: parseInt(group.processes_count) || 0,
      }));
    } catch (error) {
      this.logger.error('Failed to find evaluation groups by project:', error);
      throw error;
    }
  }

  async findOne(userId: string, groupId: string, accessToken: string): Promise<SupplierEvaluationGroupDto> {
    this.logger.log(`Finding evaluation group ${groupId}`);

    try {
      const supabase = this.supabaseService.getClient(accessToken);
      const { data, error } = await supabase.rpc(
        'get_supplier_evaluation_group',
        {
          p_group_id: groupId,
          p_user_id: userId,
        },
      );

      if (error) {
        this.logger.error('Error fetching evaluation group:', error.message);
        throw new Error(`Failed to fetch evaluation group: ${error.message}`);
      }

      if (!data || data.length === 0) {
        throw new NotFoundException(`Evaluation group ${groupId} not found`);
      }

      const group = data[0];

      return {
        id: group.id,
        projectId: group.project_id,
        name: group.name,
        description: group.description,
        notes: group.notes,
        status: group.status,
        createdAt: new Date(group.created_at),
        updatedAt: new Date(group.updated_at),
        bomItems: group.bom_items || [],
        processes: group.processes || [],
      };
    } catch (error) {
      this.logger.error('Failed to find evaluation group:', error);
      throw error;
    }
  }

  async update(
    userId: string,
    groupId: string,
    updateDto: UpdateSupplierEvaluationGroupDto,
    accessToken: string,
  ): Promise<SupplierEvaluationGroupDto> {
    this.logger.log(`Updating evaluation group ${groupId}`);

    try {
      const supabase = this.supabaseService.getClient(accessToken);
      const { error } = await supabase
        .from('supplier_evaluation_groups')
        .update({
          name: updateDto.name,
          description: updateDto.description,
          notes: updateDto.notes,
          status: updateDto.status,
          updated_at: new Date().toISOString(),
        })
        .eq('id', groupId);

      if (error) {
        this.logger.error('Error updating evaluation group:', error.message);
        throw new Error(`Failed to update evaluation group: ${error.message}`);
      }

      return this.findOne(userId, groupId, accessToken);
    } catch (error) {
      this.logger.error('Failed to update evaluation group:', error);
      throw error;
    }
  }

  async validateDeletion(userId: string, groupId: string, accessToken: string): Promise<{
    canDelete: boolean;
    warnings: string[];
    blockers: string[];
    impactSummary: Array<{ label: string; count: number }>;
  }> {
    const warnings: string[] = [];
    const blockers: string[] = [];
    const impactSummary: Array<{ label: string; count: number }> = [];

    try {
      const supabase = this.supabaseService.getClient(accessToken);

      // Get evaluation group details (RLS scopes this to the caller's organization)
      const { data: group } = await supabase
        .from('supplier_evaluation_groups')
        .select('*')
        .eq('id', groupId)
        .single();

      if (!group) {
        blockers.push('Evaluation group not found');
        return { canDelete: false, warnings, blockers, impactSummary };
      }

      // Check for active RFQs by looking at RFQ tracking records.
      // No manual user_id filter — rfq_tracking is org-scoped by RLS
      // (a stale filter here would have under-counted an org-mate's RFQs).
      const { count: activeRfqCount } = await supabase
        .from('rfq_tracking')
        .select('*', { count: 'exact' })
        .eq('project_id', group.project_id)
        .in('status', ['sent', 'responses_received']);

      if (activeRfqCount && activeRfqCount > 0) {
        blockers.push(`${activeRfqCount} active RFQ(s) are currently sent to vendors. Cancel these RFQs first.`);
      }

      // Check for RFQs under evaluation
      const { count: evaluatedCount } = await supabase
        .from('rfq_tracking')
        .select('*', { count: 'exact' })
        .eq('project_id', group.project_id)
        .eq('status', 'evaluated');

      if (evaluatedCount && evaluatedCount > 0) {
        warnings.push(`${evaluatedCount} RFQ(s) are currently under evaluation and will be lost.`);
        impactSummary.push({ label: 'RFQs Under Evaluation', count: evaluatedCount });
      }

      // Check for completed RFQs (historical data)
      const { count: completedCount } = await supabase
        .from('rfq_tracking')
        .select('*', { count: 'exact' })
        .eq('project_id', group.project_id)
        .eq('status', 'completed');

      if (completedCount && completedCount > 0) {
        warnings.push('This evaluation contains completed RFQ data that may be valuable for future reference.');
        impactSummary.push({ label: 'Completed RFQs', count: completedCount });
      }

      // Count related data that will be cascade deleted.
      // NOTE: these two queries previously filtered on .eq('group_id', groupId),
      // but the real FK column on both tables is evaluation_group_id — 'group_id'
      // doesn't exist, so this was silently throwing (caught by the outer
      // try/catch) and impactSummary never actually included these counts.
      // Fixed here as a pre-existing bug adjacent to this same function.
      const { count: bomItemsCount } = await supabase
        .from('supplier_evaluation_group_bom_items')
        .select('*', { count: 'exact' })
        .eq('evaluation_group_id', groupId);

      if (bomItemsCount && bomItemsCount > 0) {
        impactSummary.push({ label: 'BOM Items', count: bomItemsCount });
      }

      const { count: processesCount } = await supabase
        .from('supplier_evaluation_group_processes')
        .select('*', { count: 'exact' })
        .eq('evaluation_group_id', groupId);

      if (processesCount && processesCount > 0) {
        impactSummary.push({ label: 'Processes', count: processesCount });
      }

      // Check for vendor selections (from enhanced schema)
      const { count: vendorSelectionsCount } = await supabase
        .from('supplier_evaluation_vendor_selections')
        .select('*', { count: 'exact' })
        .eq('evaluation_group_id', groupId);

      if (vendorSelectionsCount && vendorSelectionsCount > 0) {
        impactSummary.push({ label: 'Vendor Selections', count: vendorSelectionsCount });
      }

      // Business logic warnings based on status
      if (group.status === 'active') {
        warnings.push('This is an active evaluation that may be in progress.');
      }

      if (group.status === 'completed') {
        warnings.push('This completed evaluation contains historical data.');
      }

      return {
        canDelete: blockers.length === 0,
        warnings,
        blockers,
        impactSummary,
      };
    } catch (error) {
      this.logger.error('Failed to validate deletion:', error);
      return {
        canDelete: false,
        warnings: [],
        blockers: ['Failed to validate deletion permissions'],
        impactSummary: [],
      };
    }
  }

  async remove(userId: string, groupId: string, accessToken: string): Promise<void> {
    this.logger.log(`Removing evaluation group ${groupId}`);

    try {
      // Validate deletion is allowed
      const validation = await this.validateDeletion(userId, groupId, accessToken);
      
      if (!validation.canDelete) {
        throw new BadRequestException(`Cannot delete evaluation group: ${validation.blockers.join(', ')}`);
      }

      const supabase = this.supabaseService.getClient(accessToken);
      const { error } = await supabase
        .from('supplier_evaluation_groups')
        .delete()
        .eq('id', groupId);

      if (error) {
        this.logger.error('Error removing evaluation group:', error.message);
        throw new BadRequestException(`Failed to remove evaluation group: ${error.message}`);
      }

      this.logger.log(`Successfully removed evaluation group ${groupId}`);
    } catch (error) {
      this.logger.error('Failed to remove evaluation group:', error);
      throw error;
    }
  }

  async getLatestByProject(userId: string, projectId: string, accessToken: string): Promise<SupplierEvaluationGroupDto | null> {
    this.logger.log(`Getting latest evaluation group for project ${projectId}`);

    try {
      const groups = await this.findByProject(userId, projectId, accessToken);
      
      if (groups.length === 0) {
        return null;
      }

      // Get the most recent group
      const latestGroup = groups.sort((a, b) => 
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      )[0];

      return this.findOne(userId, latestGroup.id, accessToken);
    } catch (error) {
      this.logger.error('Failed to get latest evaluation group:', error);
      throw error;
    }
  }
}