import { Injectable, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { Logger } from '../../common/logger/logger.service';
import { SupabaseService } from '../../common/supabase/supabase.service';
import {
  CreateVaveProjectDto,
  UpdateVaveProjectDto,
  CreateVaveBomItemDto,
  BulkImportVaveBomDto,
  CreateVaveIdeaDto,
  UpdateVaveIdeaDto,
  BulkCreateVaveIdeasDto,
  CreateVaveShouldCostDto,
  VaveProjectResponseDto,
  VaveProjectDetailResponseDto,
  VaveBomItemResponseDto,
  VaveIdeaResponseDto,
  VaveShouldCostResponseDto,
} from './dto/vave.dto';

@Injectable()
export class VaveService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly logger: Logger,
  ) {}

  // ─── Projects ─────────────────────────────────────────────────────────────

  async findAllProjects(userId: string, accessToken: string): Promise<VaveProjectResponseDto[]> {
    this.logger.log('Fetching VAVE projects', 'VaveService');

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('vave_projects')
      .select('*')
      .eq('owner_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      this.logger.error(`Error fetching VAVE projects: ${error.message}`, 'VaveService');
      throw new InternalServerErrorException(`Failed to fetch VAVE projects: ${error.message}`);
    }

    return (data || []).map(row => VaveProjectResponseDto.fromDatabase(row));
  }

  async findOneProject(id: string, userId: string, accessToken: string): Promise<VaveProjectDetailResponseDto> {
    this.logger.log(`Fetching VAVE project ${id}`, 'VaveService');

    const client = this.supabaseService.getClient(accessToken);

    const [projectResult, bomCountResult, ideaCountResult, savingsResult] = await Promise.all([
      client.from('vave_projects').select('*').eq('id', id).eq('owner_id', userId).single(),
      client.from('vave_bom').select('id', { count: 'exact', head: true }).eq('project_id', id),
      client.from('vave_ideas').select('id', { count: 'exact', head: true }).eq('project_id', id),
      client.from('vave_ideas').select('est_savings_usd').eq('project_id', id),
    ]);

    if (projectResult.error || !projectResult.data) {
      throw new NotFoundException(`VAVE project ${id} not found`);
    }

    const totalSavings = (savingsResult.data || []).reduce(
      (sum: number, row: any) => sum + Number(row.est_savings_usd ?? 0),
      0,
    );

    return VaveProjectDetailResponseDto.fromDatabaseWithStats(
      projectResult.data,
      bomCountResult.count ?? 0,
      ideaCountResult.count ?? 0,
      totalSavings,
    );
  }

  async createProject(dto: CreateVaveProjectDto, userId: string, accessToken: string): Promise<VaveProjectResponseDto> {
    this.logger.log('Creating VAVE project', 'VaveService');

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('vave_projects')
      .insert({
        name: dto.name,
        product_family: dto.productFamily ?? null,
        description: dto.description ?? null,
        owner_id: userId,
      })
      .select()
      .single();

    if (error) {
      this.logger.error(`Error creating VAVE project: ${error.message}`, 'VaveService');
      throw new InternalServerErrorException(`Failed to create VAVE project: ${error.message}`);
    }

    return VaveProjectResponseDto.fromDatabase(data);
  }

  async updateProject(id: string, dto: UpdateVaveProjectDto, userId: string, accessToken: string): Promise<VaveProjectResponseDto> {
    const updates: Record<string, any> = {};
    if (dto.name !== undefined) updates.name = dto.name;
    if (dto.productFamily !== undefined) updates.product_family = dto.productFamily;
    if (dto.description !== undefined) updates.description = dto.description;
    if (dto.status !== undefined) updates.status = dto.status;

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('vave_projects')
      .update(updates)
      .eq('id', id)
      .eq('owner_id', userId)
      .select()
      .single();

    if (error || !data) {
      throw new NotFoundException(`VAVE project ${id} not found or access denied`);
    }

    return VaveProjectResponseDto.fromDatabase(data);
  }

  async deleteProject(id: string, userId: string, accessToken: string): Promise<void> {
    const { error } = await this.supabaseService
      .getClient(accessToken)
      .from('vave_projects')
      .delete()
      .eq('id', id)
      .eq('owner_id', userId);

    if (error) {
      throw new InternalServerErrorException(`Failed to delete VAVE project: ${error.message}`);
    }
  }

  // ─── BOM Items ────────────────────────────────────────────────────────────

  async findBomItems(projectId: string, accessToken: string): Promise<VaveBomItemResponseDto[]> {
    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('vave_bom')
      .select('*')
      .eq('project_id', projectId)
      .order('level', { ascending: true })
      .order('annual_spend', { ascending: false });

    if (error) {
      throw new InternalServerErrorException(`Failed to fetch BOM items: ${error.message}`);
    }

    return (data || []).map(row => VaveBomItemResponseDto.fromDatabase(row));
  }

  async createBomItem(projectId: string, dto: CreateVaveBomItemDto, accessToken: string): Promise<VaveBomItemResponseDto> {
    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('vave_bom')
      .insert({
        project_id: projectId,
        part_number: dto.partNumber,
        description: dto.description ?? null,
        level: dto.level ?? 1,
        parent_pn: dto.parentPn ?? null,
        quantity: dto.quantity ?? 1,
        unit_cost: dto.unitCost ?? 0,
        annual_volume: dto.annualVolume ?? 0,
        material: dto.material ?? null,
        process: dto.process ?? null,
        supplier_name: dto.supplierName ?? null,
        drawing_url: dto.drawingUrl ?? null,
        model_url: dto.modelUrl ?? null,
        drawing_analysis: dto.drawingAnalysis ?? null,
      })
      .select()
      .single();

    if (error) {
      throw new InternalServerErrorException(`Failed to create BOM item: ${error.message}`);
    }

    return VaveBomItemResponseDto.fromDatabase(data);
  }

  async bulkImportBom(projectId: string, dto: BulkImportVaveBomDto, accessToken: string): Promise<VaveBomItemResponseDto[]> {
    if (!dto.items?.length) return [];

    const rows = dto.items.map(item => ({
      project_id: projectId,
      part_number: item.partNumber,
      description: item.description ?? null,
      level: item.level ?? 1,
      parent_pn: item.parentPn ?? null,
      quantity: item.quantity ?? 1,
      unit_cost: item.unitCost ?? 0,
      annual_volume: item.annualVolume ?? 0,
      material: item.material ?? null,
      process: item.process ?? null,
      supplier_name: item.supplierName ?? null,
      drawing_url: item.drawingUrl ?? null,
      model_url: item.modelUrl ?? null,
      drawing_analysis: item.drawingAnalysis ?? null,
    }));

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('vave_bom')
      .insert(rows)
      .select();

    if (error) {
      throw new InternalServerErrorException(`Failed to bulk import BOM: ${error.message}`);
    }

    return (data || []).map(row => VaveBomItemResponseDto.fromDatabase(row));
  }

  async deleteBomItem(projectId: string, itemId: string, accessToken: string): Promise<void> {
    const { error } = await this.supabaseService
      .getClient(accessToken)
      .from('vave_bom')
      .delete()
      .eq('id', itemId)
      .eq('project_id', projectId);

    if (error) {
      throw new InternalServerErrorException(`Failed to delete BOM item: ${error.message}`);
    }
  }

  // ─── Ideas ────────────────────────────────────────────────────────────────

  async findIdeas(projectId: string, accessToken: string): Promise<VaveIdeaResponseDto[]> {
    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('vave_ideas')
      .select('*')
      .eq('project_id', projectId)
      .order('est_savings_usd', { ascending: false });

    if (error) {
      throw new InternalServerErrorException(`Failed to fetch VAVE ideas: ${error.message}`);
    }

    return (data || []).map(row => VaveIdeaResponseDto.fromDatabase(row));
  }

  async createIdea(projectId: string, dto: CreateVaveIdeaDto, accessToken: string): Promise<VaveIdeaResponseDto> {
    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('vave_ideas')
      .insert(this.ideaDtoToRow(projectId, dto))
      .select()
      .single();

    if (error) {
      throw new InternalServerErrorException(`Failed to create VAVE idea: ${error.message}`);
    }

    return VaveIdeaResponseDto.fromDatabase(data);
  }

  async bulkCreateIdeas(projectId: string, dto: BulkCreateVaveIdeasDto, accessToken: string): Promise<VaveIdeaResponseDto[]> {
    if (!dto.ideas?.length) return [];

    const rows = dto.ideas.map(idea => this.ideaDtoToRow(projectId, idea));

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('vave_ideas')
      .insert(rows)
      .select();

    if (error) {
      throw new InternalServerErrorException(`Failed to bulk create ideas: ${error.message}`);
    }

    return (data || []).map(row => VaveIdeaResponseDto.fromDatabase(row));
  }

  async updateIdea(projectId: string, ideaId: string, dto: UpdateVaveIdeaDto, accessToken: string): Promise<VaveIdeaResponseDto> {
    const updates: Record<string, any> = {};
    if (dto.title !== undefined) updates.title = dto.title;
    if (dto.description !== undefined) updates.description = dto.description;
    if (dto.framework !== undefined) updates.framework = dto.framework;
    if (dto.scamperType !== undefined) updates.scamper_type = dto.scamperType;
    if (dto.affectedParts !== undefined) updates.affected_parts = dto.affectedParts;
    if (dto.estSavingsUsd !== undefined) updates.est_savings_usd = dto.estSavingsUsd;
    if (dto.estInvestmentUsd !== undefined) updates.est_investment_usd = dto.estInvestmentUsd;
    if (dto.feasibility !== undefined) updates.feasibility = dto.feasibility;
    if (dto.complexity !== undefined) updates.complexity = dto.complexity;
    if (dto.risk !== undefined) updates.risk = dto.risk;
    if (dto.quadrant !== undefined) updates.quadrant = dto.quadrant;
    if (dto.status !== undefined) updates.status = dto.status;
    if (dto.timeToImplementMonths !== undefined) updates.time_to_implement_months = dto.timeToImplementMonths;

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('vave_ideas')
      .update(updates)
      .eq('id', ideaId)
      .eq('project_id', projectId)
      .select()
      .single();

    if (error || !data) {
      throw new NotFoundException(`VAVE idea ${ideaId} not found`);
    }

    return VaveIdeaResponseDto.fromDatabase(data);
  }

  async deleteIdea(projectId: string, ideaId: string, accessToken: string): Promise<void> {
    const { error } = await this.supabaseService
      .getClient(accessToken)
      .from('vave_ideas')
      .delete()
      .eq('id', ideaId)
      .eq('project_id', projectId);

    if (error) {
      throw new InternalServerErrorException(`Failed to delete VAVE idea: ${error.message}`);
    }
  }

  // ─── Should Costs ─────────────────────────────────────────────────────────

  async findShouldCosts(projectId: string, accessToken: string): Promise<VaveShouldCostResponseDto[]> {
    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('vave_should_costs')
      .select('*')
      .eq('project_id', projectId)
      .order('delta', { ascending: false });

    if (error) {
      throw new InternalServerErrorException(`Failed to fetch should costs: ${error.message}`);
    }

    return (data || []).map(row => VaveShouldCostResponseDto.fromDatabase(row));
  }

  async upsertShouldCost(projectId: string, dto: CreateVaveShouldCostDto, accessToken: string): Promise<VaveShouldCostResponseDto> {
    const deltaPct = dto.actualCost > 0
      ? ((dto.actualCost - dto.shouldCost) / dto.actualCost) * 100
      : null;

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('vave_should_costs')
      .upsert(
        {
          project_id: projectId,
          part_number: dto.partNumber,
          description: dto.description ?? null,
          actual_cost: dto.actualCost,
          should_cost: dto.shouldCost,
          delta_pct: dto.deltaPct ?? deltaPct,
          material_cost: dto.materialCost ?? null,
          process_cost: dto.processCost ?? null,
          overhead: dto.overhead ?? null,
          margin: dto.margin ?? null,
          benchmark_source: dto.benchmarkSource ?? null,
        },
        { onConflict: 'project_id,part_number', ignoreDuplicates: false },
      )
      .select()
      .single();

    if (error) {
      throw new InternalServerErrorException(`Failed to upsert should cost: ${error.message}`);
    }

    return VaveShouldCostResponseDto.fromDatabase(data);
  }

  async deleteShouldCost(projectId: string, costId: string, accessToken: string): Promise<void> {
    const { error } = await this.supabaseService
      .getClient(accessToken)
      .from('vave_should_costs')
      .delete()
      .eq('id', costId)
      .eq('project_id', projectId);

    if (error) {
      throw new InternalServerErrorException(`Failed to delete should cost: ${error.message}`);
    }
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private ideaDtoToRow(projectId: string, dto: CreateVaveIdeaDto) {
    return {
      project_id: projectId,
      title: dto.title,
      description: dto.description ?? null,
      framework: dto.framework ?? 'Manual',
      scamper_type: dto.scamperType ?? null,
      affected_parts: dto.affectedParts ?? [],
      est_savings_usd: dto.estSavingsUsd ?? 0,
      est_investment_usd: dto.estInvestmentUsd ?? 0,
      feasibility: dto.feasibility ?? 'Medium',
      complexity: dto.complexity ?? 'L2',
      risk: dto.risk ?? 'Medium',
      quadrant: dto.quadrant ?? null,
      status: dto.status ?? 'draft',
      time_to_implement_months: dto.timeToImplementMonths ?? null,
    };
  }
}
