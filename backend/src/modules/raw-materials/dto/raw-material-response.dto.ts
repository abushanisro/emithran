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

  // Regional costs
  @ApiProperty({ required: false })
  costFrance?: number;

  @ApiProperty({ required: false })
  costGermany?: number;

  @ApiProperty({ required: false })
  costWEurope?: number;

  @ApiProperty({ required: false })
  costUsa?: number;

  @ApiProperty({ required: false })
  costIndia?: number;

  @ApiProperty({ required: false })
  costEEurope?: number;

  @ApiProperty({ required: false })
  costChina?: number;

  @ApiProperty({ required: false })
  costMexico?: number;

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
  stockForm?: string;

  @ApiProperty({ required: false })
  matlState?: string;

  @ApiProperty({ required: false })
  country?: string;

  @ApiProperty({ required: false })
  hardness?: number;

  @ApiProperty({ required: false })
  hardnessSystem?: string;

  @ApiProperty({ required: false })
  cutCode?: number;

  @ApiProperty({ required: false })
  elasticModulusGpa?: number;

  @ApiProperty({ required: false })
  poissonRatio?: number;

  @ApiProperty({ required: false, description: 'Strength coefficient K (MPa) in sigma = K * epsilon^n' })
  strengthCoeffKMpa?: number;

  @ApiProperty({ required: false, description: 'Strain-hardening exponent n in sigma = K * epsilon^n' })
  strainHardeningExponentN?: number;

  @ApiProperty({ required: false, description: 'Lankford (normal anisotropy) coefficient R' })
  lankfordCoefficientR?: number;

  @ApiProperty({ required: false, description: 'Recommended milling cutting speed (m/min), where sourced' })
  millingSpeedMMin?: number;

  @ApiProperty({ required: false, description: 'Scrap/yield-loss fraction (0-1)' })
  scrapFactor?: number;

  @ApiProperty({ required: false })
  elongationPct?: number;

  @ApiProperty({ required: false })
  electricalConductivityIacsPct?: number;

  @ApiProperty({ required: false })
  thermalConductivityWMk?: number;

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
    const costValue = row.cost_india ?? (row.cost ? parseFloat(row.cost) : undefined);
    // `cost`/`cost_india` are always INR by column definition (migration 069:
    // "Material cost per unit in INR") — row.currency is only reliable when a
    // distinct currency was actually recorded for this row (e.g. an imported
    // material priced in a listed non-INR currency). Defaulting to 'USD'
    // whenever row.currency was null silently mislabeled INR-sourced values
    // as USD — confirmed live: costValue backed by cost_india displayed as
    // "$X USD" instead of "₹X". Leave undefined (not a guessed default) when
    // there's no cost value to label at all.
    const currency = row.currency || (costValue !== undefined ? 'INR' : undefined);

    return {
      id: row.id,
      materialGroup: row.material_group,
      material: row.material,
      materialGrade: row.material_grade,
      materialType: row.material_type,
      materialDescription: row.material_description,
      densityKgM3: row.density_kg_m3 ? parseFloat(row.density_kg_m3) : undefined,
      cost: costValue ? parseFloat(String(costValue)) : undefined,
      unitCost: costValue ? parseFloat(String(costValue)) : undefined,
      currency,
      // Regional costs
      costFrance: row.cost_france ? parseFloat(row.cost_france) : undefined,
      costGermany: row.cost_germany ? parseFloat(row.cost_germany) : undefined,
      costWEurope: row.cost_w_europe ? parseFloat(row.cost_w_europe) : undefined,
      costUsa: row.cost_usa ? parseFloat(row.cost_usa) : undefined,
      costIndia: row.cost_india ? parseFloat(row.cost_india) : undefined,
      costEEurope: row.cost_e_europe ? parseFloat(row.cost_e_europe) : undefined,
      costChina: row.cost_china ? parseFloat(row.cost_china) : undefined,
      costMexico: row.cost_mexico ? parseFloat(row.cost_mexico) : undefined,
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
      stockForm: row.stock_form,
      matlState: row.matl_state,
      country: row.country,
      hardness: row.hardness ? parseFloat(row.hardness) : undefined,
      hardnessSystem: row.hardness_system,
      cutCode: row.cut_code ? parseFloat(row.cut_code) : undefined,
      elasticModulusGpa: row.elastic_modulus_gpa ? parseFloat(row.elastic_modulus_gpa) : undefined,
      poissonRatio: row.poisson_ratio ? parseFloat(row.poisson_ratio) : undefined,
      strengthCoeffKMpa: row.strength_coeff_k_mpa ? parseFloat(row.strength_coeff_k_mpa) : undefined,
      strainHardeningExponentN: row.strain_hardening_exponent_n ? parseFloat(row.strain_hardening_exponent_n) : undefined,
      lankfordCoefficientR: row.lankford_coefficient_r ? parseFloat(row.lankford_coefficient_r) : undefined,
      millingSpeedMMin: row.milling_speed_m_min ? parseFloat(row.milling_speed_m_min) : undefined,
      scrapFactor: row.scrap_factor ? parseFloat(row.scrap_factor) : undefined,
      elongationPct: row.elongation_pct ? parseFloat(row.elongation_pct) : undefined,
      electricalConductivityIacsPct: row.electrical_conductivity_iacs_pct ? parseFloat(row.electrical_conductivity_iacs_pct) : undefined,
      thermalConductivityWMk: row.thermal_conductivity_w_mk ? parseFloat(row.thermal_conductivity_w_mk) : undefined,
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
