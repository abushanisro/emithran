/**
 * Formula Validator
 * Validates formula syntax and provides real-time feedback
 */

import { getFunction, getFunctionNames } from './functions';

export type ValidationResult = {
  isValid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
  fields: string[];
  functions: string[];
};

export type ValidationError = {
  type: 'syntax' | 'field' | 'function' | 'argument';
  message: string;
  position?: number;
};

export type ValidationWarning = {
  type: 'deprecated' | 'performance' | 'best-practice';
  message: string;
};

/**
 * Extract field references from formula
 */
export function extractFields(formula: string): string[] {
  const fieldPattern = /\{([^}]+)\}/g;
  const matches = formula.matchAll(fieldPattern);
  const fields = new Set<string>();

  for (const match of matches) {
    if (match[1]) {
      fields.add(match[1].trim());
    }
  }

  return Array.from(fields);
}

/**
 * Extract function calls from formula
 */
export function extractFunctions(formula: string): string[] {
  const functionPattern = /([A-Z_]+)\s*\(/g;
  const matches = formula.matchAll(functionPattern);
  const functions = new Set<string>();

  for (const match of matches) {
    if (match[1]) {
      functions.add(match[1]);
    }
  }

  return Array.from(functions);
}

/**
 * Validate field references
 */
function validateFields(
  formula: string,
  availableFields: string[]
): ValidationError[] {
  const errors: ValidationError[] = [];
  const usedFields = extractFields(formula);

  for (const field of usedFields) {
    if (!availableFields.includes(field)) {
      errors.push({
        type: 'field',
        message: `Field "{${field}}" not found. Available fields: ${availableFields.join(', ')}`,
      });
    }
  }

  return errors;
}

/**
 * Validate function calls
 */
function validateFunctions(formula: string): ValidationError[] {
  const errors: ValidationError[] = [];
  const usedFunctions = extractFunctions(formula);
  const validFunctions = getFunctionNames();

  for (const funcName of usedFunctions) {
    const func = getFunction(funcName);

    if (!func) {
      errors.push({
        type: 'function',
        message: `Unknown function "${funcName}". Available functions: ${validFunctions.join(', ')}`,
      });
    }
  }

  return errors;
}

/**
 * Validate parentheses matching
 */
function validateParentheses(formula: string): ValidationError[] {
  const errors: ValidationError[] = [];
  let openCount = 0;
  let openPositions: number[] = [];

  for (let i = 0; i < formula.length; i++) {
    if (formula[i] === '(') {
      openCount++;
      openPositions.push(i);
    } else if (formula[i] === ')') {
      openCount--;
      openPositions.pop();

      if (openCount < 0) {
        errors.push({
          type: 'syntax',
          message: 'Unexpected closing parenthesis',
          position: i,
        });
        openCount = 0;
      }
    }
  }

  if (openCount > 0) {
    errors.push({
      type: 'syntax',
      message: `${openCount} unclosed parenthesis${openCount > 1 ? 'es' : ''}`,
      ...(openPositions[openPositions.length - 1] !== undefined ? { position: openPositions[openPositions.length - 1] } : {}),
    });
  }

  return errors;
}

/**
 * Validate braces (field references) matching
 */
function validateBraces(formula: string): ValidationError[] {
  const errors: ValidationError[] = [];
  let openCount = 0;
  let openPositions: number[] = [];

  for (let i = 0; i < formula.length; i++) {
    if (formula[i] === '{') {
      openCount++;
      openPositions.push(i);
    } else if (formula[i] === '}') {
      openCount--;
      openPositions.pop();

      if (openCount < 0) {
        errors.push({
          type: 'syntax',
          message: 'Unexpected closing brace',
          position: i,
        });
        openCount = 0;
      }
    }
  }

  if (openCount > 0) {
    errors.push({
      type: 'syntax',
      message: `${openCount} unclosed brace${openCount > 1 ? 's' : ''}`,
      ...(openPositions[openPositions.length - 1] !== undefined ? { position: openPositions[openPositions.length - 1] } : {}),
    });
  }

  return errors;
}

/**
 * Check for common syntax errors
 */
function validateSyntax(formula: string): ValidationError[] {
  const errors: ValidationError[] = [];

  // Check for consecutive operators
  const consecutiveOps = /[+\-*/]{2,}/g;
  const matches = formula.matchAll(consecutiveOps);
  for (const match of matches) {
    if (match.index !== undefined) {
      errors.push({
        type: 'syntax',
        message: `Consecutive operators "${match[0]}" at position ${match.index}`,
        position: match.index,
      });
    }
  }

  // Check for empty parentheses
  if (formula.includes('()')) {
    errors.push({
      type: 'syntax',
      message: 'Empty parentheses found',
    });
  }

  // Check for empty braces
  if (formula.includes('{}')) {
    errors.push({
      type: 'syntax',
      message: 'Empty field reference found',
    });
  }

  return errors;
}

/**
 * Generate warnings for best practices
 */
function generateWarnings(formula: string): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];

  // Warn about very long formulas
  if (formula.length > 500) {
    warnings.push({
      type: 'performance',
      message: 'Formula is very long. Consider breaking it into multiple fields for better readability.',
    });
  }

  // Warn about deeply nested functions
  const maxNesting = getMaxNestingLevel(formula);
  if (maxNesting > 5) {
    warnings.push({
      type: 'best-practice',
      message: `Formula has ${maxNesting} levels of nesting. Consider simplifying for better maintainability.`,
    });
  }

  return warnings;
}

/**
 * Get maximum nesting level of parentheses
 */
function getMaxNestingLevel(formula: string): number {
  let maxLevel = 0;
  let currentLevel = 0;

  for (const char of formula) {
    if (char === '(') {
      currentLevel++;
      maxLevel = Math.max(maxLevel, currentLevel);
    } else if (char === ')') {
      currentLevel--;
    }
  }

  return maxLevel;
}

/**
 * Main validation function
 */
export function validateFormula(
  formula: string,
  availableFields: string[] = []
): ValidationResult {
  if (!formula || formula.trim() === '') {
    return {
      isValid: false,
      errors: [{ type: 'syntax', message: 'Formula cannot be empty' }],
      warnings: [],
      fields: [],
      functions: [],
    };
  }

  const errors: ValidationError[] = [
    ...validateParentheses(formula),
    ...validateBraces(formula),
    ...validateSyntax(formula),
    ...validateFields(formula, availableFields),
    ...validateFunctions(formula),
  ];

  const warnings = generateWarnings(formula);
  const fields = extractFields(formula);
  const functions = extractFunctions(formula);

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    fields,
    functions,
  };
}

/**
 * Format formula for display
 */
export function formatFormula(formula: string): string {
  let formatted = formula;

  // Add spaces around operators for readability
  formatted = formatted.replace(/([+\-*/])/g, ' $1 ');

  // Clean up multiple spaces
  formatted = formatted.replace(/\s+/g, ' ');

  return formatted.trim();
}

/**
 * Get autocomplete suggestions at cursor position
 */
export function getAutocompleteSuggestions(
  formula: string,
  cursorPosition: number,
  availableFields: string[]
): Array<{ type: 'field' | 'function'; value: string; description?: string }> {
  const suggestions: Array<{ type: 'field' | 'function'; value: string; description?: string }> = [];

  // Get text before cursor
  const beforeCursor = formula.substring(0, cursorPosition);

  // Check if we're inside a field reference
  const lastOpenBrace = beforeCursor.lastIndexOf('{');
  const lastCloseBrace = beforeCursor.lastIndexOf('}');

  if (lastOpenBrace > lastCloseBrace) {
    // We're inside a field reference, suggest fields
    const partial = beforeCursor.substring(lastOpenBrace + 1).toLowerCase();

    for (const field of availableFields) {
      if (field.toLowerCase().includes(partial)) {
        suggestions.push({
          type: 'field',
          value: field,
        });
      }
    }
  } else {
    // Check if we're typing a function name
    const wordMatch = beforeCursor.match(/([A-Z_]+)$/);

    if (wordMatch) {
      const partial = (wordMatch[1] ?? '').toLowerCase();

      for (const func of getFunctionNames()) {
        if (func.toLowerCase().startsWith(partial)) {
          const funcDef = getFunction(func);
          suggestions.push({
            type: 'function',
            value: func,
            ...(funcDef?.description !== undefined ? { description: funcDef.description } : {}),
          });
        }
      }
    }

    // If no partial match, suggest all functions and fields
    if (suggestions.length === 0) {
      // Suggest functions
      for (const func of getFunctionNames()) {
        const funcDef = getFunction(func);
        suggestions.push({
          type: 'function',
          value: func,
          ...(funcDef?.description !== undefined ? { description: funcDef.description } : {}),
        });
      }

      // Suggest fields
      for (const field of availableFields) {
        suggestions.push({
          type: 'field',
          value: field,
        });
      }
    }
  }

  return suggestions.slice(0, 10); // Limit to 10 suggestions
}
