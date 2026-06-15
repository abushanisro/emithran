import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { SupabaseService } from '../../common/supabase/supabase.service';
import {
  QueryScrapRatesDto,
  QueryCountryFactorsDto,
  QueryMachineUtilizationDto,
  QueryToolLifeDto,
  QueryOverheadProfilesDto,
  QueryMaterialDensityDto,
  QueryMachinesDto,
  QuerySurfaceFinishCostsDto,
  QueryInspectionCostsDto,
  QueryFreightRatesDto,
  QueryMaterialPricesDto,
  QueryCycleTimesDto,
  QueryLaborContentDto,
  QuerySupplierCapabilitiesDto,
  QuerySustainabilityDto,
} from './dto/cost-engineering.dto';

@Injectable()
export class CostEngineeringService {
  private readonly logger = new Logger(CostEngineeringService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  private paginate(query: { page?: number; limit?: number }) {
    const page = query.page || 1;
    const limit = Math.min(query.limit || 50, 500);
    return { page, limit, from: (page - 1) * limit, to: (page - 1) * limit + limit - 1 };
  }

  private async fetch(
    token: string,
    table: string,
    filters: (q: any) => any,
    { page, limit, from, to }: ReturnType<typeof this.paginate>,
  ) {
    let q = this.supabaseService.getClient(token).from(table).select('*', { count: 'exact' }).range(from, to);
    q = filters(q);

    const { data, error, count } = await q;
    if (error) {
      this.logger.error(`${table}: ${error.message}`, CostEngineeringService.name);
      throw new InternalServerErrorException(`Failed to fetch ${table}: ${error.message}`);
    }
    return { data: data ?? [], count: count ?? 0, page, limit };
  }

  async getScrapRates(query: QueryScrapRatesDto, token: string) {
    const pag = this.paginate(query);
    return this.fetch(token, 'process_scrap_rates', (q) => {
      if (query.processCategory) q = q.ilike('process_category', `%${query.processCategory}%`);
      if (query.materialCategory) q = q.ilike('material_category', `%${query.materialCategory}%`);
      return q.order('process_category').order('material_category');
    }, pag);
  }

  async getCountryFactors(query: QueryCountryFactorsDto, token: string) {
    const pag = this.paginate(query);
    return this.fetch(token, 'country_cost_factors', (q) => {
      if (query.region) q = q.ilike('region', `%${query.region}%`);
      if (query.countryCode) q = q.eq('country_code', query.countryCode.toUpperCase());
      return q.order('composite_cost_index');
    }, pag);
  }

  async getMachineUtilization(query: QueryMachineUtilizationDto, token: string) {
    const pag = this.paginate(query);
    return this.fetch(token, 'machine_utilization_factors', (q) => {
      if (query.processCategory) q = q.ilike('process_category', `%${query.processCategory}%`);
      if (query.machineType) q = q.ilike('machine_type', `%${query.machineType}%`);
      return q.order('process_category').order('machine_type');
    }, pag);
  }

  async getToolLife(query: QueryToolLifeDto, token: string) {
    const pag = this.paginate(query);
    return this.fetch(token, 'tool_life_reference', (q) => {
      if (query.toolType) q = q.ilike('tool_type', `%${query.toolType}%`);
      if (query.workMaterial) q = q.ilike('work_material', `%${query.workMaterial}%`);
      return q.order('tool_type').order('work_material');
    }, pag);
  }

  async getOverheadProfiles(query: QueryOverheadProfilesDto, token: string) {
    const pag = this.paginate(query);
    return this.fetch(token, 'overhead_profiles', (q) => {
      if (query.industrySector) q = q.ilike('industry_sector', `%${query.industrySector}%`);
      if (query.region) q = q.ilike('region', `%${query.region}%`);
      if (query.companySize) q = q.ilike('company_size', `%${query.companySize}%`);
      return q.order('industry_sector').order('region');
    }, pag);
  }

  async getMaterialDensity(query: QueryMaterialDensityDto, token: string) {
    const pag = this.paginate(query);
    return this.fetch(token, 'material_density_library', (q) => {
      if (query.materialCategory) q = q.ilike('material_category', `%${query.materialCategory}%`);
      if (query.search) q = q.ilike('material_name', `%${query.search}%`);
      return q.order('material_category').order('material_name');
    }, pag);
  }

  async getMachines(query: QueryMachinesDto, token: string) {
    const pag = this.paginate(query);
    return this.fetch(token, 'machine_master', (q) => {
      if (query.machineCategory) q = q.ilike('machine_category', `%${query.machineCategory}%`);
      if (query.machineSubcategory) q = q.ilike('machine_subcategory', `%${query.machineSubcategory}%`);
      return q.order('machine_category').order('machine_subcategory').order('hourly_rate_mid_usd');
    }, pag);
  }

  async getSurfaceFinishCosts(query: QuerySurfaceFinishCostsDto, token: string) {
    const pag = this.paginate(query);
    return this.fetch(token, 'surface_finish_cost_factors', (q) => {
      if (query.processName) q = q.ilike('process_name', `%${query.processName}%`);
      return q.order('process_name').order('surface_finish_ra_max_um');
    }, pag);
  }

  async getInspectionCosts(query: QueryInspectionCostsDto, token: string) {
    const pag = this.paginate(query);
    return this.fetch(token, 'inspection_level_cost_factors', (q) => {
      if (query.inspectionLevel) q = q.ilike('inspection_level', `%${query.inspectionLevel}%`);
      return q.order('cost_multiplier');
    }, pag);
  }

  async getFreightRates(query: QueryFreightRatesDto, token: string) {
    const pag = this.paginate(query);
    return this.fetch(token, 'freight_rates', (q) => {
      if (query.modeOfTransport) q = q.ilike('mode_of_transport', `%${query.modeOfTransport}%`);
      if (query.originRegion) q = q.ilike('origin_region', `%${query.originRegion}%`);
      if (query.destinationRegion) q = q.ilike('destination_region', `%${query.destinationRegion}%`);
      return q.order('mode_of_transport').order('origin_region');
    }, pag);
  }

  async getMaterialPrices(query: QueryMaterialPricesDto, token: string) {
    const pag = this.paginate(query);
    return this.fetch(token, 'material_price_library', (q) => {
      if (query.materialForm) q = q.ilike('material_form', `%${query.materialForm}%`);
      if (query.region) q = q.ilike('region', `%${query.region}%`);
      if (query.search) q = q.or(`material_name.ilike.%${query.search}%,material_grade.ilike.%${query.search}%`);
      return q.order('material_name').order('region');
    }, pag);
  }

  async getCycleTimes(query: QueryCycleTimesDto, token: string) {
    const pag = this.paginate(query);
    return this.fetch(token, 'process_cycle_time_library', (q) => {
      if (query.processCategory) q = q.ilike('process_category', `%${query.processCategory}%`);
      if (query.materialCategory) q = q.ilike('material_category', `%${query.materialCategory}%`);
      return q.order('process_category').order('operation');
    }, pag);
  }

  async getLaborContent(query: QueryLaborContentDto, token: string) {
    const pag = this.paginate(query);
    return this.fetch(token, 'labor_content_library', (q) => {
      if (query.processCategory) q = q.ilike('process_category', `%${query.processCategory}%`);
      if (query.region) q = q.ilike('region', `%${query.region}%`);
      if (query.skillLevel) q = q.ilike('skill_level', `%${query.skillLevel}%`);
      return q.order('process_category').order('operation_type');
    }, pag);
  }

  async getSupplierCapabilities(query: QuerySupplierCapabilitiesDto, token: string) {
    const pag = this.paginate(query);
    return this.fetch(token, 'supplier_capability_benchmarks', (q) => {
      if (query.processCategory) q = q.ilike('process_category', `%${query.processCategory}%`);
      return q.order('process_category').order('capability_parameter');
    }, pag);
  }

  async getSustainability(query: QuerySustainabilityDto, token: string) {
    const pag = this.paginate(query);
    return this.fetch(token, 'sustainability_factors', (q) => {
      if (query.category) q = q.ilike('category', `%${query.category}%`);
      if (query.search) q = q.ilike('item_name', `%${query.search}%`);
      return q.order('category').order('item_name');
    }, pag);
  }
}
