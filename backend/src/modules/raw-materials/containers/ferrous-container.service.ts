import { Injectable, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { Logger } from '../../../common/logger/logger.service';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { MaterialCategory } from '../constants/material-categories.constants';
import { CreateRawMaterialDto, UpdateRawMaterialDto, QueryRawMaterialsDto } from '../dto/raw-materials.dto';
import { RawMaterialResponseDto } from '../dto/raw-material-response.dto';

@Injectable()
export class FerrousContainerService {
  private readonly category = MaterialCategory.FERROUS;

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
      material_abbreviation: createDto.materialAbbreviation,
      material_grade: createDto.materialGrade,
      stock_form: createDto.stockForm,
      matl_state: createDto.matlState,
      application: createDto.application,
      density_kg_m3: createDto.densityKgM3,
      specific_heat_melt: createDto.specificHeatMelt,
      thermal_conductivity_melt: createDto.thermalConductivityMelt,
      melting_temp_c: createDto.meltingTempC,
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
    averageCosts: { q1: number; q2: number; q3: number; q4: number };
    locations: string[];
    compositionData: { material: string; grade: string; density: number }[];
  }> {
    this.logger.log('Fetching ferrous statistics', 'FerrousContainerService');

    const { data, error } = await this.supabaseService
      .getClient(accessToken)
      .from('raw_materials')
      .select('material, material_grade, location, density_kg_m3, q1_cost, q2_cost, q3_cost, q4_cost')
      .or('material_group.ilike.%ferrous%,material_group.ilike.%steel%,material_group.ilike.%iron%,material_group.ilike.%metal%');

    if (error) {
      throw new InternalServerErrorException(`Failed to fetch statistics: ${error.message}`);
    }

    const materials = data || [];
    const byGrade: Record<string, number> = {};
    let totalQ1 = 0, totalQ2 = 0, totalQ3 = 0, totalQ4 = 0;
    let costCount = 0;

    materials.forEach(material => {
      const grade = material.material_grade || 'Unknown';
      byGrade[grade] = (byGrade[grade] || 0) + 1;

      if (material.q1_cost) { totalQ1 += parseFloat(material.q1_cost); costCount++; }
      if (material.q2_cost) totalQ2 += parseFloat(material.q2_cost);
      if (material.q3_cost) totalQ3 += parseFloat(material.q3_cost);
      if (material.q4_cost) totalQ4 += parseFloat(material.q4_cost);
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
      averageCosts: {
        q1: costCount > 0 ? totalQ1 / costCount : 0,
        q2: costCount > 0 ? totalQ2 / costCount : 0,
        q3: costCount > 0 ? totalQ3 / costCount : 0,
        q4: costCount > 0 ? totalQ4 / costCount : 0,
      },
      locations,
      compositionData,
    };
  }

  async importFerrousDataFromExcel(
    excelData: any[],
    userId: string,
    accessToken: string
  ): Promise<{ imported: number; errors: string[] }> {
    this.logger.log(`Importing ${excelData.length} ferrous materials from Excel`, 'FerrousContainerService');

    const errors: string[] = [];
    let imported = 0;

    for (const row of excelData) {
      try {
        const materialDto = this.mapExcelRowToDto(row);
        await this.createFerrousMaterial(materialDto, userId, accessToken);
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

  private mapExcelRowToDto(row: any): CreateRawMaterialDto {
    return {
      materialGroup: 'Ferrous Materials',
      material: row.Material || row.material || '',
      materialAbbreviation: row.Abbreviation || row.abbreviation || '',
      materialGrade: row.Grade || row.grade || '',
      stockForm: row.StockForm || row.stock_form || '',
      matlState: row.State || row.state || '',
      application: row.Application || row.application || '',
      densityKgM3: this.parseNumber(row.Density || row.density),
      specificHeatMelt: this.parseNumber(row.SpecificHeat || row.specific_heat),
      thermalConductivityMelt: this.parseNumber(row.ThermalConductivity || row.thermal_conductivity),
      meltingTempC: this.parseNumber(row.MeltingPoint || row.melting_point),
      location: row.Location || row.location || '',
      year: this.parseNumber(row.Year || row.year) || new Date().getFullYear(),
      q1Cost: this.parseNumber(row.Q1Cost || row.q1_cost),
      q2Cost: this.parseNumber(row.Q2Cost || row.q2_cost),
      q3Cost: this.parseNumber(row.Q3Cost || row.q3_cost),
      q4Cost: this.parseNumber(row.Q4Cost || row.q4_cost),
    };
  }

  private parseNumber(value: any): number | undefined {
    if (value === null || value === undefined || value === '') return undefined;
    const parsed = parseFloat(value);
    return isNaN(parsed) ? undefined : parsed;
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