import { Injectable, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { Logger } from '../../common/logger/logger.service';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { CreateRawMaterialDto, UpdateRawMaterialDto, QueryRawMaterialsDto } from './dto/raw-materials.dto';
import { RawMaterialResponseDto, RawMaterialListResponseDto } from './dto/raw-material-response.dto';
import { PlasticRubberContainerService } from './containers/plastic-rubber-container.service';
import { FerrousContainerService } from './containers/ferrous-container.service';
import { MaterialCategory, MATERIAL_CATEGORY_LABELS } from './constants/material-categories.constants';

@Injectable()
export class RawMaterialsService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly logger: Logger,
    private readonly plasticRubberContainer: PlasticRubberContainerService,
    private readonly ferrousContainer: FerrousContainerService,
  ) {}

  async findAll(query: QueryRawMaterialsDto, userId?: string, accessToken?: string): Promise<RawMaterialListResponseDto> {
    this.logger.log('Fetching all raw materials', 'RawMaterialsService');

    let queryBuilder = this.supabaseService
      .getClient(accessToken)
      .from('raw_materials')
      .select('*', { count: 'exact' });

    // Apply filters
    if (query.materialGroup) {
      queryBuilder = queryBuilder.eq('material_group', query.materialGroup);
    }

    if (query.material) {
      queryBuilder = queryBuilder.eq('material', query.material);
    }

    if (query.country) {
      queryBuilder = queryBuilder.eq('country', query.country);
    }


    // Search across multiple fields
    if (query.search) {
      queryBuilder = queryBuilder.or(
        `material.ilike.%${query.search}%,material_group.ilike.%${query.search}%,material_grade.ilike.%${query.search}%,application.ilike.%${query.search}%`
      );
    }

    // Apply sorting
    const sortBy = query.sortBy || 'material';
    const sortOrder = query.sortOrder || 'asc';
    queryBuilder = queryBuilder.order(sortBy, { ascending: sortOrder === 'asc' });

    const { data, error, count } = await queryBuilder;

    if (error) {
      this.logger.error(`Error fetching raw materials: ${error.message}`, 'RawMaterialsService');
      throw new InternalServerErrorException(`Failed to fetch raw materials: ${error.message}`);
    }

    const items = (data || []).map(row => RawMaterialResponseDto.fromDatabase(row));

    return { items, total: count || 0 };
  }

  async getFilterOptions(userId?: string, accessToken?: string): Promise<{
    materialGroups: string[];
    materialTypes: string[];
    countries: string[];
    grades: string[];
  }> {
    this.logger.log('Fetching filter options', 'RawMaterialsService');

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('raw_materials')
      .select('material_group, material, material_grade, country, shape');

    if (error) {
      this.logger.error(`Error fetching filter options: ${error.message}`, 'RawMaterialsService');
      throw new InternalServerErrorException(`Failed to fetch filter options: ${error.message}`);
    }

    // Extract unique values
    const materialGroups = [...new Set(data.map(m => m.material_group).filter(Boolean))].sort();
    const materialTypes = [...new Set(data.map(m => m.material).filter(Boolean))].sort();
    const countries = [...new Set(data.map(m => m.country).filter(Boolean))].sort();
    const grades = [...new Set(data.map(m => m.material_grade).filter(Boolean))].sort();

    return {
      materialGroups,
      materialTypes,
      countries,
      grades,
    };
  }

  async findOne(id: string, userId: string, accessToken: string): Promise<RawMaterialResponseDto> {
    this.logger.log(`Fetching raw material: ${id}`, 'RawMaterialsService');

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('raw_materials')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !data) {
      this.logger.error(`Raw material not found: ${id}`, 'RawMaterialsService');
      throw new NotFoundException(`Raw material with ID ${id} not found`);
    }

    return RawMaterialResponseDto.fromDatabase(data);
  }

  async create(createRawMaterialDto: CreateRawMaterialDto, userId: string, accessToken: string): Promise<RawMaterialResponseDto> {
    this.logger.log('Creating raw material', 'RawMaterialsService');

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('raw_materials')
      .insert({
        material_group: createRawMaterialDto.materialGroup,
        material: createRawMaterialDto.material,
        material_grade: createRawMaterialDto.materialGrade,
        material_type: createRawMaterialDto.materialType,
        material_description: createRawMaterialDto.materialDescription,
        stock_form: createRawMaterialDto.stockForm,
        matl_state: createRawMaterialDto.matlState,
        application: createRawMaterialDto.application,
        regrinding: createRawMaterialDto.regrinding,
        regrinding_percentage: createRawMaterialDto.regrindingPercentage,
        clamping_pressure_mpa: createRawMaterialDto.clampingPressureMpa,
        eject_deflection_temp_c: createRawMaterialDto.ejectDeflectionTempC,
        melting_temp_c: createRawMaterialDto.meltingTempC,
        mold_temp_c: createRawMaterialDto.moldTempC,
        density_kg_m3: createRawMaterialDto.densityKgM3,
        specific_heat_melt: createRawMaterialDto.specificHeatMelt,
        thermal_conductivity_melt: createRawMaterialDto.thermalConductivityMelt,
        location: createRawMaterialDto.location,
        cost: createRawMaterialDto.cost || createRawMaterialDto.unitCost,
        currency: createRawMaterialDto.currency,
        // Additional properties
        density: createRawMaterialDto.density,
        ultimate_tensile_strength: createRawMaterialDto.ultimate_tensile_strength,
        yield_tensile_strength: createRawMaterialDto.yield_tensile_strength,
        shearing_strength: createRawMaterialDto.shearing_strength,
        astm_standard: createRawMaterialDto.astm_standard,
        din_standard: createRawMaterialDto.din_standard,
        en_standard: createRawMaterialDto.en_standard,
        jis_standard: createRawMaterialDto.jis_standard,
        country: createRawMaterialDto.country,
        shape: createRawMaterialDto.shape,
        user_id: userId,
      })
      .select()
      .single();

    if (error) {
      this.logger.error(
        `Error creating raw material: ${error.message}`,
        'RawMaterialsService',
      );
      this.logger.error(
        `Supabase error details: ${JSON.stringify(error)}`,
        'RawMaterialsService',
      );
      throw new InternalServerErrorException(
        `Failed to create raw material: ${error.message}. Details: ${error.details || 'N/A'}`,
      );
    }

    return RawMaterialResponseDto.fromDatabase(data);
  }

  async createBatch(materials: CreateRawMaterialDto[], userId: string, accessToken: string): Promise<number> {
    this.logger.log(`Batch creating ${materials.length} raw materials`, 'RawMaterialsService');

    const records = materials.map(dto => ({
      material_group: dto.materialGroup,
      material: dto.material,
      material_grade: dto.materialGrade,
      material_type: dto.materialType,
      material_description: dto.materialDescription,
      stock_form: dto.stockForm,
      matl_state: dto.matlState,
      application: dto.application,
      regrinding: dto.regrinding,
      regrinding_percentage: dto.regrindingPercentage,
      clamping_pressure_mpa: dto.clampingPressureMpa,
      eject_deflection_temp_c: dto.ejectDeflectionTempC,
      melting_temp_c: dto.meltingTempC,
      mold_temp_c: dto.moldTempC,
      density_kg_m3: dto.densityKgM3,
      specific_heat_melt: dto.specificHeatMelt,
      thermal_conductivity_melt: dto.thermalConductivityMelt,
      location: dto.location,
      cost: dto.cost || dto.unitCost,
      currency: dto.currency,
      // Additional properties
      density: dto.density,
      ultimate_tensile_strength: dto.ultimate_tensile_strength,
      yield_tensile_strength: dto.yield_tensile_strength,
      shearing_strength: dto.shearing_strength,
      astm_standard: dto.astm_standard,
      din_standard: dto.din_standard,
      en_standard: dto.en_standard,
      jis_standard: dto.jis_standard,
      country: dto.country,
      shape: dto.shape,
      user_id: userId,
    }));

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('raw_materials')
      .insert(records)
      .select();

    if (error) {
      this.logger.error(`Error batch creating materials: ${error.message}`, 'RawMaterialsService');
      throw new InternalServerErrorException(`Failed to batch create materials: ${error.message}`);
    }

    const count = data?.length || 0;
    this.logger.log(`Successfully created ${count} materials in batch`, 'RawMaterialsService');
    return count;
  }

  async update(id: string, updateRawMaterialDto: UpdateRawMaterialDto, userId: string, accessToken: string): Promise<RawMaterialResponseDto> {
    this.logger.log(`Updating raw material: ${id}`, 'RawMaterialsService');

    await this.findOne(id, userId, accessToken);

    const updateData: any = {};
    
    // Helper function to handle string fields - convert empty strings to null
    const handleStringField = (value: string | undefined): string | null | undefined => {
      if (value === undefined) return undefined;
      if (value === '') return null;
      return value;
    };
    
    // Helper function to handle number fields - convert empty strings/undefined to null
    const handleNumberField = (value: number | undefined): number | null | undefined => {
      if (value === undefined) return undefined;
      if (value === null) return null;
      return value;
    };
    
    if (updateRawMaterialDto.materialGroup !== undefined) updateData.material_group = handleStringField(updateRawMaterialDto.materialGroup);
    if (updateRawMaterialDto.material !== undefined) updateData.material = handleStringField(updateRawMaterialDto.material);
    if (updateRawMaterialDto.materialGrade !== undefined) updateData.material_grade = handleStringField(updateRawMaterialDto.materialGrade);
    if (updateRawMaterialDto.materialType !== undefined) updateData.material_type = handleStringField(updateRawMaterialDto.materialType);
    if (updateRawMaterialDto.materialDescription !== undefined) updateData.material_description = handleStringField(updateRawMaterialDto.materialDescription);
    if (updateRawMaterialDto.stockForm !== undefined) updateData.stock_form = handleStringField(updateRawMaterialDto.stockForm);
    if (updateRawMaterialDto.matlState !== undefined) updateData.matl_state = handleStringField(updateRawMaterialDto.matlState);
    if (updateRawMaterialDto.application !== undefined) updateData.application = handleStringField(updateRawMaterialDto.application);
    if (updateRawMaterialDto.regrinding !== undefined) updateData.regrinding = handleStringField(updateRawMaterialDto.regrinding);
    if (updateRawMaterialDto.regrindingPercentage !== undefined) updateData.regrinding_percentage = handleNumberField(updateRawMaterialDto.regrindingPercentage);
    if (updateRawMaterialDto.clampingPressureMpa !== undefined) updateData.clamping_pressure_mpa = handleNumberField(updateRawMaterialDto.clampingPressureMpa);
    if (updateRawMaterialDto.ejectDeflectionTempC !== undefined) updateData.eject_deflection_temp_c = handleNumberField(updateRawMaterialDto.ejectDeflectionTempC);
    if (updateRawMaterialDto.meltingTempC !== undefined) updateData.melting_temp_c = handleNumberField(updateRawMaterialDto.meltingTempC);
    if (updateRawMaterialDto.moldTempC !== undefined) updateData.mold_temp_c = handleNumberField(updateRawMaterialDto.moldTempC);
    if (updateRawMaterialDto.densityKgM3 !== undefined) updateData.density_kg_m3 = handleNumberField(updateRawMaterialDto.densityKgM3);
    if (updateRawMaterialDto.specificHeatMelt !== undefined) updateData.specific_heat_melt = handleNumberField(updateRawMaterialDto.specificHeatMelt);
    if (updateRawMaterialDto.thermalConductivityMelt !== undefined) updateData.thermal_conductivity_melt = handleNumberField(updateRawMaterialDto.thermalConductivityMelt);
    if (updateRawMaterialDto.location !== undefined) updateData.location = handleStringField(updateRawMaterialDto.location);
    if (updateRawMaterialDto.cost !== undefined) updateData.cost = handleNumberField(updateRawMaterialDto.cost);
    if (updateRawMaterialDto.unitCost !== undefined) updateData.cost = handleNumberField(updateRawMaterialDto.unitCost);
    if (updateRawMaterialDto.currency !== undefined) updateData.currency = updateRawMaterialDto.currency;
    
    // Update additional properties
    if (updateRawMaterialDto.density !== undefined) updateData.density = handleNumberField(updateRawMaterialDto.density);
    if (updateRawMaterialDto.ultimate_tensile_strength !== undefined) updateData.ultimate_tensile_strength = handleNumberField(updateRawMaterialDto.ultimate_tensile_strength);
    if (updateRawMaterialDto.yield_tensile_strength !== undefined) updateData.yield_tensile_strength = handleNumberField(updateRawMaterialDto.yield_tensile_strength);
    if (updateRawMaterialDto.shearing_strength !== undefined) updateData.shearing_strength = handleNumberField(updateRawMaterialDto.shearing_strength);
    if (updateRawMaterialDto.astm_standard !== undefined) updateData.astm_standard = handleStringField(updateRawMaterialDto.astm_standard);
    if (updateRawMaterialDto.din_standard !== undefined) updateData.din_standard = handleStringField(updateRawMaterialDto.din_standard);
    if (updateRawMaterialDto.en_standard !== undefined) updateData.en_standard = handleStringField(updateRawMaterialDto.en_standard);
    if (updateRawMaterialDto.jis_standard !== undefined) updateData.jis_standard = handleStringField(updateRawMaterialDto.jis_standard);
    if (updateRawMaterialDto.country !== undefined) updateData.country = handleStringField(updateRawMaterialDto.country);
    if (updateRawMaterialDto.shape !== undefined) updateData.shape = handleStringField(updateRawMaterialDto.shape);

    this.logger.debug(`Update data to be sent to database: ${JSON.stringify(updateData, null, 2)}`, 'RawMaterialsService');

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('raw_materials')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      this.logger.error(`Error updating raw material: ${error.message}`, 'RawMaterialsService');
      throw new InternalServerErrorException(`Failed to update raw material: ${error.message}`);
    }

    return RawMaterialResponseDto.fromDatabase(data);
  }

  async remove(id: string, userId: string, accessToken: string) {
    this.logger.log(`Deleting raw material: ${id}`, 'RawMaterialsService');

    await this.findOne(id, userId, accessToken);

    const { error } = await this.supabaseService
      .getClient(accessToken)
      .from('raw_materials')
      .delete()
      .eq('id', id);

    if (error) {
      this.logger.error(`Error deleting raw material: ${error.message}`, 'RawMaterialsService');
      throw new InternalServerErrorException(`Failed to delete raw material: ${error.message}`);
    }

    return { message: 'Raw material deleted successfully' };
  }

  async removeAll(userId: string, accessToken: string) {
    this.logger.log(`Deleting all raw materials for user: ${userId}`, 'RawMaterialsService');

    // First, get count of materials to be deleted
    const { count } = await this.supabaseService
      .getClient(accessToken)
      .from('raw_materials')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);

    if (count === 0) {
      return { message: 'No materials to delete', deleted: 0 };
    }

    // Delete all materials for this user
    const { error } = await this.supabaseService
      .getClient(accessToken)
      .from('raw_materials')
      .delete()
      .eq('user_id', userId);

    if (error) {
      this.logger.error(`Error deleting all raw materials: ${error.message}`, 'RawMaterialsService');
      throw new InternalServerErrorException(`Failed to delete all raw materials: ${error.message}`);
    }

    this.logger.log(`Successfully deleted ${count} raw materials`, 'RawMaterialsService');
    return { message: `Successfully deleted ${count} raw material(s)`, deleted: count };
  }

  async getGroupedByMaterialGroup(userId: string, accessToken: string): Promise<any> {
    this.logger.log('Fetching raw materials grouped by material group', 'RawMaterialsService');

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('raw_materials')
      .select('material_group, material, material_abbreviation')
      .order('material_group', { ascending: true })
      .order('material', { ascending: true });

    if (error) {
      this.logger.error(`Error fetching grouped materials: ${error.message}`, 'RawMaterialsService');
      throw new InternalServerErrorException(`Failed to fetch grouped materials: ${error.message}`);
    }

    // Group by material_group
    const grouped = (data || []).reduce((acc: any, row: any) => {
      const group = row.material_group || 'Uncategorized';
      if (!acc[group]) {
        acc[group] = [];
      }
      acc[group].push({
        material: row.material,
        abbreviation: row.material_abbreviation,
      });
      return acc;
    }, {});

    return grouped;
  }

  async getPlasticRubberMaterials(
    query: QueryRawMaterialsDto,
    userId?: string,
    accessToken?: string
  ): Promise<RawMaterialListResponseDto> {
    this.logger.log('Fetching plastic & rubber materials via enhanced service', 'RawMaterialsService');
    return this.plasticRubberContainer.findAllPlasticRubberMaterials(query, userId, accessToken);
  }

  async getFerrousMaterials(
    query: QueryRawMaterialsDto,
    userId?: string,
    accessToken?: string
  ): Promise<RawMaterialListResponseDto> {
    this.logger.log('Fetching ferrous materials via enhanced service', 'RawMaterialsService');
    return this.ferrousContainer.findAllFerrousMaterials(query, userId, accessToken);
  }

  async getPlasticRubberMaterialById(
    id: string,
    userId: string,
    accessToken: string
  ): Promise<RawMaterialResponseDto> {
    return this.plasticRubberContainer.getPlasticRubberMaterialById(id, userId, accessToken);
  }

  async getFerrousMaterialById(
    id: string,
    userId: string,
    accessToken: string
  ): Promise<RawMaterialResponseDto> {
    return this.ferrousContainer.getFerrousMaterialById(id, userId, accessToken);
  }

  async createPlasticRubberMaterial(
    createDto: CreateRawMaterialDto,
    userId: string,
    accessToken: string
  ): Promise<RawMaterialResponseDto> {
    return this.plasticRubberContainer.createPlasticRubberMaterial(createDto, userId, accessToken);
  }

  async createFerrousMaterial(
    createDto: CreateRawMaterialDto,
    userId: string,
    accessToken: string
  ): Promise<RawMaterialResponseDto> {
    return this.ferrousContainer.createFerrousMaterial(createDto, userId, accessToken);
  }

  async updatePlasticRubberMaterial(
    id: string,
    updateDto: UpdateRawMaterialDto,
    userId: string,
    accessToken: string
  ): Promise<RawMaterialResponseDto> {
    return this.plasticRubberContainer.updatePlasticRubberMaterial(id, updateDto, userId, accessToken);
  }

  async updateFerrousMaterial(
    id: string,
    updateDto: UpdateRawMaterialDto,
    userId: string,
    accessToken: string
  ): Promise<RawMaterialResponseDto> {
    return this.ferrousContainer.updateFerrousMaterial(id, updateDto, userId, accessToken);
  }

  async getMaterialCategoryStatistics(userId: string, accessToken: string): Promise<{
    plasticRubber: any;
    ferrous: any;
    summary: {
      totalMaterials: number;
      categoryCounts: Record<string, number>;
    };
  }> {
    this.logger.log('Fetching material category statistics', 'RawMaterialsService');

    const [plasticRubberStats, ferrousStats] = await Promise.all([
      this.plasticRubberContainer.getPlasticRubberStatistics(userId, accessToken),
      this.ferrousContainer.getFerrousStatistics(userId, accessToken),
    ]);

    return {
      plasticRubber: plasticRubberStats,
      ferrous: ferrousStats,
      summary: {
        totalMaterials: plasticRubberStats.totalMaterials + ferrousStats.totalMaterials,
        categoryCounts: {
          [MATERIAL_CATEGORY_LABELS.PLASTIC_RUBBER]: plasticRubberStats.totalMaterials,
          [MATERIAL_CATEGORY_LABELS.FERROUS_NON_FERROUS]: ferrousStats.totalMaterials,
        },
      },
    };
  }

  async importFerrousDataFromExcel(
    excelData: any[],
    userId: string,
    accessToken: string
  ): Promise<{ imported: number; errors: string[] }> {
    this.logger.log('Importing ferrous materials from Excel', 'RawMaterialsService');
    return this.ferrousContainer.importFerrousDataFromExcel(excelData, userId, accessToken);
  }

  async getMaterialCategories(): Promise<{ categories: typeof MATERIAL_CATEGORY_LABELS }> {
    return {
      categories: MATERIAL_CATEGORY_LABELS,
    };
  }

  async getEnhancedMaterials(
    query: {
      page: number;
      limit: number;
      category?: string;
      search?: string;
    },
    userId?: string,
    accessToken?: string
  ): Promise<{
    items: any[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
      hasNext: boolean;
      hasPrev: boolean;
    };
    success: boolean;
  }> {
    this.logger.log('Fetching enhanced raw materials', 'RawMaterialsService');

    // Use the reliable fallback approach directly
    this.logger.log('Using raw_materials table for enhanced materials', 'RawMaterialsService');
    
    let queryBuilder = this.supabaseService
      .getClient(accessToken)
      .from('raw_materials')
      .select('*', { count: 'exact' });

    // Apply filters to query
    if (query.category && query.category !== 'all') {
      // Map category codes to material group names
      const categoryMapping: { [key: string]: string } = {
        'PLASTIC': 'Plastic & Rubber',
        'THERMO': 'Plastic & Rubber',
        'FERROUS': 'Ferrous & Non-Ferrous',
        'NON_FERROUS': 'Ferrous & Non-Ferrous',
        'AL_ALLOY': 'Ferrous & Non-Ferrous',
        'CU_ALLOY': 'Ferrous & Non-Ferrous',
        'SS': 'Ferrous & Non-Ferrous'
      };
      
      const materialGroup = categoryMapping[query.category] || query.category;
      queryBuilder = queryBuilder.eq('material_group', materialGroup);
    }

    if (query.search) {
      queryBuilder = queryBuilder.or(
        `material.ilike.%${query.search}%,material_group.ilike.%${query.search}%,material_grade.ilike.%${query.search}%,application.ilike.%${query.search}%`
      );
    }

    // Apply pagination
    const offset = (query.page - 1) * query.limit;
    queryBuilder = queryBuilder.range(offset, offset + query.limit - 1);
    queryBuilder = queryBuilder.order('material', { ascending: true });

    const { data, error, count } = await queryBuilder;

    if (error) {
      this.logger.error(`Enhanced materials query failed: ${error.message}`, 'RawMaterialsService');
      throw new InternalServerErrorException(`Failed to fetch materials: ${error.message}`);
    }

    // Transform data to match enhanced format with proper null handling
    const transformedData = (data || []).map(item => {
      // Ensure we have valid material name
      const materialName = item.material || item.material_name || 'Unknown Material';
      const materialGrade = item.material_grade || '';
      const materialGroup = item.material_group || 'Unknown';
      
      return {
        id: item.id,
        materialName: materialName,
        materialGrade: materialGrade,
        materialSpecification: item.application || item.material_specification || '',
        manufacturer: item.manufacturer || '',
        supplier: item.supplier || '',
        categoryName: materialGroup,
        categoryCode: materialGroup === 'Plastic & Rubber' ? 'PLASTIC' : 'FERROUS',
        colorCode: materialGroup === 'Plastic & Rubber' ? '#4CAF50' : '#FF5722',
        costPerKg: item.cost || item.cost_per_kg || 0,
        costPerUnit: item.cost || item.cost_per_unit || 0,
        unitType: 'kg',
        densityKgM3: item.density_kg_m3 || null,
        utsMpa: item.ultimate_tensile_strength || item.uts_mpa || null,
        ytsMpa: item.yield_tensile_strength || item.yts_mpa || null,
        elasticModulusGpa: item.elastic_modulus_gpa || null,
        hardnessValue: item.hardness_value || null,
        hardnessScale: item.hardness_scale || null,
        meltingTempCelsius: item.melting_temp_c || item.melting_temp_celsius || null,
        ejectDeflectionTempCelsius: item.eject_deflection_temp_c || item.eject_deflection_temp_celsius || null,
        thermalConductivityWMK: item.thermal_conductivity_melt || item.thermal_conductivity_w_m_k || null,
        specificHeatJGK: item.specific_heat_melt || item.specific_heat_j_g_k || null,
        maxServiceTempCelsius: item.max_service_temp_celsius || null,
        moldTempCelsiusMin: item.mold_temp_c || item.mold_temp_celsius_min || null,
        moldTempCelsiusMax: item.mold_temp_c || item.mold_temp_celsius_max || null,
        clampingPressureMpa: item.clamping_pressure_mpa || null,
        injectionPressureMpaMin: item.injection_pressure_mpa_min || null,
        injectionPressureMpaMax: item.injection_pressure_mpa_max || null,
        shrinkageRatePercent: item.regrinding_percentage || item.shrinkage_rate_percent || null,
        storageLocation: item.location || item.storage_location || '',
        leadTimeDays: item.lead_time_days || null,
        minimumOrderQuantity: item.minimum_order_quantity || null,
        qualityGrade: item.quality_grade || '',
        // Add missing fields
        country: item.country || '',
        shape: item.shape || '',
        status: 'active',
        createdAt: item.created_at || new Date().toISOString(),
        updatedAt: item.updated_at || new Date().toISOString(),
      };
    });

    return {
      items: transformedData,
      pagination: {
        page: query.page,
        limit: query.limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / query.limit),
        hasNext: query.page < Math.ceil((count || 0) / query.limit),
        hasPrev: query.page > 1,
      },
      success: true,
    };
  }
}
