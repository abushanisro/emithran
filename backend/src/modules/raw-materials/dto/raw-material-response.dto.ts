import { ApiProperty } from '@nestjs/swagger';

export class RawMaterialResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  materialGroup: string;

  @ApiProperty()
  material: string;

  @ApiProperty({ required: false })
  materialGrade?: string;

  @ApiProperty({ required: false })
  materialType?: string;

  @ApiProperty({ required: false })
  materialDescription?: string;

  @ApiProperty({ required: false })
  densityKgM3?: number;

  @ApiProperty({ required: false })
  cost?: number;

  @ApiProperty({ required: false })
  unitCost?: number;

  @ApiProperty({ required: false })
  currency?: string;

  // Material properties
  @ApiProperty({ required: false, description: 'Material density in g/cm³' })
  density?: number;

  @ApiProperty({ required: false, description: 'Ultimate Tensile Strength in MPa' })
  ultimateTensileStrength?: number;

  @ApiProperty({ required: false, description: 'Yield Tensile Strength in MPa' })
  yieldTensileStrength?: number;

  @ApiProperty({ required: false, description: 'Shearing Strength in MPa' })
  shearingStrength?: number;

  @ApiProperty({ required: false })
  astmStandard?: string;

  @ApiProperty({ required: false })
  dinStandard?: string;

  @ApiProperty({ required: false })
  enStandard?: string;

  @ApiProperty({ required: false })
  jisStandard?: string;

  @ApiProperty({ required: false })
  shape?: string;

  @ApiProperty({ required: false })
  country?: string;

  // Plastic-specific properties

  @ApiProperty({ required: false })
  regrinding?: string;

  @ApiProperty({ required: false })
  regrindingPercentage?: number;

  @ApiProperty({ required: false })
  clampingPressureMpa?: number;

  @ApiProperty({ required: false })
  ejectDeflectionTempC?: number;

  @ApiProperty({ required: false })
  meltingTempC?: number;

  @ApiProperty({ required: false })
  moldTempC?: number;

  @ApiProperty({ required: false })
  specificHeatMelt?: number;

  @ApiProperty({ required: false })
  thermalConductivityMelt?: number;

  @ApiProperty()
  userId: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  static fromDatabase(row: any): RawMaterialResponseDto {
    const costValue = row.cost ? parseFloat(row.cost) : undefined;
    
    return {
      id: row.id,
      materialGroup: row.material_group,
      material: row.material,
      materialGrade: row.material_grade,
      materialType: row.material_type,
      materialDescription: row.material_description,
      densityKgM3: row.density_kg_m3 ? parseFloat(row.density_kg_m3) : undefined,
      cost: costValue,
      unitCost: costValue, // Map cost to unitCost for frontend compatibility
      currency: row.currency || 'INR', // Default to INR if not specified
      // Material properties
      density: row.density ? parseFloat(row.density) : undefined,
      ultimateTensileStrength: row.ultimate_tensile_strength ? parseFloat(row.ultimate_tensile_strength) : undefined,
      yieldTensileStrength: row.yield_tensile_strength ? parseFloat(row.yield_tensile_strength) : undefined,
      shearingStrength: row.shearing_strength ? parseFloat(row.shearing_strength) : undefined,
      astmStandard: row.astm_standard,
      dinStandard: row.din_standard,
      enStandard: row.en_standard,
      jisStandard: row.jis_standard,
      shape: row.shape,
      // Plastic-specific properties
      regrinding: row.regrinding,
      regrindingPercentage: row.regrinding_percentage ? parseFloat(row.regrinding_percentage) : undefined,
      clampingPressureMpa: row.clamping_pressure_mpa ? parseFloat(row.clamping_pressure_mpa) : undefined,
      ejectDeflectionTempC: row.eject_deflection_temp_c ? parseFloat(row.eject_deflection_temp_c) : undefined,
      meltingTempC: row.melting_temp_c ? parseFloat(row.melting_temp_c) : undefined,
      moldTempC: row.mold_temp_c ? parseFloat(row.mold_temp_c) : undefined,
      specificHeatMelt: row.specific_heat_melt ? parseFloat(row.specific_heat_melt) : undefined,
      thermalConductivityMelt: row.thermal_conductivity_melt ? parseFloat(row.thermal_conductivity_melt) : undefined,
      userId: row.user_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

export class RawMaterialListResponseDto {
  @ApiProperty({ type: [RawMaterialResponseDto] })
  items: RawMaterialResponseDto[];

  @ApiProperty()
  total: number;
}
