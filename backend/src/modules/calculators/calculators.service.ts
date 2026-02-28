import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Logger } from '../../common/logger/logger.service';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { evaluate } from 'mathjs';
import {
  CreateCalculatorDto,
  UpdateCalculatorDto,
  QueryCalculatorDto,
  ExecuteCalculatorDto,
  CreateFieldDto,
  UpdateFieldDto,
  CreateFormulaDto,
  UpdateFormulaDto,
} from './dto/calculator.dto';

/**
 * CalculatorsServiceV2 - Enterprise Grade
 *
 * PRINCIPLES:
 * 1. ALL operations are atomic (no partial saves)
 * 2. Single source of truth (database)
 * 3. Transaction safety
 * 4. Proper error handling
 * 5. No stale state
 */
@Injectable()
export class CalculatorsServiceV2 {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly logger: Logger,
  ) { }

  /**
   * GET ALL CALCULATORS
   * Returns calculators with their fields and formulas in one atomic read
   * SECURITY: Enforces tenant isolation via user_id filter
   */
  async findAll(query: QueryCalculatorDto, userId: string, accessToken: string) {
    this.logger.log(`Fetching calculators for user: ${userId}`, 'CalculatorsServiceV2');

    const page = query.page || 1;
    const limit = Math.min(query.limit || 10, 100);
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const client = this.supabaseService.getClient(accessToken);

    // Build query with MANDATORY user_id filter for tenant isolation
    let queryBuilder = client
      .from('calculators')
      .select(
        `
        *,
        fields:calculator_fields(*),
        formulas:calculator_formulas(*)
      `,
        { count: 'exact' },
      )
      .eq('user_id', userId) // SECURITY: Tenant isolation enforced at query level
      .order('created_at', { ascending: false })
      .range(from, to);

    // Apply filters
    if (query.search) {
      queryBuilder = queryBuilder.or(`name.ilike.%${query.search}%,description.ilike.%${query.search}%`);
    }

    if (query.calcCategory) {
      queryBuilder = queryBuilder.eq('calc_category', query.calcCategory);
    }

    if (query.calculatorType) {
      queryBuilder = queryBuilder.eq('calculator_type', query.calculatorType);
    }

    if (query.isTemplate !== undefined) {
      queryBuilder = queryBuilder.eq('is_template', query.isTemplate);
    }

    if (query.isPublic !== undefined) {
      queryBuilder = queryBuilder.eq('is_public', query.isPublic);
    }

    const { data, error, count } = await queryBuilder;

    if (error) {
      this.logger.error(`Failed to fetch calculators: ${error.message}`, 'CalculatorsServiceV2');
      throw new Error(error.message);
    }

    return {
      calculators: data || [],
      total: count || 0,
      page,
      limit,
    };
  }

  /**
   * GET SINGLE CALCULATOR
   * Returns complete calculator with all fields and formulas
   * SECURITY: Enforces ownership verification via user_id
   */
  async findOne(id: string, userId: string, accessToken: string) {
    this.logger.log(`Fetching calculator: ${id} for user: ${userId}`, 'CalculatorsServiceV2');

    const client = this.supabaseService.getClient(accessToken);

    const { data, error } = await client
      .from('calculators')
      .select(
        `
        *,
        fields:calculator_fields(*),
        formulas:calculator_formulas(*)
      `,
      )
      .eq('id', id)
      .eq('user_id', userId) // SECURITY: Ownership verification - user can only access their own calculators
      .single();

    if (error || !data) {
      throw new NotFoundException(`Calculator not found or access denied: ${id}`);
    }

    // Sort fields and formulas by order
    if (data.fields) {
      data.fields.sort((a: any, b: any) => (a.display_order || 0) - (b.display_order || 0));
    }

    if (data.formulas) {
      data.formulas.sort((a: any, b: any) => (a.execution_order || 0) - (b.execution_order || 0));
    }

    return data;
  }

  /**
   * CREATE CALCULATOR (ATOMIC)
   * Creates calculator + fields + formulas in a single transaction
   */
  async create(dto: CreateCalculatorDto, userId: string, accessToken: string) {
    this.logger.log(`Creating calculator: ${dto.name}`, 'CalculatorsServiceV2');

    const client = this.supabaseService.getClient(accessToken);

    // STEP 1: Create calculator
    const { data: calculator, error: calcError } = await client
      .from('calculators')
      .insert({
        user_id: userId,
        name: dto.name,
        description: dto.description,
        calc_category: dto.calcCategory,
        calculator_type: dto.calculatorType,
        is_template: dto.isTemplate || false,
        is_public: dto.isPublic || false,
        template_category: dto.templateCategory,
        display_config: dto.displayConfig || {},
        associated_process_id: dto.associatedProcessId,
        version: 1,
      })
      .select()
      .single();

    if (calcError || !calculator) {
      this.logger.error(`Failed to create calculator: ${calcError?.message}`, 'CalculatorsServiceV2');
      throw new Error(calcError?.message || 'Failed to create calculator');
    }

    const calculatorId = calculator.id;

    // STEP 2: Create fields (if provided)
    let createdFields = [];
    if (dto.fields && dto.fields.length > 0) {
      const fieldsToInsert = dto.fields.map((field, index) => ({
        calculator_id: calculatorId,
        field_name: field.fieldName,
        display_label: field.displayLabel,
        field_type: field.fieldType,
        data_source: field.dataSource,
        source_table: field.sourceTable,
        source_field: field.sourceField,
        lookup_config: field.lookupConfig || {},
        default_value: field.defaultValue,
        unit: field.unit,
        min_value: field.minValue,
        max_value: field.maxValue,
        is_required: field.isRequired || false,
        validation_rules: field.validationRules || {},
        input_config: field.inputConfig || {},
        display_order: field.displayOrder !== undefined ? field.displayOrder : index,
        field_group: field.fieldGroup,
      }));

      const { data: fields, error: fieldsError } = await client
        .from('calculator_fields')
        .insert(fieldsToInsert)
        .select();

      if (fieldsError) {
        // Rollback: Delete the calculator
        await client.from('calculators').delete().eq('id', calculatorId);
        this.logger.error(`Failed to create fields, rolling back: ${fieldsError.message}`, 'CalculatorsServiceV2');
        throw new Error(fieldsError.message);
      }

      createdFields = fields || [];
    }

    // STEP 3: Create formulas (if provided)
    let createdFormulas = [];
    if (dto.formulas && dto.formulas.length > 0) {
      const formulasToInsert = dto.formulas.map((formula, index) => ({
        calculator_id: calculatorId,
        formula_name: formula.formulaName,
        display_label: formula.displayLabel,
        description: formula.description,
        formula_type: formula.formulaType || 'expression',
        formula_expression: formula.formulaExpression,
        visual_formula: formula.visualFormula || {},
        depends_on_fields: formula.dependsOnFields || [],
        depends_on_formulas: formula.dependsOnFormulas || [],
        output_unit: formula.outputUnit,
        decimal_places: formula.decimalPlaces || 2,
        display_format: formula.displayFormat || 'number',
        execution_order: formula.executionOrder !== undefined ? formula.executionOrder : index,
        display_in_results: formula.displayInResults !== false,
        is_primary_result: formula.isPrimaryResult || false,
        result_group: formula.resultGroup,
      }));

      const { data: formulas, error: formulasError } = await client
        .from('calculator_formulas')
        .insert(formulasToInsert)
        .select();

      if (formulasError) {
        // Rollback: Delete the calculator (cascade will delete fields)
        await client.from('calculators').delete().eq('id', calculatorId);
        this.logger.error(`Failed to create formulas, rolling back: ${formulasError.message}`, 'CalculatorsServiceV2');
        throw new Error(formulasError.message);
      }

      createdFormulas = formulas || [];
    }

    // Return complete calculator with all nested data
    return {
      ...calculator,
      fields: createdFields,
      formulas: createdFormulas,
    };
  }

  /**
   * UPDATE CALCULATOR (ATOMIC)
   * Updates calculator and REPLACES all fields/formulas atomically
   *
   * IMPORTANT: If fields or formulas are provided, they REPLACE all existing ones
   * This prevents partial update bugs and ensures consistency
   */
  async update(id: string, dto: UpdateCalculatorDto, userId: string, accessToken: string) {
    this.logger.log(`Updating calculator: ${id}`, 'CalculatorsServiceV2');

    const client = this.supabaseService.getClient(accessToken);

    // Verify calculator exists and user owns it
    const existing = await this.findOne(id, userId, accessToken);

    // STEP 1: Update calculator metadata
    const updateData: any = {};
    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.calcCategory !== undefined) updateData.calc_category = dto.calcCategory;
    if (dto.calculatorType !== undefined) updateData.calculator_type = dto.calculatorType;
    if (dto.isTemplate !== undefined) updateData.is_template = dto.isTemplate;
    if (dto.isPublic !== undefined) updateData.is_public = dto.isPublic;
    if (dto.templateCategory !== undefined) updateData.template_category = dto.templateCategory;
    if (dto.displayConfig !== undefined) updateData.display_config = dto.displayConfig;
    if (dto.associatedProcessId !== undefined) updateData.associated_process_id = dto.associatedProcessId;

    // Increment version for optimistic locking
    updateData.version = (existing.version || 1) + 1;

    const { data: calculator, error: calcError } = await client
      .from('calculators')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (calcError || !calculator) {
      throw new NotFoundException(`Calculator not found: ${id}`);
    }

    // STEP 2: Replace fields (if provided)
    let updatedFields = existing.fields || [];
    if (dto.fields !== undefined) {
      // Delete all existing fields
      await client.from('calculator_fields').delete().eq('calculator_id', id);

      // Insert new fields
      if (dto.fields.length > 0) {
        const fieldsToInsert = dto.fields.map((field: any, index: any) => ({
          calculator_id: id,
          field_name: field.fieldName,
          display_label: field.displayLabel,
          field_type: field.fieldType,
          data_source: field.dataSource,
          source_table: field.sourceTable,
          source_field: field.sourceField,
          lookup_config: field.lookupConfig || {},
          default_value: field.defaultValue,
          unit: field.unit,
          min_value: field.minValue,
          max_value: field.maxValue,
          is_required: field.isRequired || false,
          validation_rules: field.validationRules || {},
          input_config: field.inputConfig || {},
          display_order: field.displayOrder !== undefined ? field.displayOrder : index,
          field_group: field.fieldGroup,
        }));

        const { data: fields, error: fieldsError } = await client
          .from('calculator_fields')
          .insert(fieldsToInsert)
          .select();

        if (fieldsError) {
          this.logger.error(`Failed to update fields: ${fieldsError.message}`, 'CalculatorsServiceV2');
          throw new Error(fieldsError.message);
        }

        updatedFields = fields || [];
      }
    }

    // STEP 3: Replace formulas (if provided)
    let updatedFormulas = existing.formulas || [];
    if (dto.formulas !== undefined) {
      // Delete all existing formulas
      await client.from('calculator_formulas').delete().eq('calculator_id', id);

      // Insert new formulas
      if (dto.formulas.length > 0) {
        const formulasToInsert = dto.formulas.map((formula: any, index: any) => ({
          calculator_id: id,
          formula_name: formula.formulaName,
          display_label: formula.displayLabel,
          description: formula.description,
          formula_type: formula.formulaType || 'expression',
          formula_expression: formula.formulaExpression,
          visual_formula: formula.visualFormula || {},
          depends_on_fields: formula.dependsOnFields || [],
          depends_on_formulas: formula.dependsOnFormulas || [],
          output_unit: formula.outputUnit,
          decimal_places: formula.decimalPlaces || 2,
          display_format: formula.displayFormat || 'number',
          execution_order: formula.executionOrder !== undefined ? formula.executionOrder : index,
          display_in_results: formula.displayInResults !== false,
          is_primary_result: formula.isPrimaryResult || false,
          result_group: formula.resultGroup,
        }));

        const { data: formulas, error: formulasError } = await client
          .from('calculator_formulas')
          .insert(formulasToInsert)
          .select();

        if (formulasError) {
          this.logger.error(`Failed to update formulas: ${formulasError.message}`, 'CalculatorsServiceV2');
          throw new Error(formulasError.message);
        }

        updatedFormulas = formulas || [];
      }
    }

    // Return complete updated calculator
    return {
      ...calculator,
      fields: updatedFields,
      formulas: updatedFormulas,
    };
  }

  /**
   * DELETE CALCULATOR
   * Cascade delete will automatically remove fields and formulas
   */
  async remove(id: string, userId: string, accessToken: string) {
    this.logger.log(`Deleting calculator: ${id}`, 'CalculatorsServiceV2');

    // Verify ownership
    await this.findOne(id, userId, accessToken);

    const { error } = await this.supabaseService
      .getClient(accessToken)
      .from('calculators')
      .delete()
      .eq('id', id);

    if (error) {
      this.logger.error(`Failed to delete calculator: ${error.message}`, 'CalculatorsServiceV2');
      throw new Error(error.message);
    }

    return { message: 'Calculator deleted successfully' };
  }

  /**
   * EXECUTE CALCULATOR
   * Runs all formulas and calculated fields with given inputs
   */
  async execute(id: string, dto: ExecuteCalculatorDto, userId: string, accessToken: string) {
    this.logger.log(`Executing calculator: ${id}`, 'CalculatorsServiceV2');

    const calculator = await this.findOne(id, userId, accessToken);
    const { formulas = [], fields = [] } = calculator;

    // Helper function to normalize field names for mathjs (replace all non-alphanumeric chars with underscores)
    const normalizeFieldName = (name: string): string => {
      return name
        .trim()
        .replace(/[^a-zA-Z0-9]+/g, '_') // Replace all non-alphanumeric sequences with single underscore
        .replace(/^_+|_+$/g, ''); // Remove leading/trailing underscores
    };

    // Create scope with input values
    const scope: Record<string, any> = { ...dto.inputValues };

    // Normalize field values into scope (non-calculated fields only)
    fields.forEach((field: any) => {
      if (field.field_type === 'calculated') return; // Skip calculated fields

      const val = dto.inputValues[field.id] !== undefined ? dto.inputValues[field.id] : dto.inputValues[field.field_name];

      if (val !== undefined && field.field_name) {
        const numericValue = field.field_type === 'number' || !isNaN(Number(val)) ? Number(val) : val;

        // Store with normalized field name (spaces -> underscores) for mathjs compatibility
        const normalizedName = normalizeFieldName(field.field_name);
        scope[normalizedName] = numericValue;

        this.logger.log(`Loaded field: "${field.field_name}" as "${normalizedName}" = ${numericValue}`, 'CalculatorsServiceV2');
      } else if (field.default_value !== undefined && field.default_value !== null) {
        // Use default value if no input provided
        const defaultValue = field.field_type === 'number' || !isNaN(Number(field.default_value))
          ? Number(field.default_value)
          : field.default_value;

        const normalizedName = normalizeFieldName(field.field_name);
        scope[normalizedName] = defaultValue;

        this.logger.log(`Loaded field (default): "${field.field_name}" as "${normalizedName}" = ${defaultValue}`, 'CalculatorsServiceV2');
      }
    });

    const results: Record<string, any> = {};
    const startTime = Date.now();

    // Add custom math functions (Excel-compatible)
    const customFunctions = {
      IF: (condition: boolean, trueValue: any, falseValue: any) => {
        return condition ? trueValue : falseValue;
      },
    };

    // Create extended scope with custom functions
    Object.assign(scope, customFunctions);

    // Process calculated fields (sorted by display_order to respect dependencies)
    const calculatedFields = fields
      .filter((field: any) => field.field_type === 'calculated')
      .sort((a: any, b: any) => (a.display_order || 0) - (b.display_order || 0));

    for (const field of calculatedFields) {
      try {
        if (!field.default_value) continue; // Skip if no formula

        let expression = field.default_value;

        // STEP 1: Replace {fieldName} with normalized field names
        const bracedFieldPattern = /\{([^}]+)\}/g;
        expression = expression.replace(bracedFieldPattern, (match: string, fieldName: string) => {
          const trimmedName = fieldName.trim();
          const normalizedName = normalizeFieldName(trimmedName);
          this.logger.log(`Replacing "{${trimmedName}}" with "${normalizedName}"`, 'CalculatorsServiceV2');
          return normalizedName;
        });

        // STEP 2: Build a map of all field names (original -> normalized) for bare name replacement
        const fieldNameMap = new Map<string, string>();
        fields.forEach((f: any) => {
          if (f.field_name) {
            fieldNameMap.set(f.field_name, normalizeFieldName(f.field_name));
          }
        });

        // STEP 3: Replace bare field names (not in braces) with normalized versions
        // Sort by length (longest first) to avoid partial replacements
        const sortedFieldNames = Array.from(fieldNameMap.keys()).sort((a, b) => b.length - a.length);

        for (const originalName of sortedFieldNames) {
          const normalizedName = fieldNameMap.get(originalName)!;
          // Use word boundaries to ensure we only replace complete field names
          // Match field names that are not already normalized (contain spaces or special chars)
          if (originalName !== normalizedName) {
            const regex = new RegExp(`\\b${originalName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
            const beforeReplace = expression;
            expression = expression.replace(regex, normalizedName);
            if (beforeReplace !== expression) {
              this.logger.log(`Replacing bare "${originalName}" with "${normalizedName}"`, 'CalculatorsServiceV2');
            }
          }
        }

        this.logger.log(`Original formula: "${field.default_value}"`, 'CalculatorsServiceV2');
        this.logger.log(`Normalized formula: "${expression}"`, 'CalculatorsServiceV2');
        this.logger.log(`Available variables: ${Object.keys(scope).join(', ')}`, 'CalculatorsServiceV2');

        // Log all scope values for debugging
        const scopeValues = Object.entries(scope).map(([key, val]) => `${key}=${val}`).join(', ');
        this.logger.log(`Scope values: ${scopeValues}`, 'CalculatorsServiceV2');

        // Evaluate formula
        const result = evaluate(expression, scope);

        this.logger.log(`Raw calculation result: ${result}`, 'CalculatorsServiceV2');

        // Store result in scope for subsequent calculations (normalized name)
        if (field.field_name) {
          const normalizedName = normalizeFieldName(field.field_name);
          scope[normalizedName] = result;

          this.logger.log(`Stored result in scope as: "${normalizedName}" = ${result}`, 'CalculatorsServiceV2');
        }

        // Store result for response
        results[field.id] = result;
        if (field.field_name) {
          results[field.field_name] = result;
        }

        this.logger.log(`✓ Calculated "${field.field_name}" = ${result}`, 'CalculatorsServiceV2');
      } catch (e) {
        this.logger.error(`✗ Error calculating field "${field.field_name}": ${e.message}`, 'CalculatorsServiceV2');
        this.logger.error(`   Formula was: "${field.default_value}"`, 'CalculatorsServiceV2');
        results[field.id] = { error: e.message, value: null };
      }
    }

    // Process regular formulas (sorted by execution order)
    const sortedFormulas = [...formulas].sort((a: any, b: any) => (a.execution_order || 0) - (b.execution_order || 0));

    for (const formula of sortedFormulas) {
      try {
        if (!formula.formula_expression) continue;

        // Evaluate formula
        const result = evaluate(formula.formula_expression, scope);

        // Store result in scope for subsequent formulas
        if (formula.formula_name) {
          scope[formula.formula_name] = result;
        }

        // Store result for response
        results[formula.id] = result;
        if (formula.formula_name) {
          results[formula.formula_name] = result;
        }
      } catch (e) {
        this.logger.error(`Error calculating formula ${formula.formula_name || 'unknown'}: ${e.message}`, 'CalculatorsServiceV2');
        results[formula.id] = { error: e.message, value: null };
      }
    }

    const duration = Date.now() - startTime;

    return {
      success: true,
      results,
      durationMs: duration,
    };
  }

  // ============================================================================
  // FIELD OPERATIONS (GRANULAR)
  // ============================================================================

  async getFields(calculatorId: string, userId: string, accessToken: string) {
    const calculator = await this.findOne(calculatorId, userId, accessToken);
    return calculator.fields || [];
  }

  async createField(calculatorId: string, dto: CreateFieldDto, userId: string, accessToken: string) {
    const client = this.supabaseService.getClient(accessToken);
    await this.findOne(calculatorId, userId, accessToken); // Verify ownership

    const { data, error } = await client
      .from('calculator_fields')
      .insert({
        calculator_id: calculatorId,
        field_name: dto.fieldName,
        display_label: dto.displayLabel,
        field_type: dto.fieldType,
        data_source: dto.dataSource,
        source_table: dto.sourceTable,
        source_field: dto.sourceField,
        lookup_config: dto.lookupConfig || {},
        default_value: dto.defaultValue,
        unit: dto.unit,
        min_value: dto.minValue,
        max_value: dto.maxValue,
        is_required: dto.isRequired || false,
        validation_rules: dto.validationRules || {},
        input_config: dto.inputConfig || {},
        display_order: dto.displayOrder || 0,
        field_group: dto.fieldGroup,
      })
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async updateField(calculatorId: string, fieldId: string, dto: UpdateFieldDto, userId: string, accessToken: string) {
    const client = this.supabaseService.getClient(accessToken);
    await this.findOne(calculatorId, userId, accessToken); // Verify ownership

    const { data, error } = await client
      .from('calculator_fields')
      .update({
        field_name: dto.fieldName,
        display_label: dto.displayLabel,
        field_type: dto.fieldType,
        data_source: dto.dataSource,
        source_table: dto.sourceTable,
        source_field: dto.sourceField,
        lookup_config: dto.lookupConfig,
        default_value: dto.defaultValue,
        unit: dto.unit,
        min_value: dto.minValue,
        max_value: dto.maxValue,
        is_required: dto.isRequired,
        validation_rules: dto.validationRules,
        input_config: dto.inputConfig,
        display_order: dto.displayOrder,
        field_group: dto.fieldGroup,
      })
      .eq('id', fieldId)
      .eq('calculator_id', calculatorId)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async removeField(calculatorId: string, fieldId: string, userId: string, accessToken: string) {
    const client = this.supabaseService.getClient(accessToken);
    await this.findOne(calculatorId, userId, accessToken); // Verify ownership

    const { error } = await client
      .from('calculator_fields')
      .delete()
      .eq('id', fieldId)
      .eq('calculator_id', calculatorId);

    if (error) throw new Error(error.message);
    return { message: 'Field deleted successfully' };
  }

  // ============================================================================
  // FORMULA OPERATIONS (GRANULAR)
  // ============================================================================

  async getFormulas(calculatorId: string, userId: string, accessToken: string) {
    const calculator = await this.findOne(calculatorId, userId, accessToken);
    return calculator.formulas || [];
  }

  async createFormula(calculatorId: string, dto: CreateFormulaDto, userId: string, accessToken: string) {
    const client = this.supabaseService.getClient(accessToken);
    await this.findOne(calculatorId, userId, accessToken); // Verify ownership

    const { data, error } = await client
      .from('calculator_formulas')
      .insert({
        calculator_id: calculatorId,
        formula_name: dto.formulaName,
        display_label: dto.displayLabel,
        description: dto.description,
        formula_type: dto.formulaType || 'expression',
        formula_expression: dto.formulaExpression,
        visual_formula: dto.visualFormula || {},
        depends_on_fields: dto.dependsOnFields || [],
        depends_on_formulas: dto.dependsOnFormulas || [],
        output_unit: dto.outputUnit,
        decimal_places: dto.decimalPlaces || 2,
        display_format: dto.displayFormat || 'number',
        execution_order: dto.executionOrder || 0,
        display_in_results: dto.displayInResults !== false,
        is_primary_result: dto.isPrimaryResult || false,
        result_group: dto.resultGroup,
      })
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async updateFormula(calculatorId: string, formulaId: string, dto: UpdateFormulaDto, userId: string, accessToken: string) {
    const client = this.supabaseService.getClient(accessToken);
    await this.findOne(calculatorId, userId, accessToken); // Verify ownership

    const { data, error } = await client
      .from('calculator_formulas')
      .update({
        formula_name: dto.formulaName,
        display_label: dto.displayLabel,
        description: dto.description,
        formula_type: dto.formulaType,
        formula_expression: dto.formulaExpression,
        visual_formula: dto.visualFormula,
        depends_on_fields: dto.dependsOnFields,
        depends_on_formulas: dto.dependsOnFormulas,
        output_unit: dto.outputUnit,
        decimal_places: dto.decimalPlaces,
        display_format: dto.displayFormat,
        execution_order: dto.executionOrder,
        display_in_results: dto.displayInResults,
        is_primary_result: dto.isPrimaryResult,
        result_group: dto.resultGroup,
      })
      .eq('id', formulaId)
      .eq('calculator_id', calculatorId)
      .select()
      .single();

    if (error) throw new Error(error.message);
    return data;
  }

  async removeFormula(calculatorId: string, formulaId: string, userId: string, accessToken: string) {
    const client = this.supabaseService.getClient(accessToken);
    await this.findOne(calculatorId, userId, accessToken); // Verify ownership

    const { error } = await client
      .from('calculator_formulas')
      .delete()
      .eq('id', formulaId)
      .eq('calculator_id', calculatorId);

    if (error) throw new Error(error.message);
    return { message: 'Formula deleted successfully' };
  }
}
