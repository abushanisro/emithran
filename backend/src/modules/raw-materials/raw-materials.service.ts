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

    if (query.location) {
      queryBuilder = queryBuilder.eq('location', query.location);
    }

    if (query.year) {
      queryBuilder = queryBuilder.eq('year', query.year);
    }

    // Search across multiple fields
    if (query.search) {
      queryBuilder = queryBuilder.or(
        `material.ilike.%${query.search}%,material_group.ilike.%${query.search}%,material_abbreviation.ilike.%${query.search}%,material_grade.ilike.%${query.search}%,application.ilike.%${query.search}%`
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
    locations: string[];
    grades: string[];
    years: number[];
  }> {
    this.logger.log('Fetching filter options', 'RawMaterialsService');

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('raw_materials')
      .select('material_group, material, location, material_grade, year');

    if (error) {
      this.logger.error(`Error fetching filter options: ${error.message}`, 'RawMaterialsService');
      throw new InternalServerErrorException(`Failed to fetch filter options: ${error.message}`);
    }

    // Extract unique values
    const materialGroups = [...new Set(data.map(m => m.material_group).filter(Boolean))].sort();
    const materialTypes = [...new Set(data.map(m => m.material).filter(Boolean))].sort();
    const locations = [...new Set(data.map(m => m.location).filter(Boolean))].sort();
    const grades = [...new Set(data.map(m => m.material_grade).filter(Boolean))].sort();
    const years = [...new Set(data.map(m => m.year).filter(Boolean))].sort((a, b) => b - a);

    return {
      materialGroups,
      materialTypes,
      locations,
      grades,
      years,
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
        material_abbreviation: createRawMaterialDto.materialAbbreviation,
        material_grade: createRawMaterialDto.materialGrade,
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
        year: createRawMaterialDto.year,
        q1_cost: createRawMaterialDto.q1Cost,
        q2_cost: createRawMaterialDto.q2Cost,
        q3_cost: createRawMaterialDto.q3Cost,
        q4_cost: createRawMaterialDto.q4Cost,
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
      material_abbreviation: dto.materialAbbreviation,
      material_grade: dto.materialGrade,
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
      year: dto.year,
      q1_cost: dto.q1Cost,
      q2_cost: dto.q2Cost,
      q3_cost: dto.q3Cost,
      q4_cost: dto.q4Cost,
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
    if (updateRawMaterialDto.materialGroup !== undefined) updateData.material_group = updateRawMaterialDto.materialGroup;
    if (updateRawMaterialDto.material !== undefined) updateData.material = updateRawMaterialDto.material;
    if (updateRawMaterialDto.materialAbbreviation !== undefined) updateData.material_abbreviation = updateRawMaterialDto.materialAbbreviation;
    if (updateRawMaterialDto.materialGrade !== undefined) updateData.material_grade = updateRawMaterialDto.materialGrade;
    if (updateRawMaterialDto.stockForm !== undefined) updateData.stock_form = updateRawMaterialDto.stockForm;
    if (updateRawMaterialDto.matlState !== undefined) updateData.matl_state = updateRawMaterialDto.matlState;
    if (updateRawMaterialDto.application !== undefined) updateData.application = updateRawMaterialDto.application;
    if (updateRawMaterialDto.regrinding !== undefined) updateData.regrinding = updateRawMaterialDto.regrinding;
    if (updateRawMaterialDto.regrindingPercentage !== undefined) updateData.regrinding_percentage = updateRawMaterialDto.regrindingPercentage;
    if (updateRawMaterialDto.clampingPressureMpa !== undefined) updateData.clamping_pressure_mpa = updateRawMaterialDto.clampingPressureMpa;
    if (updateRawMaterialDto.ejectDeflectionTempC !== undefined) updateData.eject_deflection_temp_c = updateRawMaterialDto.ejectDeflectionTempC;
    if (updateRawMaterialDto.meltingTempC !== undefined) updateData.melting_temp_c = updateRawMaterialDto.meltingTempC;
    if (updateRawMaterialDto.moldTempC !== undefined) updateData.mold_temp_c = updateRawMaterialDto.moldTempC;
    if (updateRawMaterialDto.densityKgM3 !== undefined) updateData.density_kg_m3 = updateRawMaterialDto.densityKgM3;
    if (updateRawMaterialDto.specificHeatMelt !== undefined) updateData.specific_heat_melt = updateRawMaterialDto.specificHeatMelt;
    if (updateRawMaterialDto.thermalConductivityMelt !== undefined) updateData.thermal_conductivity_melt = updateRawMaterialDto.thermalConductivityMelt;
    if (updateRawMaterialDto.location !== undefined) updateData.location = updateRawMaterialDto.location;
    if (updateRawMaterialDto.year !== undefined) updateData.year = updateRawMaterialDto.year;
    if (updateRawMaterialDto.q1Cost !== undefined) updateData.q1_cost = updateRawMaterialDto.q1Cost;
    if (updateRawMaterialDto.q2Cost !== undefined) updateData.q2_cost = updateRawMaterialDto.q2Cost;
    if (updateRawMaterialDto.q3Cost !== undefined) updateData.q3_cost = updateRawMaterialDto.q3Cost;
    if (updateRawMaterialDto.q4Cost !== undefined) updateData.q4_cost = updateRawMaterialDto.q4Cost;

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
          [MATERIAL_CATEGORY_LABELS.FERROUS]: ferrousStats.totalMaterials,
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
}
