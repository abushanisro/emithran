import { evaluate } from 'mathjs';

/**
 * Shared mathjs-based formula evaluator, extracted from
 * CalculatorsServiceV2.execute() so cost-engine.ts (the live/automatic cost
 * path) can evaluate the SAME DB-stored calculator formulas the interactive
 * "Edit Process Cost" calculator dialog uses, instead of re-implementing a
 * formula in TypeScript that happens to currently match. Behavior here is
 * byte-identical to the original execute() logic (see calculators.service.ts).
 */

export interface CalculatorFieldRow {
  id: string;
  field_name: string;
  field_type: string;
  default_value?: string | number | null;
  display_order?: number | null;
}

export interface CalculatorFormulaRow {
  id: string;
  formula_name?: string | null;
  formula_expression?: string | null;
  execution_order?: number | null;
}

export interface EvaluatorLogger {
  log: (message: string) => void;
  error: (message: string) => void;
  warn: (message: string) => void;
}

const noopLogger: EvaluatorLogger = { log: () => {}, error: () => {}, warn: () => {} };

// Replace all non-alphanumeric sequences with a single underscore, trim
// leading/trailing underscores — makes a human field name mathjs-safe.
export function normalizeFieldName(name: string): string {
  return name
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export interface EvaluateFormulasResult {
  // Keyed by both field/formula id AND field_name/formula_name, matching
  // the response shape the frontend already reads by name.
  results: Record<string, any>;
  // Final scope (normalized-name -> value) after every calculated field and
  // formula has evaluated — useful for a caller that wants a specific named
  // result directly instead of re-deriving it from `results`.
  scope: Record<string, any>;
}

export function evaluateCalculatorFormulas(
  fields: CalculatorFieldRow[],
  formulas: CalculatorFormulaRow[],
  inputValues: Record<string, any>,
  logger: EvaluatorLogger = noopLogger,
): EvaluateFormulasResult {
  const scope: Record<string, any> = { ...inputValues };

  // Normalize field values into scope (non-calculated fields only).
  fields.forEach((field) => {
    if (field.field_type === 'calculated') return;

    const val = inputValues[field.id] !== undefined ? inputValues[field.id] : inputValues[field.field_name];

    if (val !== undefined && field.field_name) {
      const numericValue = field.field_type === 'number' || !isNaN(Number(val)) ? Number(val) : val;
      const normalizedName = normalizeFieldName(field.field_name);
      scope[normalizedName] = numericValue;
      logger.log(`Loaded field: "${field.field_name}" as "${normalizedName}" = ${numericValue}`);
    } else if (field.default_value !== undefined && field.default_value !== null) {
      const defaultValue = field.field_type === 'number' || !isNaN(Number(field.default_value))
        ? Number(field.default_value)
        : field.default_value;
      const normalizedName = normalizeFieldName(field.field_name);
      scope[normalizedName] = defaultValue;
      logger.log(`Loaded field (default): "${field.field_name}" as "${normalizedName}" = ${defaultValue}`);
    }
  });

  const results: Record<string, any> = {};

  // Excel-compatible custom functions.
  const customFunctions = {
    IF: (condition: boolean, trueValue: any, falseValue: any) => (condition ? trueValue : falseValue),
    LN: (value: number) => {
      if (value <= 0) throw new Error('LN function requires a positive value');
      return Math.log(value);
    },
    LOG: (value: number) => {
      if (value <= 0) throw new Error('LOG function requires a positive value');
      return Math.log10(value);
    },
    // Confirmed missing: Machining - Tapping's "Time per Use" formula
    // (CEIL({Machining Time})) threw "Undefined function CEIL" — mathjs has
    // no built-in CEIL (only lowercase ceil, not exposed to formula scope).
    CEIL: (value: number) => Math.ceil(value),
  };
  Object.assign(scope, customFunctions);

  // Calculated fields, in display_order (dependency chain — a field can
  // reference an earlier-evaluated calculated field by name).
  const calculatedFields = fields
    .filter((field) => field.field_type === 'calculated')
    .sort((a, b) => (a.display_order || 0) - (b.display_order || 0));

  const fieldNameMap = new Map<string, string>();
  fields.forEach((f) => {
    if (f.field_name) fieldNameMap.set(f.field_name, normalizeFieldName(f.field_name));
  });
  const sortedFieldNames = Array.from(fieldNameMap.keys()).sort((a, b) => b.length - a.length);

  for (const field of calculatedFields) {
    try {
      if (!field.default_value) continue;

      let expression = String(field.default_value);
      if (expression.trim().startsWith('=')) {
        expression = expression.trim().substring(1).trim();
      }

      // {Field Name} -> normalized identifier.
      expression = expression.replace(/\{([^}]+)\}/g, (_match, fieldName: string) => {
        const trimmedName = fieldName.trim();
        const normalizedName = normalizeFieldName(trimmedName);
        logger.log(`Replacing "{${trimmedName}}" with "${normalizedName}"`);
        return normalizedName;
      });

      // Bare (non-braced) field-name references, longest-first to avoid
      // partial matches.
      for (const originalName of sortedFieldNames) {
        const normalizedName = fieldNameMap.get(originalName)!;
        if (originalName !== normalizedName) {
          const regex = new RegExp(`\\b${originalName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
          const before = expression;
          expression = expression.replace(regex, normalizedName);
          if (before !== expression) logger.log(`Replacing bare "${originalName}" with "${normalizedName}"`);
        }
      }

      logger.log(`Original formula: "${field.default_value}"`);
      logger.log(`Normalized formula: "${expression}"`);

      const result = evaluate(expression, scope);

      if (field.field_name) {
        const normalizedName = normalizeFieldName(field.field_name);
        scope[normalizedName] = result;
      }

      results[field.id] = result;
      if (field.field_name) results[field.field_name] = result;
    } catch (e: any) {
      logger.error(`✗ Error calculating field "${field.field_name}": ${e.message}`);
      results[field.id] = { error: e.message, value: null };
      if (field.field_name) results[field.field_name] = { error: e.message, value: null };
    }
  }

  // Standalone formulas (calculator_formulas table), in execution_order.
  const sortedFormulas = [...formulas].sort((a, b) => (a.execution_order || 0) - (b.execution_order || 0));

  for (const formula of sortedFormulas) {
    try {
      if (!formula.formula_expression) continue;

      let expression = formula.formula_expression.trim();
      if (expression.startsWith('=')) expression = expression.substring(1).trim();

      const result = evaluate(expression, scope);

      if (formula.formula_name) scope[formula.formula_name] = result;

      results[formula.id] = result;
      if (formula.formula_name) results[formula.formula_name] = result;
    } catch (e: any) {
      logger.error(`Error calculating formula ${formula.formula_name || 'unknown'}: ${e.message}`);
      results[formula.id] = { error: e.message, value: null };
      if (formula.formula_name) results[formula.formula_name] = { error: e.message, value: null };
    }
  }

  return { results, scope };
}
