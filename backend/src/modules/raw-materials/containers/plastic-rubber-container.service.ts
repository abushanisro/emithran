import { Injectable, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { Logger } from '../../../common/logger/logger.service';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { MaterialCategory } from '../constants/material-categories.constants';
import { CreateRawMaterialDto, UpdateRawMaterialDto, QueryRawMaterialsDto } from '../dto/raw-materials.dto';
import { RawMaterialResponseDto } from '../dto/raw-material-response.dto';

@Injectable()
export class PlasticRubberContainerService {
  private readonly category = MaterialCategory.PLASTIC_RUBBER;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly logger: Logger,
  ) {}

  async findAllPlasticRubberMaterials(
    query: QueryRawMaterialsDto,
    userId?: string,
    accessToken?: string
  ): Promise<{ items: RawMaterialResponseDto[]; total: number }> {
    this.logger.log('Fetching plastic & rubber materials', 'PlasticRubberContainerService');

    let queryBuilder = this.supabaseService
      .getClient(accessToken)
      .from('raw_materials')
      .select('*', { count: 'exact' })
      .or('material_group.ilike.%plastic%,material_group.ilike.%rubber%,material_group.ilike.%polymer%,material_group.ilike.%elastomer%');

    queryBuilder = this.applyFilters(queryBuilder, query);
    queryBuilder = this.applySorting(queryBuilder, query);

    const { data, error, count } = await queryBuilder;

    if (error) {
      this.logger.error(`Error fetching plastic & rubber materials: ${error.message}`, 'PlasticRubberContainerService');
      throw new InternalServerErrorException(`Failed to fetch plastic & rubber materials: ${error.message}`);
    }

    const items = (data || []).map(row => RawMaterialResponseDto.fromDatabase(row));
    return { items, total: count || 0 };
  }

  async getPlasticRubberMaterialById(
    id: string,
    userId: string,
    accessToken: string
  ): Promise<RawMaterialResponseDto> {
    this.logger.log(`Fetching plastic & rubber material: ${id}`, 'PlasticRubberContainerService');

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('raw_materials')
      .select('*')
      .eq('id', id)
      .or('material_group.ilike.%plastic%,material_group.ilike.%rubber%,material_group.ilike.%polymer%,material_group.ilike.%elastomer%')
      .single();

    if (error || !data) {
      this.logger.error(`Plastic & rubber material not found: ${id}`, 'PlasticRubberContainerService');
      throw new NotFoundException(`Plastic & rubber material with ID ${id} not found`);
    }

    return RawMaterialResponseDto.fromDatabase(data);
  }

  async createPlasticRubberMaterial(
    createDto: CreateRawMaterialDto,
    userId: string,
    accessToken: string
  ): Promise<RawMaterialResponseDto> {
    this.logger.log('Creating plastic & rubber material', 'PlasticRubberContainerService');

    this.validatePlasticRubberMaterial(createDto);

    const materialData = {
      material_group: this.ensurePlasticRubberCategory(createDto.materialGroup),
      material: createDto.material,
      material_abbreviation: createDto.materialAbbreviation,
      material_grade: createDto.materialGrade,
      stock_form: createDto.stockForm,
      matl_state: createDto.matlState,
      application: createDto.application,
      regrinding: createDto.regrinding,
      regrinding_percentage: createDto.regrindingPercentage,
      clamping_pressure_mpa: createDto.clampingPressureMpa,
      eject_deflection_temp_c: createDto.ejectDeflectionTempC,
      melting_temp_c: createDto.meltingTempC,
      mold_temp_c: createDto.moldTempC,
      density_kg_m3: createDto.densityKgM3,
      specific_heat_melt: createDto.specificHeatMelt,
      thermal_conductivity_melt: createDto.thermalConductivityMelt,
      location: createDto.location,
      year: createDto.year,
      q1_cost: createDto.q1Cost,
      q2_cost: createDto.q2Cost,
      q3_cost: createDto.q3Cost,
      q4_cost: createDto.q4Cost,
      user_id: userId,
    };

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('raw_materials')
      .insert(materialData)
      .select()
      .single();

    if (error) {
      this.logger.error(`Error creating plastic & rubber material: ${error.message}`, 'PlasticRubberContainerService');
      throw new InternalServerErrorException(`Failed to create plastic & rubber material: ${error.message}`);
    }

    return RawMaterialResponseDto.fromDatabase(data);
  }

  async updatePlasticRubberMaterial(
    id: string,
    updateDto: UpdateRawMaterialDto,
    userId: string,
    accessToken: string
  ): Promise<RawMaterialResponseDto> {
    this.logger.log(`Updating plastic & rubber material: ${id}`, 'PlasticRubberContainerService');

    await this.getPlasticRubberMaterialById(id, userId, accessToken);

    const updateData = this.buildUpdateData(updateDto);
    
    if (updateDto.materialGroup) {
      updateData.material_group = this.ensurePlasticRubberCategory(updateDto.materialGroup);
    }

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('raw_materials')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      this.logger.error(`Error updating plastic & rubber material: ${error.message}`, 'PlasticRubberContainerService');
      throw new InternalServerErrorException(`Failed to update plastic & rubber material: ${error.message}`);
    }

    return RawMaterialResponseDto.fromDatabase(data);
  }

  async getPlasticRubberStatistics(userId: string, accessToken: string): Promise<{
    totalMaterials: number;
    bySubtype: Record<string, number>;
    averageCosts: { q1: number; q2: number; q3: number; q4: number };
    locations: string[];
  }> {
    this.logger.log('Fetching plastic & rubber statistics', 'PlasticRubberContainerService');

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('raw_materials')
      .select('material_grade, location, q1_cost, q2_cost, q3_cost, q4_cost')
      .or('material_group.ilike.%plastic%,material_group.ilike.%rubber%,material_group.ilike.%polymer%,material_group.ilike.%elastomer%');

    if (error) {
      throw new InternalServerErrorException(`Failed to fetch statistics: ${error.message}`);
    }

    const materials = data || [];
    const bySubtype: Record<string, number> = {};
    let totalQ1 = 0, totalQ2 = 0, totalQ3 = 0, totalQ4 = 0;
    let costCount = 0;

    materials.forEach(material => {
      const subtype = material.material_grade || 'Unknown';
      bySubtype[subtype] = (bySubtype[subtype] || 0) + 1;

      if (material.q1_cost) { totalQ1 += parseFloat(material.q1_cost); costCount++; }
      if (material.q2_cost) totalQ2 += parseFloat(material.q2_cost);
      if (material.q3_cost) totalQ3 += parseFloat(material.q3_cost);
      if (material.q4_cost) totalQ4 += parseFloat(material.q4_cost);
    });

    const locations = [...new Set(materials.map(m => m.location).filter(Boolean))];

    return {
      totalMaterials: materials.length,
      bySubtype,
      averageCosts: {
        q1: costCount > 0 ? totalQ1 / costCount : 0,
        q2: costCount > 0 ? totalQ2 / costCount : 0,
        q3: costCount > 0 ? totalQ3 / costCount : 0,
        q4: costCount > 0 ? totalQ4 / costCount : 0,
      },
      locations,
    };
  }

  private validatePlasticRubberMaterial(createDto: CreateRawMaterialDto): void {
    const materialGroup = createDto.materialGroup.toLowerCase();
    if (!materialGroup.includes('plastic') && !materialGroup.includes('rubber') && 
        !materialGroup.includes('polymer') && !materialGroup.includes('elastomer')) {
      throw new InternalServerErrorException('Material must be plastic or rubber based');
    }
  }

  private ensurePlasticRubberCategory(materialGroup: string): string {
    const group = materialGroup.toLowerCase();
    if (group.includes('plastic') || group.includes('rubber') || 
        group.includes('polymer') || group.includes('elastomer')) {
      return materialGroup;
    }
    return 'Plastic & Rubber';
  }

  private applyFilters(queryBuilder: any, query: QueryRawMaterialsDto) {
    if (query.material) {
      queryBuilder = queryBuilder.eq('material', query.material);
    }
    if (query.location) {
      queryBuilder = queryBuilder.eq('location', query.location);
    }
    if (query.year) {
      queryBuilder = queryBuilder.eq('year', query.year);
    }
    if (query.search) {
      queryBuilder = queryBuilder.or(
        `material.ilike.%${query.search}%,material_abbreviation.ilike.%${query.search}%,material_grade.ilike.%${query.search}%,application.ilike.%${query.search}%`
      );
    }
    return queryBuilder;
  }

  private applySorting(queryBuilder: any, query: QueryRawMaterialsDto) {
    const sortBy = query.sortBy || 'material';
    const sortOrder = query.sortOrder || 'asc';
    return queryBuilder.order(sortBy, { ascending: sortOrder === 'asc' });
  }

  private buildUpdateData(updateDto: UpdateRawMaterialDto): any {
    const updateData: any = {};
    
    Object.entries(updateDto).forEach(([key, value]) => {
      if (value !== undefined) {
        const dbField = this.camelToSnakeCase(key);
        updateData[dbField] = value;
      }
    });

    return updateData;
  }

  private camelToSnakeCase(str: string): string {
    return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
  }
}