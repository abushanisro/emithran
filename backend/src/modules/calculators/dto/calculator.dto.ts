import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsOptional,
  IsBoolean,
  IsEnum,
  IsObject,
  IsNumber,
  IsArray,
  ValidateNested,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { IsOptionalBoolean } from '../../../common/decorators/validation.decorators';

// ============================================================================
// ENUMS
// ============================================================================

export enum CalculatorType {
  SINGLE = 'single',
  MULTI_STEP = 'multi_step',
  DASHBOARD = 'dashboard',
}

export enum CalculatorCategory {
  COSTING = 'costing',
  MATERIAL = 'material',
  PROCESS = 'process',
  TOOLING = 'tooling',
  CUSTOM = 'custom',
  SHEET_METAL = 'sheet_metal',
}

export enum FieldType {
  NUMBER = 'number',
  TEXT = 'text',
  SELECT = 'select',
  DATABASE_LOOKUP = 'database_lookup',
  CALCULATED = 'calculated',
  MULTI_SELECT = 'multi_select',
  CONST = 'const',
  TABLE_LOOKUP = 'table_lookup',
}

export enum DataSource {
  LHR = 'lhr',
  MHR = 'mhr',
  RAW_MATERIALS = 'raw_materials',
  PROCESSES = 'processes',
  MANUAL = 'manual',
  SHEET_METAL_LOOKUP = 'sheet_metal_lookup',
  ENGINEERING_BRIEF = 'engineering_brief', // part geometry: volume_mm3, length_mm, width_mm, height_mm, hole_count, surface_area_mm2
}

export enum FormulaType {
  EXPRESSION = 'expression',
  MULTI_STEP = 'multi_step',
  CONDITIONAL = 'conditional',
}

export enum DisplayFormat {
  NUMBER = 'number',
  CURRENCY = 'currency',
  PERCENTAGE = 'percentage',
}

// ============================================================================
// NESTED DTOs (Fields and Formulas)
// ============================================================================

export class CreateFieldDto {
  @ApiProperty()
  @IsString()
  fieldName: string;

  @ApiProperty()
  @IsString()
  displayLabel: string;

  @ApiProperty({ enum: FieldType })
  @IsEnum(FieldType)
  fieldType: FieldType;

  @ApiPropertyOptional({ enum: DataSource })
  @IsEnum(DataSource)
  @IsOptional()
  dataSource?: DataSource;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  sourceTable?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  sourceField?: string;

  @ApiPropertyOptional()
  @IsObject()
  @IsOptional()
  lookupConfig?: Record<string, any>;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  defaultValue?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  unit?: string;

  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  minValue?: number;

  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  maxValue?: number;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  isRequired?: boolean;

  @ApiPropertyOptional()
  @IsObject()
  @IsOptional()
  validationRules?: Record<string, any>;

  @ApiPropertyOptional()
  @IsObject()
  @IsOptional()
  inputConfig?: Record<string, any>;

  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  @Min(0)
  displayOrder?: number;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  fieldGroup?: string;
}

export class UpdateFieldDto extends CreateFieldDto { }

export class CreateFormulaDto {
  @ApiProperty()
  @IsString()
  formulaName: string;

  @ApiProperty()
  @IsString()
  displayLabel: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ enum: FormulaType })
  @IsEnum(FormulaType)
  @IsOptional()
  formulaType?: FormulaType;

  @ApiProperty()
  @IsString()
  formulaExpression: string;

  @ApiPropertyOptional()
  @IsObject()
  @IsOptional()
  visualFormula?: Record<string, any>;

  @ApiPropertyOptional({ type: [String] })
  @IsArray()
  @IsOptional()
  dependsOnFields?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsArray()
  @IsOptional()
  dependsOnFormulas?: string[];

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  outputUnit?: string;

  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(10)
  decimalPlaces?: number;

  @ApiPropertyOptional({ enum: DisplayFormat })
  @IsEnum(DisplayFormat)
  @IsOptional()
  displayFormat?: DisplayFormat;

  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  @Min(0)
  executionOrder?: number;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  displayInResults?: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  isPrimaryResult?: boolean;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  resultGroup?: string;
}

export class UpdateFormulaDto extends CreateFormulaDto { }

// ============================================================================
// MAIN CALCULATOR DTOS
// ============================================================================

/**
 * DTO for creating a calculator with all its fields and formulas atomically
 * This is the ONLY way to create a calculator - no partial saves allowed
 */
export class CreateCalculatorDto {
  @ApiProperty()
  @IsString()
  name: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ enum: CalculatorCategory })
  @IsEnum(CalculatorCategory)
  @IsOptional()
  calcCategory?: CalculatorCategory;

  @ApiProperty({ enum: CalculatorType })
  @IsEnum(CalculatorType)
  calculatorType: CalculatorType;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  isTemplate?: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  isPublic?: boolean;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  templateCategory?: string;

  @ApiPropertyOptional()
  @IsObject()
  @IsOptional()
  displayConfig?: Record<string, any>;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  associatedProcessId?: string;

  // ATOMIC: Fields are created WITH the calculator
  @ApiPropertyOptional({ type: [CreateFieldDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateFieldDto)
  @IsOptional()
  fields?: CreateFieldDto[];

  // ATOMIC: Formulas are created WITH the calculator
  @ApiPropertyOptional({ type: [CreateFormulaDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateFormulaDto)
  @IsOptional()
  formulas?: CreateFormulaDto[];
}

/**
 * DTO for updating a calculator
 * ALL fields and formulas are replaced atomically (not merged)
 * This prevents partial update bugs
 */
export class UpdateCalculatorDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  name?: string;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({ enum: CalculatorCategory })
  @IsEnum(CalculatorCategory)
  @IsOptional()
  calcCategory?: CalculatorCategory;

  @ApiPropertyOptional({ enum: CalculatorType })
  @IsEnum(CalculatorType)
  @IsOptional()
  calculatorType?: CalculatorType;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  isTemplate?: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  isPublic?: boolean;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  templateCategory?: string;

  @ApiPropertyOptional()
  @IsObject()
  @IsOptional()
  displayConfig?: Record<string, any>;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  associatedProcessId?: string;

  // ATOMIC: If provided, ALL fields are replaced (not merged)
  @ApiPropertyOptional({ type: [CreateFieldDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateFieldDto)
  @IsOptional()
  fields?: CreateFieldDto[];

  // ATOMIC: If provided, ALL formulas are replaced (not merged)
  @ApiPropertyOptional({ type: [CreateFormulaDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateFormulaDto)
  @IsOptional()
  formulas?: CreateFormulaDto[];
}

/**
 * DTO for querying calculators with filters
 */
export class QueryCalculatorDto {
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  search?: string;

  @ApiPropertyOptional({ enum: CalculatorCategory })
  @IsEnum(CalculatorCategory)
  @IsOptional()
  calcCategory?: CalculatorCategory;

  @ApiPropertyOptional({ enum: CalculatorType })
  @IsEnum(CalculatorType)
  @IsOptional()
  calculatorType?: CalculatorType;

  @ApiPropertyOptional()
  @IsOptionalBoolean()
  isTemplate?: boolean;

  @ApiPropertyOptional()
  @IsOptionalBoolean()
  isPublic?: boolean;

  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  @Min(1)
  @Type(() => Number)
  page?: number;

  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  @Min(1)
  @Max(200)
  @Type(() => Number)
  limit?: number;
}

/**
 * DTO for sheet metal parameterized lookup table queries
 */
export class SheetMetalLookupDto {
  @ApiProperty({ description: 'Table name: stroke_rate | handling_time | tool_setup | manual_stroke | laser_cut | waterjet_cut | sampling_plan' })
  @IsString()
  tableName: string;

  @ApiProperty({ description: 'Key-value params used to match rows (e.g. { tonnage: 100, complexity: "simple" })' })
  @IsObject()
  params: Record<string, any>;
}

/**
 * DTO for executing calculator (running calculations)
 */
export class ExecuteCalculatorDto {
  @ApiProperty()
  @IsObject()
  inputValues: Record<string, any>;

  @ApiPropertyOptional()
  @IsObject()
  @IsOptional()
  databaseReferences?: Record<string, any>;

  // Only consumed by the sheet-metal net/gross-usage physics_keys -- the
  // BOM item this Calculate is bound to, needed for Gross Usage to read the
  // item's stored CAD outline/cache (a polygon isn't a value a calculator
  // form can hold as a scalar input). Every other calculator ignores it.
  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  itemId?: string;
}

