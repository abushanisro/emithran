/**
 * Formula Function Library
 * Built-in functions for calculator formulas
 */

export type FormulaFunction = {
  name: string;
  description: string;
  syntax: string;
  category: 'math' | 'statistical' | 'logical' | 'text' | 'date';
  minArgs: number;
  maxArgs?: number;
  example: string;
};

export const FORMULA_FUNCTIONS: FormulaFunction[] = [
  // Mathematical Functions
  {
    name: 'SUM',
    description: 'Add multiple values together',
    syntax: 'SUM(value1, value2, ...)',
    category: 'math',
    minArgs: 1,
    example: 'SUM({partCost}, {laborCost}, {overheadCost})',
  },
  {
    name: 'AVG',
    description: 'Calculate average of values',
    syntax: 'AVG(value1, value2, ...)',
    category: 'math',
    minArgs: 1,
    example: 'AVG({measurement1}, {measurement2}, {measurement3})',
  },
  {
    name: 'MIN',
    description: 'Return the minimum value',
    syntax: 'MIN(value1, value2, ...)',
    category: 'math',
    minArgs: 1,
    example: 'MIN({option1Cost}, {option2Cost})',
  },
  {
    name: 'MAX',
    description: 'Return the maximum value',
    syntax: 'MAX(value1, value2, ...)',
    category: 'math',
    minArgs: 1,
    example: 'MAX({maxLoad}, {currentLoad})',
  },
  {
    name: 'ABS',
    description: 'Absolute value',
    syntax: 'ABS(value)',
    category: 'math',
    minArgs: 1,
    maxArgs: 1,
    example: 'ABS({tolerance})',
  },
  {
    name: 'ROUND',
    description: 'Round to specified decimal places',
    syntax: 'ROUND(value, decimals)',
    category: 'math',
    minArgs: 1,
    maxArgs: 2,
    example: 'ROUND({totalCost}, 2)',
  },
  {
    name: 'CEIL',
    description: 'Round up to nearest integer',
    syntax: 'CEIL(value)',
    category: 'math',
    minArgs: 1,
    maxArgs: 1,
    example: 'CEIL({numberOfParts})',
  },
  {
    name: 'FLOOR',
    description: 'Round down to nearest integer',
    syntax: 'FLOOR(value)',
    category: 'math',
    minArgs: 1,
    maxArgs: 1,
    example: 'FLOOR({quantity})',
  },
  {
    name: 'SQRT',
    description: 'Square root',
    syntax: 'SQRT(value)',
    category: 'math',
    minArgs: 1,
    maxArgs: 1,
    example: 'SQRT({area})',
  },
  {
    name: 'POW',
    description: 'Raise to power',
    syntax: 'POW(base, exponent)',
    category: 'math',
    minArgs: 2,
    maxArgs: 2,
    example: 'POW({radius}, 2) * 3.14159',
  },
  {
    name: 'LN',
    description: 'Natural logarithm (base e)',
    syntax: 'LN(value)',
    category: 'math',
    minArgs: 1,
    maxArgs: 1,
    example: 'LN({concentration})',
  },
  {
    name: 'LOG',
    description: 'Logarithm base 10',
    syntax: 'LOG(value)',
    category: 'math',
    minArgs: 1,
    maxArgs: 1,
    example: 'LOG({volume})',
  },

  // Logical Functions
  {
    name: 'IF',
    description: 'Conditional logic',
    syntax: 'IF(condition, valueIfTrue, valueIfFalse)',
    category: 'logical',
    minArgs: 3,
    maxArgs: 3,
    example: 'IF({quantity} > 100, {price} * 0.9, {price})',
  },
  {
    name: 'AND',
    description: 'Logical AND',
    syntax: 'AND(condition1, condition2, ...)',
    category: 'logical',
    minArgs: 2,
    example: 'IF(AND({temp} > 100, {pressure} < 50), "OK", "Warning")',
  },
  {
    name: 'OR',
    description: 'Logical OR',
    syntax: 'OR(condition1, condition2, ...)',
    category: 'logical',
    minArgs: 2,
    example: 'IF(OR({status} == "urgent", {priority} > 5), "High", "Normal")',
  },

  // Statistical Functions
  {
    name: 'COUNT',
    description: 'Count number of values',
    syntax: 'COUNT(value1, value2, ...)',
    category: 'statistical',
    minArgs: 1,
    example: 'COUNT({field1}, {field2}, {field3})',
  },
  {
    name: 'MEDIAN',
    description: 'Find median value',
    syntax: 'MEDIAN(value1, value2, ...)',
    category: 'statistical',
    minArgs: 1,
    example: 'MEDIAN({sample1}, {sample2}, {sample3})',
  },
];

/**
 * Get functions by category
 */
export function getFunctionsByCategory(category: FormulaFunction['category']): FormulaFunction[] {
  return FORMULA_FUNCTIONS.filter(f => f.category === category);
}

/**
 * Get function by name
 */
export function getFunction(name: string): FormulaFunction | undefined {
  return FORMULA_FUNCTIONS.find(f => f.name.toLowerCase() === name.toLowerCase());
}

/**
 * Get all function names for autocomplete
 */
export function getFunctionNames(): string[] {
  return FORMULA_FUNCTIONS.map(f => f.name);
}
