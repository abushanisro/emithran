import { Injectable, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { Logger } from '../../../common/logger/logger.service';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { MaterialCategory } from '../constants/material-categories.constants';
import { CreateRawMaterialDto, UpdateRawMaterialDto, QueryRawMaterialsDto } from '../dto/raw-materials.dto';
import { RawMaterialResponseDto } from '../dto/raw-material-response.dto';

@Injectable()
export class FerrousContainerService {
  private readonly category = MaterialCategory.FERROUS_NON_FERROUS;

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly logger: Logger,
  ) {}

  async findAllFerrousMaterials(
    query: QueryRawMaterialsDto,
    userId?: string,
    accessToken?: string
  ): Promise<{ items: RawMaterialResponseDto[]; total: number }> {
    this.logger.log('Fetching ferrous materials', 'FerrousContainerService');

    let queryBuilder = this.supabaseService
      .getClient(accessToken)
      .from('raw_materials')
      .select('*', { count: 'exact' })
      .or('material_group.ilike.%ferrous%,material_group.ilike.%steel%,material_group.ilike.%iron%,material_group.ilike.%metal%');

    queryBuilder = this.applyFilters(queryBuilder, query);
    queryBuilder = this.applySorting(queryBuilder, query);

    const { data, error, count } = await queryBuilder;

    if (error) {
      this.logger.error(`Error fetching ferrous materials: ${error.message}`, 'FerrousContainerService');
      throw new InternalServerErrorException(`Failed to fetch ferrous materials: ${error.message}`);
    }

    const items = (data || []).map(row => RawMaterialResponseDto.fromDatabase(row));
    return { items, total: count || 0 };
  }

  async getFerrousMaterialById(
    id: string,
    userId: string,
    accessToken: string
  ): Promise<RawMaterialResponseDto> {
    this.logger.log(`Fetching ferrous material: ${id}`, 'FerrousContainerService');

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('raw_materials')
      .select('*')
      .eq('id', id)
      .or('material_group.ilike.%ferrous%,material_group.ilike.%steel%,material_group.ilike.%iron%,material_group.ilike.%metal%')
      .single();

    if (error || !data) {
      this.logger.error(`Ferrous material not found: ${id}`, 'FerrousContainerService');
      throw new NotFoundException(`Ferrous material with ID ${id} not found`);
    }

    return RawMaterialResponseDto.fromDatabase(data);
  }

  async createFerrousMaterial(
    createDto: CreateRawMaterialDto,
    userId: string,
    accessToken: string
  ): Promise<RawMaterialResponseDto> {
    this.logger.log('Creating ferrous material', 'FerrousContainerService');

    this.validateFerrousMaterial(createDto);

    const materialData = {
      material_group: this.ensureFerrousCategory(createDto.materialGroup),
      material: createDto.material,
      material_type: createDto.materialType,
      material_grade: createDto.materialGrade,
      material_description: createDto.materialDescription,
      stock_form: createDto.stockForm,
      matl_state: createDto.matlState,
      application: createDto.application,
      density_kg_m3: createDto.densityKgM3,
      density: createDto.density,
      specific_heat_melt: createDto.specificHeatMelt,
      thermal_conductivity_melt: createDto.thermalConductivityMelt,
      melting_temp_c: createDto.meltingTempC,
      location: createDto.location,
      currency: createDto.currency || 'USD',
      cost: createDto.costIndia ?? createDto.cost ?? createDto.unitCost,
      cost_france: createDto.costFrance,
      cost_germany: createDto.costGermany,
      cost_w_europe: createDto.costWEurope,
      cost_usa: createDto.costUsa,
      cost_india: createDto.costIndia,
      cost_e_europe: createDto.costEEurope,
      cost_china: createDto.costChina,
      cost_mexico: createDto.costMexico,
      ultimate_tensile_strength: createDto.ultimate_tensile_strength,
      yield_tensile_strength: createDto.yield_tensile_strength,
      shearing_strength: createDto.shearing_strength,
      hardness: createDto.hardness,
      hardness_system: createDto.hardnessSystem,
      cut_code: createDto.cutCode,
      astm_standard: createDto.astm_standard,
      din_standard: createDto.din_standard,
      en_standard: createDto.en_standard,
      jis_standard: createDto.jis_standard,
      user_id: userId,
    };

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('raw_materials')
      .insert(materialData)
      .select()
      .single();

    if (error) {
      this.logger.error(`Error creating ferrous material: ${error.message}`, 'FerrousContainerService');
      throw new InternalServerErrorException(`Failed to create ferrous material: ${error.message}`);
    }

    return RawMaterialResponseDto.fromDatabase(data);
  }

  async updateFerrousMaterial(
    id: string,
    updateDto: UpdateRawMaterialDto,
    userId: string,
    accessToken: string
  ): Promise<RawMaterialResponseDto> {
    this.logger.log(`Updating ferrous material: ${id}`, 'FerrousContainerService');

    await this.getFerrousMaterialById(id, userId, accessToken);

    const updateData = this.buildUpdateData(updateDto);
    
    if (updateDto.materialGroup) {
      updateData.material_group = this.ensureFerrousCategory(updateDto.materialGroup);
    }

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('raw_materials')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      this.logger.error(`Error updating ferrous material: ${error.message}`, 'FerrousContainerService');
      throw new InternalServerErrorException(`Failed to update ferrous material: ${error.message}`);
    }

    return RawMaterialResponseDto.fromDatabase(data);
  }

  async getFerrousStatistics(userId: string, accessToken: string): Promise<{
    totalMaterials: number;
    byGrade: Record<string, number>;
    averageCost: number;
    locations: string[];
    compositionData: { material: string; grade: string; density: number }[];
  }> {
    this.logger.log('Fetching ferrous statistics', 'FerrousContainerService');

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('raw_materials')
      .select('material, material_grade, location, density_kg_m3, cost')
      .or('material_group.ilike.%ferrous%,material_group.ilike.%steel%,material_group.ilike.%iron%,material_group.ilike.%metal%');

    if (error) {
      throw new InternalServerErrorException(`Failed to fetch statistics: ${error.message}`);
    }

    const materials = data || [];
    const byGrade: Record<string, number> = {};
    let totalCost = 0;
    let costCount = 0;

    materials.forEach(material => {
      const grade = material.material_grade || 'Unknown';
      byGrade[grade] = (byGrade[grade] || 0) + 1;

      if (material.cost) { totalCost += parseFloat(material.cost); costCount++; }
    });

    const locations = [...new Set(materials.map(m => m.location).filter(Boolean))];
    
    const compositionData = materials
      .filter(m => m.density_kg_m3)
      .map(m => ({
        material: m.material,
        grade: m.material_grade || 'Unknown',
        density: parseFloat(m.density_kg_m3),
      }));

    return {
      totalMaterials: materials.length,
      byGrade,
      averageCost: costCount > 0 ? totalCost / costCount : 0,
      locations,
      compositionData,
    };
  }

  // Excel import is handled by RawMaterialsController → RawMaterialsService.createBatch()
  // which does full field mapping including regional costs and standards.
  // This method is kept for the RawMaterialsService.importFerrousDataFromExcel() call
  // site but delegates to createFerrousMaterial so all field mapping stays in one place.
  async importFerrousDataFromExcel(
    excelData: CreateRawMaterialDto[],
    userId: string,
    accessToken: string
  ): Promise<{ imported: number; errors: string[] }> {
    this.logger.log(`Importing ${excelData.length} ferrous materials from Excel`, 'FerrousContainerService');

    const errors: string[] = [];
    let imported = 0;

    for (const dto of excelData) {
      try {
        await this.createFerrousMaterial(dto, userId, accessToken);
        imported++;
      } catch (error) {
        errors.push(`Row ${imported + errors.length + 1}: ${error.message}`);
      }
    }

    return { imported, errors };
  }

  private validateFerrousMaterial(createDto: CreateRawMaterialDto): void {
    const materialGroup = createDto.materialGroup.toLowerCase();
    if (!materialGroup.includes('ferrous') && !materialGroup.includes('steel') && 
        !materialGroup.includes('iron') && !materialGroup.includes('metal')) {
      throw new InternalServerErrorException('Material must be ferrous-based');
    }
  }

  private ensureFerrousCategory(materialGroup: string): string {
    const group = materialGroup.toLowerCase();
    if (group.includes('ferrous') || group.includes('steel') || 
        group.includes('iron') || group.includes('metal')) {
      return materialGroup;
    }
    return 'Ferrous Materials';
  }

  private applyFilters(queryBuilder: any, query: QueryRawMaterialsDto) {
    if (query.material) {
      queryBuilder = queryBuilder.eq('material', query.material);
    }
    if (query.search) {
      queryBuilder = queryBuilder.or(
        `material_type.ilike.%${query.search}%,material.ilike.%${query.search}%,astm_standard.ilike.%${query.search}%,din_standard.ilike.%${query.search}%`
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
        // unitCost is an alias for the `cost` column — not a separate DB column.
        if (key === 'unitCost') {
          updateData.cost = value;
          return;
        }
        updateData[this.camelToSnakeCase(key)] = value;
      }
    });

    return updateData;
  }

  private camelToSnakeCase(str: string): string {
    return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
  }
}