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
  ArrayMinSize,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

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
}

export enum FieldType {
  NUMBER = 'number',
  TEXT = 'text',
  SELECT = 'select',
  DATABASE_LOOKUP = 'database_lookup',
  CALCULATED = 'calculated',
  MULTI_SELECT = 'multi_select',
  CONST = 'const',
}

export enum DataSource {
  LHR = 'lhr',
  MHR = 'mhr',
  RAW_MATERIALS = 'raw_materials',
  PROCESSES = 'processes',
  MANUAL = 'manual',
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
  @IsBoolean()
  @IsOptional()
  isTemplate?: boolean;

  @ApiPropertyOptional()
  @IsBoolean()
  @IsOptional()
  isPublic?: boolean;

  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  @Min(1)
  page?: number;

  @ApiPropertyOptional()
  @IsNumber()
  @IsOptional()
  @Min(1)
  @Max(100)
  limit?: number;
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
}

/**
 * Response DTO for calculator with all nested data
 */
export class CalculatorResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  userId: string;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional()
  description?: string;

  @ApiPropertyOptional()
  calcCategory?: CalculatorCategory;

  @ApiProperty()
  calculatorType: CalculatorType;

  @ApiProperty()
  isTemplate: boolean;

  @ApiProperty()
  isPublic: boolean;

  @ApiPropertyOptional()
  templateCategory?: string;

  @ApiProperty()
  displayConfig: Record<string, any>;

  @ApiProperty()
  version: number;

  @ApiProperty({ type: [Object] })
  fields: any[]; // Will be properly typed based on DB response

  @ApiProperty({ type: [Object] })
  formulas: any[]; // Will be properly typed based on DB response

  @ApiProperty()
  createdAt: string;

  @ApiProperty()
  updatedAt: string;
}
