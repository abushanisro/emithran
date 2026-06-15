import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { SupabaseService } from '../../common/supabase/supabase.service';
import {
  QueryCompatibilityDto,
  QueryFeatureCostRulesDto,
  QueryDfmRulesDto,
  QuerySupplierKpiDto,
  QueryCommodityPricesDto,
  QuerySupplierPerformanceDto,
  CreateSupplierPerformanceDto,
  UpdateSupplierPerformanceDto,
} from './dto/manufacturing-intelligence.dto';

@Injectable()
export class ManufacturingIntelligenceService {
  private readonly logger = new Logger(ManufacturingIntelligenceService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  private paginate(query: { page?: number; limit?: number }) {
    const page = query.page || 1;
    const limit = Math.min(query.limit || 50, 500);
    return { page, limit, from: (page - 1) * limit, to: (page - 1) * limit + limit - 1 };
  }

  // ── Global lookup tables ────────────────────────────────────────────────────

  async getMaterialProcessCompatibility(query: QueryCompatibilityDto, token: string) {
    const { page, limit, from, to } = this.paginate(query);
    let q = this.supabaseService
      .getClient(token)
      .from('material_process_compatibility')
      .select('*', { count: 'exact' })
      .range(from, to);

    if (query.material) q = q.ilike('material_name', `%${query.material}%`);
    if (query.process) q = q.ilike('process_name', `%${query.process}%`);
    if (query.minScore !== undefined) q = q.gte('suitability_score', query.minScore);

    q = q.order('suitability_score', { ascending: false }).order('material_name');

    const { data, error, count } = await q;
    if (error) {
      this.logger.error(`material_process_compatibility: ${error.message}`, ManufacturingIntelligenceService.name);
      throw new InternalServerErrorException(`Failed: ${error.message}`);
    }
    return { data: data ?? [], count: count ?? 0, page, limit };
  }

  async getFeatureCostRules(query: QueryFeatureCostRulesDto, token: string) {
    const { page, limit, from, to } = this.paginate(query);
    let q = this.supabaseService
      .getClient(token)
      .from('feature_cost_rules')
      .select('*', { count: 'exact' })
      .range(from, to);

    if (query.processCategory) q = q.ilike('process_category', `%${query.processCategory}%`);
    if (query.featureType) q = q.ilike('feature_type', `%${query.featureType}%`);

    q = q.order('process_category').order('feature_type').order('size_value');

    const { data, error, count } = await q;
    if (error) {
      this.logger.error(`feature_cost_rules: ${error.message}`, ManufacturingIntelligenceService.name);
      throw new InternalServerErrorException(`Failed: ${error.message}`);
    }
    return { data: data ?? [], count: count ?? 0, page, limit };
  }

  async getDfmRules(query: QueryDfmRulesDto, token: string) {
    const { page, limit, from, to } = this.paginate(query);
    let q = this.supabaseService
      .getClient(token)
      .from('dfm_rules_library')
      .select('*', { count: 'exact' })
      .range(from, to);

    if (query.processName) q = q.ilike('process_name', `%${query.processName}%`);
    if (query.severity) q = q.eq('violation_severity', query.severity);
    if (query.costImpact) q = q.eq('cost_impact', query.costImpact);

    // Critical first, then by process
    const severityOrder = ['Critical', 'Warning', 'Advisory'];
    q = q.order('process_name').order('violation_severity');

    const { data, error, count } = await q;
    if (error) {
      this.logger.error(`dfm_rules_library: ${error.message}`, ManufacturingIntelligenceService.name);
      throw new InternalServerErrorException(`Failed: ${error.message}`);
    }

    // Sort Critical > Warning > Advisory in-memory (Supabase doesn't do enum ordering)
    const sorted = (data ?? []).sort((a: any, b: any) => {
      const ai = severityOrder.indexOf(a.violation_severity);
      const bi = severityOrder.indexOf(b.violation_severity);
      if (ai !== bi) return ai - bi;
      return a.process_name.localeCompare(b.process_name);
    });

    return { data: sorted, count: count ?? 0, page, limit };
  }

  async getSupplierKpiBenchmarks(query: QuerySupplierKpiDto, token: string) {
    const { page, limit, from, to } = this.paginate(query);
    let q = this.supabaseService
      .getClient(token)
      .from('supplier_kpi_benchmarks')
      .select('*', { count: 'exact' })
      .range(from, to);

    if (query.industrySector) q = q.ilike('industry_sector', `%${query.industrySector}%`);
    if (query.kpiCategory) q = q.ilike('kpi_category', `%${query.kpiCategory}%`);

    q = q.order('industry_sector').order('kpi_category').order('kpi_name');

    const { data, error, count } = await q;
    if (error) {
      this.logger.error(`supplier_kpi_benchmarks: ${error.message}`, ManufacturingIntelligenceService.name);
      throw new InternalServerErrorException(`Failed: ${error.message}`);
    }
    return { data: data ?? [], count: count ?? 0, page, limit };
  }

  async getCommodityPrices(query: QueryCommodityPricesDto, token: string) {
    const { page, limit, from, to } = this.paginate(query);
    let q = this.supabaseService
      .getClient(token)
      .from('commodity_price_history')
      .select('*', { count: 'exact' })
      .range(from, to);

    if (query.commodityCode) q = q.eq('commodity_code', query.commodityCode.toUpperCase());
    if (query.dateFrom) q = q.gte('price_date', query.dateFrom);
    if (query.dateTo) q = q.lte('price_date', query.dateTo);

    q = q.order('commodity_code').order('price_date', { ascending: false });

    const { data, error, count } = await q;
    if (error) {
      this.logger.error(`commodity_price_history: ${error.message}`, ManufacturingIntelligenceService.name);
      throw new InternalServerErrorException(`Failed: ${error.message}`);
    }
    return { data: data ?? [], count: count ?? 0, page, limit };
  }

  // ── Supplier performance (user-owned, full CRUD) ────────────────────────────

  async getSupplierPerformance(query: QuerySupplierPerformanceDto, userId: string, token: string) {
    const { page, limit, from, to } = this.paginate(query);
    let q = this.supabaseService
      .getClient(token)
      .from('supplier_performance_records')
      .select('*', { count: 'exact' })
      .eq('user_id', userId)
      .range(from, to);

    if (query.supplierName) q = q.ilike('supplier_name', `%${query.supplierName}%`);
    if (query.periodFrom) q = q.gte('period_start', query.periodFrom);
    if (query.periodTo) q = q.lte('period_end', query.periodTo);

    q = q.order('period_start', { ascending: false }).order('supplier_name');

    const { data, error, count } = await q;
    if (error) {
      this.logger.error(`supplier_performance_records: ${error.message}`, ManufacturingIntelligenceService.name);
      throw new InternalServerErrorException(`Failed: ${error.message}`);
    }
    return { data: data ?? [], count: count ?? 0, page, limit };
  }

  async getSupplierPerformanceById(id: string, userId: string, token: string) {
    const { data, error } = await this.supabaseService
      .getClient(token)
      .from('supplier_performance_records')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (error || !data) {
      throw new NotFoundException(`Supplier performance record ${id} not found`);
    }
    return data;
  }

  async createSupplierPerformance(dto: CreateSupplierPerformanceDto, userId: string, token: string) {
    const { data, error } = await this.supabaseService
      .getClient(token)
      .from('supplier_performance_records')
      .insert({
        user_id: userId,
        supplier_name: dto.supplierName,
        supplier_id: dto.supplierId ?? null,
        period_start: dto.periodStart,
        period_end: dto.periodEnd,
        on_time_delivery_pct: dto.onTimeDeliveryPct ?? null,
        quality_ppm: dto.qualityPpm ?? null,
        first_pass_yield_pct: dto.firstPassYieldPct ?? null,
        cost_variance_pct: dto.costVariancePct ?? null,
        lead_time_days: dto.leadTimeDays ?? null,
        responsiveness_score: dto.responsivenessScore ?? null,
        notes: dto.notes ?? null,
      })
      .select()
      .single();

    if (error || !data) {
      this.logger.error(`Create supplier performance: ${error?.message}`, ManufacturingIntelligenceService.name);
      throw new InternalServerErrorException(`Failed to create: ${error?.message}`);
    }
    return data;
  }

  async updateSupplierPerformance(id: string, dto: UpdateSupplierPerformanceDto, userId: string, token: string) {
    const updateData: Record<string, any> = {};
    if (dto.supplierName !== undefined) updateData.supplier_name = dto.supplierName;
    if (dto.onTimeDeliveryPct !== undefined) updateData.on_time_delivery_pct = dto.onTimeDeliveryPct;
    if (dto.qualityPpm !== undefined) updateData.quality_ppm = dto.qualityPpm;
    if (dto.firstPassYieldPct !== undefined) updateData.first_pass_yield_pct = dto.firstPassYieldPct;
    if (dto.costVariancePct !== undefined) updateData.cost_variance_pct = dto.costVariancePct;
    if (dto.leadTimeDays !== undefined) updateData.lead_time_days = dto.leadTimeDays;
    if (dto.responsivenessScore !== undefined) updateData.responsiveness_score = dto.responsivenessScore;
    if (dto.notes !== undefined) updateData.notes = dto.notes;

    const { data, error } = await this.supabaseService
      .getClient(token)
      .from('supplier_performance_records')
      .update(updateData)
      .eq('id', id)
      .eq('user_id', userId)
      .select()
      .single();

    if (error || !data) {
      this.logger.error(`Update supplier performance: ${error?.message}`, ManufacturingIntelligenceService.name);
      throw new NotFoundException(`Record ${id} not found or update failed`);
    }
    return data;
  }

  async deleteSupplierPerformance(id: string, userId: string, token: string) {
    const { error } = await this.supabaseService
      .getClient(token)
      .from('supplier_performance_records')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    if (error) {
      this.logger.error(`Delete supplier performance: ${error.message}`, ManufacturingIntelligenceService.name);
      throw new InternalServerErrorException(`Failed to delete: ${error.message}`);
    }
    return { message: 'Supplier performance record deleted successfully' };
  }
}
