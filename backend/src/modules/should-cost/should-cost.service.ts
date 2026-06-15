import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { SupabaseService } from '../../common/supabase/supabase.service';
import {
  QueryRfqHistoryDto,
  CreateRfqHistoryDto,
  UpdateRfqHistoryDto,
  QueryQuoteLineItemsDto,
  CreateQuoteLineItemDto,
  UpdateQuoteLineItemDto,
  QueryQuoteOutcomesDto,
  CreateQuoteOutcomeDto,
  QueryActualsDto,
  CreateActualVsEstimatedDto,
  QueryBomSnapshotsDto,
  CreateBomSnapshotDto,
  QueryAssemblyBreakdownDto,
  CreateAssemblyBreakdownDto,
} from './dto/should-cost.dto';

@Injectable()
export class ShouldCostService {
  private readonly logger = new Logger(ShouldCostService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  private paginate(query: { page?: number; limit?: number }) {
    const page = query.page || 1;
    const limit = Math.min(query.limit || 25, 200);
    return { page, limit, from: (page - 1) * limit, to: (page - 1) * limit + limit - 1 };
  }

  private client(token: string) {
    return this.supabaseService.getClient(token);
  }

  // ── RFQ History ─────────────────────────────────────────────────────────────

  async listRfq(query: QueryRfqHistoryDto, userId: string, token: string) {
    const { page, limit, from, to } = this.paginate(query);
    let q = this.client(token)
      .from('rfq_history')
      .select('*', { count: 'exact' })
      .eq('user_id', userId)
      .range(from, to);

    if (query.status) q = q.eq('status', query.status);
    if (query.customerName) q = q.ilike('customer_name', `%${query.customerName}%`);
    if (query.processName) q = q.ilike('process_name', `%${query.processName}%`);

    q = q.order('submitted_at', { ascending: false });

    const { data, error, count } = await q;
    if (error) {
      this.logger.error(`rfq_history list: ${error.message}`, ShouldCostService.name);
      throw new InternalServerErrorException(`Failed: ${error.message}`);
    }
    return { data: data ?? [], count: count ?? 0, page, limit };
  }

  async getRfq(id: string, userId: string, token: string) {
    const { data, error } = await this.client(token)
      .from('rfq_history')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (error || !data) throw new NotFoundException(`RFQ ${id} not found`);
    return data;
  }

  async createRfq(dto: CreateRfqHistoryDto, userId: string, token: string) {
    const { data, error } = await this.client(token)
      .from('rfq_history')
      .insert({
        user_id: userId,
        rfq_number: dto.rfqNumber,
        customer_name: dto.customerName,
        part_name: dto.partName,
        part_number: dto.partNumber ?? null,
        quantity: dto.quantity ?? null,
        material: dto.material ?? null,
        process_id: dto.processId ?? null,
        process_name: dto.processName ?? null,
        status: dto.status ?? 'Open',
        priority: dto.priority ?? 'Medium',
        source: dto.source ?? null,
        due_date: dto.dueDate ?? null,
        notes: dto.notes ?? null,
        submitted_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error || !data) {
      this.logger.error(`rfq_history create: ${error?.message}`, ShouldCostService.name);
      throw new InternalServerErrorException(`Failed: ${error?.message}`);
    }
    return data;
  }

  async updateRfq(id: string, dto: UpdateRfqHistoryDto, userId: string, token: string) {
    const patch: Record<string, any> = {};
    if (dto.status !== undefined) patch.status = dto.status;
    if (dto.priority !== undefined) patch.priority = dto.priority;
    if (dto.notes !== undefined) patch.notes = dto.notes;
    if (dto.respondedAt !== undefined) patch.responded_at = dto.respondedAt;

    const { data, error } = await this.client(token)
      .from('rfq_history')
      .update(patch)
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();

    if (error || !data) throw new NotFoundException(`RFQ ${id} not found or update failed`);
    return data;
  }

  async deleteRfq(id: string, userId: string, token: string) {
    const { error } = await this.client(token)
      .from('rfq_history')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    if (error) {
      this.logger.error(`rfq_history delete: ${error.message}`, ShouldCostService.name);
      throw new InternalServerErrorException(`Failed: ${error.message}`);
    }
    return { message: 'RFQ deleted successfully' };
  }

  // ── Quote Line Items ─────────────────────────────────────────────────────────

  async listLineItems(query: QueryQuoteLineItemsDto, userId: string, token: string) {
    const { page, limit, from, to } = this.paginate(query);
    let q = this.client(token)
      .from('quote_line_items')
      .select('*', { count: 'exact' })
      .eq('user_id', userId)
      .range(from, to);

    if (query.rfqId) q = q.eq('rfq_id', query.rfqId);

    q = q.order('rfq_id').order('line_number');

    const { data, error, count } = await q;
    if (error) {
      this.logger.error(`quote_line_items list: ${error.message}`, ShouldCostService.name);
      throw new InternalServerErrorException(`Failed: ${error.message}`);
    }
    return { data: data ?? [], count: count ?? 0, page, limit };
  }

  async getLineItem(id: string, userId: string, token: string) {
    const { data, error } = await this.client(token)
      .from('quote_line_items')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (error || !data) throw new NotFoundException(`Line item ${id} not found`);
    return data;
  }

  async createLineItem(dto: CreateQuoteLineItemDto, userId: string, token: string) {
    const { data, error } = await this.client(token)
      .from('quote_line_items')
      .insert({
        user_id: userId,
        rfq_id: dto.rfqId,
        line_number: dto.lineNumber ?? 1,
        description: dto.description ?? null,
        quantity: dto.quantity ?? null,
        material_cost_usd: dto.materialCostUsd ?? null,
        process_cost_usd: dto.processCostUsd ?? null,
        overhead_cost_usd: dto.overheadCostUsd ?? null,
        profit_margin_pct: dto.profitMarginPct ?? null,
        unit_price_usd: dto.unitPriceUsd ?? null,
        total_price_usd: dto.totalPriceUsd ?? null,
        country_factor_applied: dto.countryFactorApplied ?? null,
        overhead_profile_applied: dto.overheadProfileApplied ?? null,
        scrap_rate_source: dto.scrapRateSource ?? null,
        cycle_time_source: dto.cycleTimeSource ?? null,
        notes: dto.notes ?? null,
      })
      .select()
      .single();

    if (error || !data) {
      this.logger.error(`quote_line_items create: ${error?.message}`, ShouldCostService.name);
      throw new InternalServerErrorException(`Failed: ${error?.message}`);
    }
    return data;
  }

  async updateLineItem(id: string, dto: UpdateQuoteLineItemDto, userId: string, token: string) {
    const patch: Record<string, any> = {};
    if (dto.materialCostUsd !== undefined) patch.material_cost_usd = dto.materialCostUsd;
    if (dto.processCostUsd !== undefined) patch.process_cost_usd = dto.processCostUsd;
    if (dto.overheadCostUsd !== undefined) patch.overhead_cost_usd = dto.overheadCostUsd;
    if (dto.profitMarginPct !== undefined) patch.profit_margin_pct = dto.profitMarginPct;
    if (dto.unitPriceUsd !== undefined) patch.unit_price_usd = dto.unitPriceUsd;
    if (dto.totalPriceUsd !== undefined) patch.total_price_usd = dto.totalPriceUsd;
    if (dto.notes !== undefined) patch.notes = dto.notes;

    const { data, error } = await this.client(token)
      .from('quote_line_items')
      .update(patch)
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();

    if (error || !data) throw new NotFoundException(`Line item ${id} not found`);
    return data;
  }

  async deleteLineItem(id: string, userId: string, token: string) {
    const { error } = await this.client(token)
      .from('quote_line_items')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    if (error) throw new InternalServerErrorException(`Failed: ${error.message}`);
    return { message: 'Line item deleted successfully' };
  }

  // ── Quote Outcomes ────────────────────────────────────────────────────────────

  async listOutcomes(query: QueryQuoteOutcomesDto, userId: string, token: string) {
    const { page, limit, from, to } = this.paginate(query);
    let q = this.client(token)
      .from('quote_outcomes')
      .select('*', { count: 'exact' })
      .eq('user_id', userId)
      .range(from, to);

    if (query.rfqId) q = q.eq('rfq_id', query.rfqId);
    if (query.outcome) q = q.eq('outcome', query.outcome);

    q = q.order('outcome_date', { ascending: false });

    const { data, error, count } = await q;
    if (error) {
      this.logger.error(`quote_outcomes list: ${error.message}`, ShouldCostService.name);
      throw new InternalServerErrorException(`Failed: ${error.message}`);
    }
    return { data: data ?? [], count: count ?? 0, page, limit };
  }

  async createOutcome(dto: CreateQuoteOutcomeDto, userId: string, token: string) {
    const { data, error } = await this.client(token)
      .from('quote_outcomes')
      .insert({
        user_id: userId,
        rfq_id: dto.rfqId,
        outcome_date: dto.outcomeDate,
        outcome: dto.outcome,
        loss_reason: dto.lossReason ?? null,
        competitor_price_usd: dto.competitorPriceUsd ?? null,
        our_price_usd: dto.ourPriceUsd ?? null,
        price_to_win_usd: dto.priceToWinUsd ?? null,
        key_win_factor: dto.keyWinFactor ?? null,
        notes: dto.notes ?? null,
      })
      .select()
      .single();

    if (error || !data) {
      this.logger.error(`quote_outcomes create: ${error?.message}`, ShouldCostService.name);
      throw new InternalServerErrorException(`Failed: ${error?.message}`);
    }

    // Cascade status update to rfq_history
    if (dto.outcome === 'Won' || dto.outcome === 'Lost') {
      await this.client(token)
        .from('rfq_history')
        .update({ status: dto.outcome, responded_at: new Date().toISOString() })
        .eq('id', dto.rfqId)
        .eq('user_id', userId);
    }

    return data;
  }

  async deleteOutcome(id: string, userId: string, token: string) {
    const { error } = await this.client(token)
      .from('quote_outcomes')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    if (error) throw new InternalServerErrorException(`Failed: ${error.message}`);
    return { message: 'Outcome deleted successfully' };
  }

  // ── Actual vs Estimated ───────────────────────────────────────────────────────

  async listActuals(query: QueryActualsDto, userId: string, token: string) {
    const { page, limit, from, to } = this.paginate(query);
    let q = this.client(token)
      .from('actual_vs_estimated_cost')
      .select('*', { count: 'exact' })
      .eq('user_id', userId)
      .range(from, to);

    if (query.rfqId) q = q.eq('rfq_id', query.rfqId);

    q = q.order('production_date', { ascending: false });

    const { data, error, count } = await q;
    if (error) {
      this.logger.error(`actual_vs_estimated_cost list: ${error.message}`, ShouldCostService.name);
      throw new InternalServerErrorException(`Failed: ${error.message}`);
    }
    return { data: data ?? [], count: count ?? 0, page, limit };
  }

  async createActual(dto: CreateActualVsEstimatedDto, userId: string, token: string) {
    const { data, error } = await this.client(token)
      .from('actual_vs_estimated_cost')
      .insert({
        user_id: userId,
        rfq_id: dto.rfqId ?? null,
        part_name: dto.partName,
        est_material_cost_usd: dto.estMaterialCostUsd ?? null,
        act_material_cost_usd: dto.actMaterialCostUsd ?? null,
        est_process_cost_usd: dto.estProcessCostUsd ?? null,
        act_process_cost_usd: dto.actProcessCostUsd ?? null,
        est_overhead_cost_usd: dto.estOverheadCostUsd ?? null,
        act_overhead_cost_usd: dto.actOverheadCostUsd ?? null,
        est_total_cost_usd: dto.estTotalCostUsd ?? null,
        act_total_cost_usd: dto.actTotalCostUsd ?? null,
        production_date: dto.productionDate ?? null,
        quantity_produced: dto.quantityProduced ?? null,
        notes: dto.notes ?? null,
      })
      .select()
      .single();

    if (error || !data) {
      this.logger.error(`actual_vs_estimated_cost create: ${error?.message}`, ShouldCostService.name);
      throw new InternalServerErrorException(`Failed: ${error?.message}`);
    }
    return data;
  }

  async deleteActual(id: string, userId: string, token: string) {
    const { error } = await this.client(token)
      .from('actual_vs_estimated_cost')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    if (error) throw new InternalServerErrorException(`Failed: ${error.message}`);
    return { message: 'Actuals record deleted successfully' };
  }

  // ── BOM Cost Snapshots ────────────────────────────────────────────────────────

  async listBomSnapshots(query: QueryBomSnapshotsDto, userId: string, token: string) {
    const { page, limit, from, to } = this.paginate(query);
    let q = this.client(token)
      .from('bom_cost_snapshots')
      .select('*', { count: 'exact' })
      .eq('user_id', userId)
      .range(from, to);

    if (query.projectId) q = q.eq('project_id', query.projectId);

    q = q.order('snapshot_date', { ascending: false });

    const { data, error, count } = await q;
    if (error) {
      this.logger.error(`bom_cost_snapshots list: ${error.message}`, ShouldCostService.name);
      throw new InternalServerErrorException(`Failed: ${error.message}`);
    }
    return { data: data ?? [], count: count ?? 0, page, limit };
  }

  async getBomSnapshot(id: string, userId: string, token: string) {
    const { data, error } = await this.client(token)
      .from('bom_cost_snapshots')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (error || !data) throw new NotFoundException(`BOM snapshot ${id} not found`);
    return data;
  }

  async createBomSnapshot(dto: CreateBomSnapshotDto, userId: string, token: string) {
    const { data, error } = await this.client(token)
      .from('bom_cost_snapshots')
      .insert({
        user_id: userId,
        project_id: dto.projectId ?? null,
        bom_name: dto.bomName,
        snapshot_date: dto.snapshotDate,
        total_cost_usd: dto.totalCostUsd,
        quantity: dto.quantity,
        baseline_snapshot_id: dto.baselineSnapshotId ?? null,
        change_reason: dto.changeReason ?? null,
        notes: dto.notes ?? null,
      })
      .select()
      .single();

    if (error || !data) {
      this.logger.error(`bom_cost_snapshots create: ${error?.message}`, ShouldCostService.name);
      throw new InternalServerErrorException(`Failed: ${error?.message}`);
    }
    return data;
  }

  async deleteBomSnapshot(id: string, userId: string, token: string) {
    const { error } = await this.client(token)
      .from('bom_cost_snapshots')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    if (error) throw new InternalServerErrorException(`Failed: ${error.message}`);
    return { message: 'BOM snapshot deleted successfully' };
  }

  // ── Assembly Cost Breakdown ───────────────────────────────────────────────────

  async listAssemblyBreakdown(query: QueryAssemblyBreakdownDto, userId: string, token: string) {
    const { page, limit, from, to } = this.paginate(query);
    let q = this.client(token)
      .from('assembly_cost_breakdown')
      .select('*', { count: 'exact' })
      .eq('user_id', userId)
      .range(from, to);

    if (query.bomSnapshotId) q = q.eq('bom_snapshot_id', query.bomSnapshotId);

    q = q.order('bom_level').order('part_number');

    const { data, error, count } = await q;
    if (error) {
      this.logger.error(`assembly_cost_breakdown list: ${error.message}`, ShouldCostService.name);
      throw new InternalServerErrorException(`Failed: ${error.message}`);
    }
    return { data: data ?? [], count: count ?? 0, page, limit };
  }

  async createAssemblyBreakdown(dto: CreateAssemblyBreakdownDto, userId: string, token: string) {
    const { data, error } = await this.client(token)
      .from('assembly_cost_breakdown')
      .insert({
        user_id: userId,
        bom_snapshot_id: dto.bomSnapshotId,
        bom_level: dto.bomLevel ?? 1,
        part_number: dto.partNumber ?? null,
        part_name: dto.partName,
        qty_per_assembly: dto.qtyPerAssembly ?? 1,
        unit_cost_usd: dto.unitCostUsd ?? null,
        cost_driver: dto.costDriver ?? null,
        should_cost_opportunity: dto.shouldCostOpportunity ?? null,
        alternate_process_exists: dto.alternateProcessExists ?? false,
        notes: dto.notes ?? null,
      })
      .select()
      .single();

    if (error || !data) {
      this.logger.error(`assembly_cost_breakdown create: ${error?.message}`, ShouldCostService.name);
      throw new InternalServerErrorException(`Failed: ${error?.message}`);
    }
    return data;
  }

  async deleteAssemblyBreakdown(id: string, userId: string, token: string) {
    const { error } = await this.client(token)
      .from('assembly_cost_breakdown')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    if (error) throw new InternalServerErrorException(`Failed: ${error.message}`);
    return { message: 'Assembly breakdown record deleted successfully' };
  }

  // ── Analytics Views ───────────────────────────────────────────────────────────

  async getWinRateByProcess(userId: string, token: string) {
    const { data, error } = await this.client(token)
      .from('rfq_win_rate_by_process')
      .select('*')
      .eq('user_id', userId)
      .order('win_rate_pct', { ascending: false });

    if (error) {
      this.logger.error(`rfq_win_rate_by_process: ${error.message}`, ShouldCostService.name);
      throw new InternalServerErrorException(`Failed: ${error.message}`);
    }
    return data ?? [];
  }

  async getEstimationAccuracy(userId: string, token: string) {
    const { data, error } = await this.client(token)
      .from('estimation_accuracy_by_process')
      .select('*')
      .eq('user_id', userId)
      .order('avg_variance_pct');

    if (error) {
      this.logger.error(`estimation_accuracy_by_process: ${error.message}`, ShouldCostService.name);
      throw new InternalServerErrorException(`Failed: ${error.message}`);
    }
    return data ?? [];
  }

  async getPriceToWin(userId: string, token: string) {
    const { data, error } = await this.client(token)
      .from('price_to_win_intelligence')
      .select('*')
      .eq('user_id', userId)
      .order('avg_price_gap_pct');

    if (error) {
      this.logger.error(`price_to_win_intelligence: ${error.message}`, ShouldCostService.name);
      throw new InternalServerErrorException(`Failed: ${error.message}`);
    }
    return data ?? [];
  }

  async getBomCostDrivers(userId: string, token: string) {
    const { data, error } = await this.client(token)
      .from('bom_cost_drivers')
      .select('*')
      .eq('user_id', userId)
      .order('total_extended_cost_usd', { ascending: false });

    if (error) {
      this.logger.error(`bom_cost_drivers: ${error.message}`, ShouldCostService.name);
      throw new InternalServerErrorException(`Failed: ${error.message}`);
    }
    return data ?? [];
  }
}
