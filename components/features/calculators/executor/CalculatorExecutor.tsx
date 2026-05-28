'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Calculator, ArrowLeft, Play, AlertCircle, Table2, Eye, ChevronDown, ChevronUp, AlertTriangle, Info, CheckCircle, XCircle, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import { useCalculator, useExecuteCalculator } from '@/lib/api/hooks';
import { calculatorsApi } from '@/lib/api/calculators';

type CalculatorExecutorProps = {
  calculatorId: string;
};

type FieldValues = Record<string, string | number | null>;

type FieldError = {
  field: string;
  message: string;
  type: 'required' | 'invalid' | 'range' | 'precision' | 'dependency';
  suggestion?: string;
};

type ErrorCategory = 'validation' | 'calculation' | 'network' | 'data' | 'permission' | 'timeout' | 'server' | 'client' | 'configuration';

type ErrorSeverityLevel = 'low' | 'medium' | 'high' | 'critical';

type EnhancedError = {
  category: ErrorCategory;
  severity: ErrorSeverityLevel;
  userMessage: string;
  technicalMessage?: string;
  suggestion: string;
  actionable: boolean;
  recoverable: boolean;
  helpUrl?: string;
  errorCode?: string;
};

// Reference table field names that trigger a lookup table display
const REFERENCE_TABLE_FIELDS = [
  'fromViscosity',
  'fromCavityPressure',
  'fromCavitiesRecommendation',
  'fromRunnerDia',
];

type ReferenceTableData = {
  fieldName: string;
  fieldLabel: string;
  tableName: string;
  tableId: string;
  column_definitions: Array<{ name: string; label: string; unit?: string; type: string }>;
  rows: Array<Record<string, any>>;
};

// Function to substitute formula placeholders with actual values (with units for display)
function substituteFormulaValues(formula: string, values: FieldValues): string {
  if (!formula) return '';
  
  // Replace placeholders like {Workpiece Initial dia} with actual values
  let substituted = formula.replace(/\{([^}]+)\}/g, (match, fieldName) => {
    const fieldKey = Object.keys(values).find(key => 
      key.toLowerCase().replace(/\s+/g, '') === fieldName.toLowerCase().replace(/\s+/g, '')
    );
    
    if (fieldKey && values[fieldKey] !== null && values[fieldKey] !== undefined) {
      const value = values[fieldKey];
      // Add units for common turning parameters
      if (fieldName.toLowerCase().includes('dia') || fieldName.toLowerCase().includes('diameter')) {
        return `${value} mm`;
      }
      if (fieldName.toLowerCase().includes('speed')) {
        return `${value} m/min`;
      }
      if (fieldName.toLowerCase().includes('feed')) {
        return `${value} mm/rev`;
      }
      if (fieldName.toLowerCase().includes('depth')) {
        return `${value} mm`;
      }
      if (fieldName.toLowerCase().includes('length')) {
        return `${value} mm`;
      }
      if (fieldName.toLowerCase().includes('time')) {
        return `${value} min`;
      }
      return value?.toString() || match;
    }
    
    return match; // Keep original if no match found
  });
  
  // Replace common constants
  substituted = substituted.replace(/\bPI\b/g, 'π (3.14159)');
  
  return substituted;
}

// Function to substitute formula placeholders with pure numerical values (for calculation)
function substituteNumericalValues(formula: string, values: FieldValues): string {
  if (!formula) return '';
  
  // Replace placeholders like {demo} with just the numerical values
  let substituted = formula.replace(/\{([^}]+)\}/g, (match, fieldName) => {
    const fieldKey = Object.keys(values).find(key => 
      key.toLowerCase().replace(/\s+/g, '') === fieldName.toLowerCase().replace(/\s+/g, '')
    );
    
    if (fieldKey && values[fieldKey] !== null && values[fieldKey] !== undefined) {
      const value = values[fieldKey];
      return value?.toString() || match;
    }
    
    return match; // Keep original if no match found
  });
  
  // Replace common constants with numerical values
  substituted = substituted.replace(/\bPI\b/g, Math.PI.toString());
  substituted = substituted.replace(/\bE\b/g, Math.E.toString());
  
  return substituted;
}

// Function to create step-by-step calculation breakdown with enhanced demonstration
function createCalculationSteps(formula: string, values: FieldValues): Array<{step: number, description: string, calculation: string, result?: string, isIntermediate?: boolean}> {
  if (!formula) return [];
  
  const steps: Array<{step: number, description: string, calculation: string, result?: string, isIntermediate?: boolean}> = [];
  let stepCount = 1;
  
  // Step 1: Show original formula with explanation
  const formulaExplanation = getTurningFormulaExplanation(formula) || "Original formula";
  steps.push({
    step: stepCount++,
    description: formulaExplanation,
    calculation: formula,
    isIntermediate: false
  });
  
  // Step 2: Show field substitution with live values
  const substituted = substituteFormulaValues(formula, values);
  if (substituted !== formula) {
    steps.push({
      step: stepCount++,
      description: "Substitute field values",
      calculation: substituted,
      isIntermediate: true
    });
  }
  
  // Step 3: Show function evaluation breakdown using numerical values
  const numericalSubstituted = substituteNumericalValues(formula, values);
  const functionBreakdown = evaluateFunctionSteps(numericalSubstituted, values);
  functionBreakdown.forEach(funcStep => {
    steps.push({
      step: stepCount++,
      description: funcStep.description,
      calculation: funcStep.calculation,
      result: funcStep.result,
      isIntermediate: true
    });
  });
  
  // Step 4: Show arithmetic operations step by step using numerical values
  const arithmeticSteps = evaluateArithmeticSteps(numericalSubstituted);
  arithmeticSteps.forEach(arithStep => {
    steps.push({
      step: stepCount++,
      description: arithStep.description,
      calculation: arithStep.calculation,
      result: arithStep.result,
      isIntermediate: true
    });
  });
  
  // Final step: Show final result
  try {
    const finalResult = tryEvaluate(numericalSubstituted);
    if (finalResult && finalResult !== numericalSubstituted && !isNaN(parseFloat(finalResult))) {
      steps.push({
        step: stepCount++,
        description: "Final result",
        calculation: `= ${finalResult}`,
        result: finalResult,
        isIntermediate: false
      });
    }
  } catch (error) {
    // Handle evaluation errors gracefully
  }
  
  return steps;
}

// Enhanced function to break down function evaluations
function evaluateFunctionSteps(expression: string, values: FieldValues): Array<{description: string, calculation: string, result: string}> {
  const steps: Array<{description: string, calculation: string, result: string}> = [];
  
  // Look for common functions and evaluate them step by step
  const functionPattern = /(SUM|AVG|MIN|MAX|LN|LOG|SQRT|POW|ABS|ROUND)\s*\([^)]+\)/g;
  const matches = expression.match(functionPattern);
  
  if (matches) {
    matches.forEach(match => {
      try {
        const funcName = match.match(/(SUM|AVG|MIN|MAX|LN|LOG|SQRT|POW|ABS|ROUND)/)?.[0];
        const args = match.match(/\(([^)]+)\)/)?.[1];
        
        if (funcName && args) {
          // Special handling for mathematical functions
          let functionResult: string;
          let description: string;
          let calculationDisplay: string;
          
          if (funcName === 'LOG') {
            const argValue = parseFloat(args.trim());
            if (!isNaN(argValue) && argValue > 0) {
              functionResult = Math.log10(argValue).toFixed(3);
              description = `Evaluate LOG function (base 10)`;
              calculationDisplay = `LOG(${argValue}) = log₁₀(${argValue})`;
            } else {
              functionResult = args;
              description = `Evaluate ${funcName} function`;
              calculationDisplay = `${funcName}(${args})`;
            }
          } else if (funcName === 'LN') {
            const argValue = parseFloat(args.trim());
            if (!isNaN(argValue) && argValue > 0) {
              functionResult = Math.log(argValue).toFixed(3);
              description = `Evaluate LN function (natural log, base e)`;
              calculationDisplay = `LN(${argValue}) = logₑ(${argValue})`;
            } else {
              functionResult = args;
              description = `Evaluate ${funcName} function`;
              calculationDisplay = `${funcName}(${args})`;
            }
          } else {
            // Handle other functions
            const evaluatedArgs = args.split(',').map(arg => {
              const trimmed = arg.trim();
              const argValue = tryEvaluate(trimmed);
              return argValue !== trimmed ? `${trimmed} = ${argValue}` : trimmed;
            }).join(', ');
            
            functionResult = tryEvaluate(match);
            description = `Evaluate ${funcName} function`;
            calculationDisplay = `${funcName}(${evaluatedArgs})`;
          }
          
          steps.push({
            description,
            calculation: calculationDisplay,
            result: functionResult
          });
        }
      } catch (error) {
        // Skip functions that can't be evaluated
      }
    });
  }
  
  return steps;
}

// Enhanced function to break down arithmetic operations
function evaluateArithmeticSteps(expression: string): Array<{description: string, calculation: string, result: string}> {
  const steps: Array<{description: string, calculation: string, result: string}> = [];
  
  // Handle parentheses first
  const parenthesesPattern = /\([^()]+\)/g;
  const parenthesesMatches = expression.match(parenthesesPattern);
  
  if (parenthesesMatches) {
    parenthesesMatches.forEach(match => {
      const innerExpression = match.slice(1, -1); // Remove parentheses
      const result = tryEvaluate(innerExpression);
      
      if (result !== innerExpression) {
        steps.push({
          description: "Evaluate expression in parentheses",
          calculation: `${match} = ${result}`,
          result: result
        });
      }
    });
  }
  
  // Handle multiplication and division (higher precedence)
  const multiplyDividePattern = /\d+(?:\.\d+)?\s*[*/]\s*\d+(?:\.\d+)?/g;
  const mdMatches = expression.match(multiplyDividePattern);
  
  if (mdMatches) {
    mdMatches.slice(0, 3).forEach(match => { // Limit to first 3 operations
      const result = tryEvaluate(match);
      if (result !== match) {
        steps.push({
          description: "Multiply/divide",
          calculation: `${match} = ${result}`,
          result: result
        });
      }
    });
  }
  
  // Handle addition and subtraction
  const addSubtractPattern = /\d+(?:\.\d+)?\s*[+-]\s*\d+(?:\.\d+)?/g;
  const asMatches = expression.match(addSubtractPattern);
  
  if (asMatches) {
    asMatches.slice(0, 3).forEach(match => { // Limit to first 3 operations
      const result = tryEvaluate(match);
      if (result !== match) {
        steps.push({
          description: "Add/subtract",
          calculation: `${match} = ${result}`,
          result: result
        });
      }
    });
  }
  
  return steps;
}

// Function to explain common turning formulas
function getTurningFormulaExplanation(formula: string): string | null {
  const lowerFormula = formula.toLowerCase();
  
  if (lowerFormula.includes('1000') && lowerFormula.includes('pi') && lowerFormula.includes('cutting') && lowerFormula.includes('speed')) {
    return "Spindle RPM calculation: N = (1000 × V) / (π × D)";
  }
  
  if (lowerFormula.includes('passes') && lowerFormula.includes('initial') && lowerFormula.includes('final')) {
    return "Number of passes calculation: Number of passes = ((Initial Ø - Final Ø) / 2) / Depth of cut";
  }
  
  if (lowerFormula.includes('machining') && lowerFormula.includes('time') && lowerFormula.includes('feed')) {
    return "Machining time calculation: Time = (Length / Feed rate) × Number of passes + Tool travel time";
  }
  
  if (lowerFormula.includes('cycle') && lowerFormula.includes('time')) {
    return "Total cycle time calculation: Convert machining time to appropriate units";
  }
  
  return null;
}

// Function to simplify formula by removing units for calculation
function simplifyForCalculation(formula: string): string {
  return formula
    .replace(/ mm/g, '')
    .replace(/ m\/min/g, '')
    .replace(/ mm\/rev/g, '')
    .replace(/ min/g, '')
    .replace(/ rev/g, '')
    .replace(/π \(3\.14159\)/g, '3.14159');
}

// Error handling and validation functions
function validateFieldValue(field: any, value: any): FieldError | null {
  const fieldName = field.displayLabel || field.fieldName;
  
  // Required field validation
  if (field.isRequired && (value === null || value === undefined || value === '')) {
    return {
      field: field.fieldName,
      message: `${fieldName} is required`,
      type: 'required',
      suggestion: `Please enter a value for ${fieldName}`
    };
  }
  
  // Skip validation if field is empty and not required
  if (value === null || value === undefined || value === '') {
    return null;
  }
  
  // Numeric field validation
  if (field.fieldType === 'number') {
    const numValue = typeof value === 'string' ? parseFloat(value) : value;
    
    if (isNaN(numValue)) {
      return {
        field: field.fieldName,
        message: `${fieldName} must be a valid number`,
        type: 'invalid',
        suggestion: `Enter a numeric value like 10 or 3.5`
      };
    }
    
    // Range validation for turning parameters
    if (fieldName.toLowerCase().includes('diameter') || fieldName.toLowerCase().includes('dia')) {
      if (numValue <= 0) {
        return {
          field: field.fieldName,
          message: `${fieldName} must be greater than 0`,
          type: 'range',
          suggestion: 'Diameter values must be positive numbers'
        };
      }
      if (numValue > 1000) {
        return {
          field: field.fieldName,
          message: `${fieldName} seems unusually large`,
          type: 'range',
          suggestion: 'Check if this diameter value is correct (typically < 1000mm)'
        };
      }
    }
    
    if (fieldName.toLowerCase().includes('speed')) {
      if (numValue <= 0) {
        return {
          field: field.fieldName,
          message: `${fieldName} must be greater than 0`,
          type: 'range',
          suggestion: 'Cutting speed must be a positive value'
        };
      }
      if (numValue > 1000) {
        return {
          field: field.fieldName,
          message: `${fieldName} seems very high`,
          type: 'range',
          suggestion: 'Check if this cutting speed is realistic (typically < 1000 m/min)'
        };
      }
    }
    
    if (fieldName.toLowerCase().includes('feed')) {
      if (numValue <= 0) {
        return {
          field: field.fieldName,
          message: `${fieldName} must be greater than 0`,
          type: 'range',
          suggestion: 'Feed rate must be a positive value'
        };
      }
      if (numValue > 10) {
        return {
          field: field.fieldName,
          message: `${fieldName} seems very high`,
          type: 'range',
          suggestion: 'Check if this feed rate is correct (typically < 10 mm/rev)'
        };
      }
    }
    
    if (fieldName.toLowerCase().includes('depth')) {
      if (numValue <= 0) {
        return {
          field: field.fieldName,
          message: `${fieldName} must be greater than 0`,
          type: 'range',
          suggestion: 'Depth of cut must be a positive value'
        };
      }
      if (numValue > 50) {
        return {
          field: field.fieldName,
          message: `${fieldName} seems very large`,
          type: 'range',
          suggestion: 'Check if this depth of cut is achievable (typically < 50mm)'
        };
      }
    }
  }
  
  return null;
}

function validateAllFields(calculator: any, fieldValues: FieldValues): FieldError[] {
  const errors: FieldError[] = [];
  
  if (!calculator?.fields) return errors;
  
  // Validate individual fields
  calculator.fields
    .filter((field: any) => field.fieldType !== 'calculated')
    .forEach((field: any) => {
      const error = validateFieldValue(field, fieldValues[field.fieldName]);
      if (error) {
        errors.push(error);
      }
    });
  
  // Cross-field validation for turning operations
  const initialDia = fieldValues['workpieceInitialDia'] || fieldValues['initialDiameter'];
  const finalDia = fieldValues['workpieceFinalDia'] || fieldValues['finalDiameter'];
  
  if (initialDia && finalDia && Number(initialDia) <= Number(finalDia)) {
    errors.push({
      field: 'finalDiameter',
      message: 'Final diameter must be smaller than initial diameter',
      type: 'dependency',
      suggestion: 'In turning operations, material is removed, so final diameter should be less than initial'
    });
  }
  
  return errors;
}

function getErrorIcon(type: FieldError['type']) {
  switch (type) {
    case 'required':
      return AlertCircle;
    case 'invalid':
      return XCircle;
    case 'range':
      return AlertTriangle;
    case 'precision':
      return Info;
    case 'dependency':
      return AlertTriangle;
    default:
      return AlertCircle;
  }
}

function getErrorSeverity(type: FieldError['type']): 'error' | 'warning' | 'info' {
  switch (type) {
    case 'required':
    case 'invalid':
    case 'dependency':
      return 'error';
    case 'range':
      return 'warning';
    case 'precision':
      return 'info';
    default:
      return 'error';
  }
}

/**
 * Get appropriate icon and styling for error severity levels
 * Following accessibility and visual hierarchy best practices
 */
function getSeverityDisplay(severity: ErrorSeverityLevel): { 
  icon: any; 
  bgColor: string; 
  textColor: string; 
  borderColor: string;
  badgeVariant: 'default' | 'destructive' | 'outline' | 'secondary';
} {
  switch (severity) {
    case 'critical':
      return {
        icon: XCircle,
        bgColor: 'bg-red-50 dark:bg-red-950/20',
        textColor: 'text-red-800 dark:text-red-200',
        borderColor: 'border-red-200 dark:border-red-800',
        badgeVariant: 'destructive'
      };
    case 'high':
      return {
        icon: AlertTriangle,
        bgColor: 'bg-orange-50 dark:bg-orange-950/20',
        textColor: 'text-orange-800 dark:text-orange-200',
        borderColor: 'border-orange-200 dark:border-orange-800',
        badgeVariant: 'destructive'
      };
    case 'medium':
      return {
        icon: AlertCircle,
        bgColor: 'bg-yellow-50 dark:bg-yellow-950/20',
        textColor: 'text-yellow-800 dark:text-yellow-200',
        borderColor: 'border-yellow-200 dark:border-yellow-800',
        badgeVariant: 'outline'
      };
    case 'low':
      return {
        icon: Info,
        bgColor: 'bg-blue-50 dark:bg-blue-950/20',
        textColor: 'text-blue-800 dark:text-blue-200',
        borderColor: 'border-blue-200 dark:border-blue-800',
        badgeVariant: 'secondary'
      };
    default:
      return {
        icon: AlertCircle,
        bgColor: 'bg-gray-50 dark:bg-gray-950/20',
        textColor: 'text-gray-800 dark:text-gray-200',
        borderColor: 'border-gray-200 dark:border-gray-800',
        badgeVariant: 'outline'
      };
  }
}

/**
 * Enhanced error categorization following industry UX best practices:
 * - Clear, non-technical language for users
 * - Actionable suggestions with specific steps
 * - Appropriate severity levels
 * - Recovery guidance
 * - Help resources when applicable
 */
function categorizeError(error: any): EnhancedError {
  const errorMessage = error?.message?.toLowerCase() || '';
  const statusCode = error?.status || error?.code;
  
  // Network connectivity errors (Critical)
  if (errorMessage.includes('network') || errorMessage.includes('fetch') || errorMessage.includes('connection') || statusCode === 'NETWORK_ERROR') {
    return {
      category: 'network',
      severity: 'critical',
      userMessage: 'Connection Lost',
      technicalMessage: error?.message,
      suggestion: 'Check your internet connection and try again in a moment',
      actionable: true,
      recoverable: true,
      helpUrl: '/help/network-issues'
    };
  }
  
  // Timeout errors (High)
  if (errorMessage.includes('timeout') || errorMessage.includes('aborted') || statusCode === 408) {
    return {
      category: 'timeout',
      severity: 'high',
      userMessage: 'Request Timed Out',
      technicalMessage: error?.message,
      suggestion: 'The calculation is taking longer than expected. Try with simpler values or check your connection',
      actionable: true,
      recoverable: true
    };
  }
  
  // Server errors (High)
  if (statusCode >= 500 || errorMessage.includes('server error') || errorMessage.includes('internal error')) {
    return {
      category: 'server',
      severity: 'high',
      userMessage: 'Server Issue',
      technicalMessage: error?.message,
      suggestion: 'Our servers are experiencing issues. Please try again in a few moments',
      actionable: true,
      recoverable: true,
      errorCode: `SRV-${statusCode || '500'}`
    };
  }
  
  // Permission/Authentication errors (Medium)
  if (errorMessage.includes('unauthorized') || errorMessage.includes('forbidden') || statusCode === 401 || statusCode === 403) {
    return {
      category: 'permission',
      severity: 'medium',
      userMessage: 'Access Denied',
      technicalMessage: error?.message,
      suggestion: statusCode === 401 ? 'Please log in again to continue' : 'You don\'t have permission to perform this action',
      actionable: true,
      recoverable: statusCode === 401,
      helpUrl: '/help/access-issues'
    };
  }
  
  // Client/Input validation errors (Medium)
  if (errorMessage.includes('validation') || errorMessage.includes('invalid') || errorMessage.includes('required') || statusCode === 400) {
    return {
      category: 'validation',
      severity: 'medium',
      userMessage: 'Invalid Input',
      technicalMessage: error?.message,
      suggestion: 'Please review your input values and ensure all required fields are filled correctly',
      actionable: true,
      recoverable: true,
      helpUrl: '/help/input-validation'
    };
  }
  
  // Calculation/Formula errors (Medium)
  if (errorMessage.includes('calculation') || errorMessage.includes('formula') || errorMessage.includes('math') || errorMessage.includes('division by zero')) {
    return {
      category: 'calculation',
      severity: 'medium',
      userMessage: 'Calculation Error',
      technicalMessage: error?.message,
      suggestion: 'Check your input values for errors like zero values in denominators or out-of-range numbers',
      actionable: true,
      recoverable: true,
      helpUrl: '/help/calculation-errors'
    };
  }
  
  // Configuration errors (Low)
  if (errorMessage.includes('config') || errorMessage.includes('setup') || errorMessage.includes('missing')) {
    return {
      category: 'configuration',
      severity: 'low',
      userMessage: 'Setup Issue',
      technicalMessage: error?.message,
      suggestion: 'There may be a configuration issue. Please contact support if this persists',
      actionable: false,
      recoverable: false,
      helpUrl: '/help/contact-support'
    };
  }
  
  // Default to data error (Medium)
  return {
    category: 'data',
    severity: 'medium',
    userMessage: 'Something Went Wrong',
    technicalMessage: error?.message,
    suggestion: 'An unexpected error occurred. Please try again, and contact support if the problem persists',
    actionable: true,
    recoverable: true,
    helpUrl: '/help/general-issues'
  };
}

// Helper function to break down formula evaluation into steps
function evaluateFormulaSteps(expression: string): Array<{description: string, calculation: string}> {
  const steps: Array<{description: string, calculation: string}> = [];
  
  // Look for common patterns and break them down
  if (expression.includes('(') && expression.includes(')')) {
    // Handle parentheses first
    const parenthesesMatch = expression.match(/\(([^)]+)\)/);
    if (parenthesesMatch) {
      steps.push({
        description: "Calculate inside parentheses",
        calculation: `${parenthesesMatch[1]} = ${tryEvaluate(parenthesesMatch[1])}`
      });
    }
  }
  
  // Look for multiplication/division
  if (expression.includes('*') || expression.includes('/')) {
    steps.push({
      description: "Perform multiplication/division",
      calculation: `= ${tryEvaluate(expression)}`
    });
  }
  
  return steps;
}

// Safe evaluation function with mathematical functions
function tryEvaluate(expr: string): string {
  try {
    // First, handle mathematical functions like LOG, LN, etc.
    let processedExpr = expr;
    
    // Handle LOG function (base 10)
    processedExpr = processedExpr.replace(/LOG\s*\(\s*([^)]+)\s*\)/g, (match, arg) => {
      const argValue = parseFloat(arg);
      if (!isNaN(argValue) && argValue > 0) {
        return Math.log10(argValue).toString();
      }
      return match;
    });
    
    // Handle LN function (natural log, base e)
    processedExpr = processedExpr.replace(/LN\s*\(\s*([^)]+)\s*\)/g, (match, arg) => {
      const argValue = parseFloat(arg);
      if (!isNaN(argValue) && argValue > 0) {
        return Math.log(argValue).toString();
      }
      return match;
    });
    
    // Handle SQRT function
    processedExpr = processedExpr.replace(/SQRT\s*\(\s*([^)]+)\s*\)/g, (match, arg) => {
      const argValue = parseFloat(arg);
      if (!isNaN(argValue) && argValue >= 0) {
        return Math.sqrt(argValue).toString();
      }
      return match;
    });
    
    // Handle ABS function
    processedExpr = processedExpr.replace(/ABS\s*\(\s*([^)]+)\s*\)/g, (match, arg) => {
      const argValue = parseFloat(arg);
      if (!isNaN(argValue)) {
        return Math.abs(argValue).toString();
      }
      return match;
    });
    
    // Handle POW function (power)
    processedExpr = processedExpr.replace(/POW\s*\(\s*([^,]+)\s*,\s*([^)]+)\s*\)/g, (match, base, exp) => {
      const baseValue = parseFloat(base);
      const expValue = parseFloat(exp);
      if (!isNaN(baseValue) && !isNaN(expValue)) {
        return Math.pow(baseValue, expValue).toString();
      }
      return match;
    });
    
    // Handle ROUND function
    processedExpr = processedExpr.replace(/ROUND\s*\(\s*([^,)]+)(?:\s*,\s*([^)]+))?\s*\)/g, (match, value, decimals) => {
      const val = parseFloat(value);
      const dec = decimals ? parseInt(decimals) : 0;
      if (!isNaN(val)) {
        return val.toFixed(dec);
      }
      return match;
    });
    
    // Replace mathematical constants
    processedExpr = processedExpr.replace(/\bPI\b/g, Math.PI.toString());
    processedExpr = processedExpr.replace(/\bE\b/g, Math.E.toString());
    
    // Now evaluate the processed expression for basic arithmetic
    const numericExpr = processedExpr.replace(/[^0-9+\-*/.()e]/g, '');
    if (numericExpr && numericExpr.length > 0) {
      const result = Function(`"use strict"; return (${numericExpr})`)();
      if (typeof result === 'number' && !isNaN(result)) {
        return result.toFixed(3);
      }
    }
  } catch (error) {
    // If evaluation fails, return original
  }
  return expr;
}

export function CalculatorExecutor({ calculatorId }: CalculatorExecutorProps) {
  const router = useRouter();
  const { data: calculator, isLoading, error } = useCalculator(calculatorId);
  const executeCalculatorMutation = useExecuteCalculator();

  const [fieldValues, setFieldValues] = useState<FieldValues>({});
  const [results, setResults] = useState<Record<string, any> | null>(null);
  const [executionError, setExecutionError] = useState<string | null>(null);
  const [lookupTables, setLookupTables] = useState<ReferenceTableData[]>([]);
  const [viewingTableFor, setViewingTableFor] = useState<string | null>(null);
  const [expandedFormulas, setExpandedFormulas] = useState<Set<string>>(new Set());
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const [retryCount, setRetryCount] = useState(0);
  const [resolvedTableLookups, setResolvedTableLookups] = useState<Record<string, any>>({});

  // Initialize field values when calculator loads
  useEffect(() => {
    if (calculator?.fields) {
      const initialValues: FieldValues = {};
      calculator.fields.forEach((field) => {
        // Only set default values for non-calculated fields
        if (field.fieldType !== 'calculated') {
          initialValues[field.fieldName] = field.defaultValue ?? null;
        }
      });
      setFieldValues(initialValues);
      
      // Fetch lookup tables immediately for display
      fetchLookupTables();
    }
  }, [calculator]);

  // Silent background validation with longer debounce to reduce unnecessary calls
  useEffect(() => {
    if (calculator && Object.keys(fieldValues).length > 0) {
      const timer = setTimeout(() => {
        const errors = validateAllFields(calculator, fieldValues);
        setFieldErrors(errors);
      }, 500); // Increased debounce time for better UX

      return () => clearTimeout(timer);
    }
  }, [calculator, fieldValues]);

  // Fetch reference tables for database_lookup fields after process
  const fetchLookupTables = async () => {
    if (!calculator?.fields) {
      return;
    }
    
    // If no associatedProcessId, try to fetch tables directly by field IDs
    if (!calculator.associatedProcessId) {
      const directTables: ReferenceTableData[] = [];
      
      for (const field of calculator.fields) {
        if (field.fieldType === 'database_lookup' && 
            field.dataSource === 'processes' && 
            field.sourceField?.startsWith('from_')) {
          const tableId = field.sourceField.replace('from_', '');
          
          try {
            const { processesApi } = await import('@/lib/api/processes');
            const table = await processesApi.getReferenceTable(tableId);
            if (table) {
              const processedRows = table.rows?.map((row) => {
                // Handle different data structures
                if (row.rowData) {
                  return row.rowData;
                }
                // If no rowData property, the row might be the data itself
                return row;
              }) || [];
              
              directTables.push({
                fieldName: field.fieldName,
                fieldLabel: field.displayLabel || field.fieldName,
                tableName: table.tableName,
                tableId: table.id,
                column_definitions: table.columnDefinitions || [],
                rows: processedRows
              });
            }
          } catch (error) {
            console.error('Failed to fetch table directly:', error);
          }
        }
      }
      
      if (directTables.length > 0) {
        setLookupTables(directTables);
        return;
      } else {
        return;
      }
    }

    const refTableFields = calculator.fields.filter(
      (f) =>
        f.fieldType === 'database_lookup' &&
        f.dataSource === 'processes' &&
        f.sourceField &&
        (REFERENCE_TABLE_FIELDS.includes(f.sourceField) || f.sourceField.startsWith('from_'))
    );

    if (refTableFields.length === 0) {
      return;
    }

    try {
      const { apiClient } = await import('@/lib/api/client');

      // Step 1: Resolve associatedProcessId (string slug) to UUID
      const processesResponse = await apiClient.get('/processes');
      const processes = (processesResponse as any).processes || [];

      const matchingProcess = processes.find((p: any) =>
        p.processName?.toLowerCase().replace(/\s+/g, '-') === calculator.associatedProcessId
      );

      if (!matchingProcess) return;

      // Step 2: Fetch reference tables for this process
      const response: any = await apiClient.get(`/processes/${matchingProcess.id}/reference-tables`);
      const allTables: any[] = response.tables || [];

      // Step 3: Match each refTable field to its reference table by name or ID
      const tableFieldNameMap: Record<string, string> = {
        fromViscosity: 'material viscosity',
        fromCavityPressure: 'cavity pressure',
        fromCavitiesRecommendation: 'cavities recommendation',
        fromRunnerDia: 'runner diameter',
      };

      const matched: ReferenceTableData[] = [];

      for (const field of refTableFields) {
        if (!field.sourceField) continue;
        
        let matchedTable;
        
        // Handle dynamic from_ fields by extracting table ID
        if (field.sourceField.startsWith('from_')) {
          const tableId = field.sourceField.replace('from_', '');
          matchedTable = allTables.find((t: any) => t.id === tableId);
        } else {
          // Handle legacy hardcoded field names
          const keyword = tableFieldNameMap[field.sourceField] || '';
          matchedTable = allTables.find((t: any) =>
            t.table_name?.toLowerCase().includes(keyword.toLowerCase())
          );
        }

        if (matchedTable) {
          matched.push({
            fieldName: field.fieldName,
            fieldLabel: field.displayLabel || field.fieldName,
            tableName: matchedTable.table_name,
            tableId: matchedTable.id,
            column_definitions: matchedTable.column_definitions || [],
            rows: matchedTable.rows || [],
          });
        }
      }

      setLookupTables(matched);
    } catch (err) {
      console.error('Failed to fetch lookup tables:', err);
    }
  };

  // Resolve all table_lookup fields and return their values
  const resolveTableLookupFields = async (currentFieldValues: FieldValues): Promise<Record<string, number | null>> => {
    if (!calculator?.fields) return {};

    const tableLookupFields = calculator.fields.filter((f: any) => f.fieldType === 'table_lookup');
    if (tableLookupFields.length === 0) return {};

    const resolved: Record<string, number | null> = {};

    await Promise.all(
      tableLookupFields.map(async (field: any) => {
        try {
          const cfg = field.inputConfig as any;
          if (!cfg?.table_name) return;

          // Build params by reading values from other fields
          const params: Record<string, any> = {};
          if (cfg.param_fields) {
            for (const [paramKey, sourceFieldName] of Object.entries(cfg.param_fields as Record<string, string>)) {
              // Allow literal values via _literal suffix convention
              if (paramKey.endsWith('_literal')) {
                params[paramKey.replace('_literal', '')] = sourceFieldName;
              } else {
                const val = currentFieldValues[sourceFieldName];
                if (val != null) params[paramKey] = val;
              }
            }
          }

          const res = await calculatorsApi.sheetMetalLookup(cfg.table_name, params);
          const resultKey = cfg.result_key || 'value';
          const value = resultKey === 'kerf' ? (res.kerf ?? null) : (res.value ?? null);
          resolved[field.fieldName] = value;
        } catch {
          resolved[field.fieldName] = null;
        }
      })
    );

    setResolvedTableLookups(resolved);
    return resolved;
  };

  const handleExecute = async () => {
    if (!calculator) return;

    // Pre-execution validation
    const validationErrors = validateAllFields(calculator, fieldValues);
    if (validationErrors.length > 0) {
      setFieldErrors(validationErrors);
      const errorCount = validationErrors.filter(e => getErrorSeverity(e.type) === 'error').length;
      const warningCount = validationErrors.filter(e => getErrorSeverity(e.type) === 'warning').length;

      if (errorCount > 0) {
        toast.error(`Please fix ${errorCount} error${errorCount > 1 ? 's' : ''} before calculating`);
        return;
      } else if (warningCount > 0) {
        toast.warning(`${warningCount} warning${warningCount > 1 ? 's' : ''} detected. Results may be unexpected.`);
      }
    }

    // Clear previous errors
    setExecutionError(null);
    setRetryCount(0);

    // Resolve table_lookup fields first, merge into inputValues
    const tableLookupValues = await resolveTableLookupFields(fieldValues);
    const mergedInputValues = { ...fieldValues, ...tableLookupValues };

    try {
      const result = await executeCalculatorMutation.mutateAsync({
        calculatorId,
        inputValues: mergedInputValues,
      });


      if (result.success) {
        setResults(result.results);

        // Fetch lookup tables to display below results
        await fetchLookupTables();

        // Check if any calculations failed
        const hasErrors = Object.values(result.results).some(
          (val: any) => val && typeof val === 'object' && val.error
        );

        if (hasErrors) {
          const errorResults = Object.entries(result.results).filter(
            ([key, val]) => val && typeof val === 'object' && (val as any).error
          );
          
          toast.warning(`Calculation completed with ${errorResults.length} error${errorResults.length > 1 ? 's' : ''}. Check results below.`);
        } else {
          toast.success(`✅ Calculation completed successfully in ${result.durationMs}ms`);
          setRetryCount(0); // Reset retry count on success
        }
      } else {
        const { category, userMessage, suggestion } = categorizeError({ message: result.error });
        setExecutionError(result.error || 'Failed to execute calculator');
        
        // Show categorized error message
        switch (category) {
          case 'network':
            toast.error(`🌐 ${userMessage}`, { description: suggestion });
            break;
          case 'timeout':
            toast.error(`⏱️ ${userMessage}`, { description: suggestion });
            break;
          case 'validation':
            toast.error(`⚠️ ${userMessage}`, { description: suggestion });
            break;
          case 'calculation':
            toast.error(`🧮 ${userMessage}`, { description: suggestion });
            break;
          default:
            toast.error(`❌ ${userMessage}`, { description: suggestion });
        }
      }
    } catch (err: any) {
      const { category, userMessage, suggestion } = categorizeError(err);
      setExecutionError(err?.message || 'Failed to execute calculator');
      setRetryCount(prev => prev + 1);
      
      // Enhanced error reporting based on retry count
      if (retryCount < 2) {
        toast.error(`${userMessage} (Attempt ${retryCount + 1}/3)`, { 
          description: suggestion,
          action: {
            label: "Retry",
            onClick: () => handleExecute()
          }
        });
      } else {
        toast.error(`${userMessage} - Multiple attempts failed`, { 
          description: "Please check your inputs or contact support",
          action: {
            label: "Reset",
            onClick: () => {
              setRetryCount(0);
              setExecutionError(null);
              setResults(null);
            }
          }
        });
      }
      
      console.error('Execution error:', err);
    }
  };

  const handleRetry = () => {
    setExecutionError(null);
    handleExecute();
  };

  // Enhanced loading state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center space-y-4 max-w-md">
          <div className="relative">
            <Calculator className="h-12 w-12 mx-auto text-primary animate-pulse" />
            <RefreshCw className="h-4 w-4 absolute -bottom-1 -right-1 animate-spin text-primary" />
          </div>
          <div className="space-y-2">
            <p className="text-lg font-medium">Loading Calculator</p>
            <p className="text-sm text-muted-foreground">
              Fetching calculator configuration and formulas...
            </p>
          </div>
          <div className="flex space-x-1 justify-center">
            <div className="w-2 h-2 bg-primary rounded-full animate-bounce"></div>
            <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
            <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
          </div>
        </div>
      </div>
    );
  }

  // Enhanced error state with recovery options
  if (error || !calculator) {
    const { category, userMessage, suggestion } = categorizeError(error);
    
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center space-y-6 max-w-lg mx-4">
          <div className="relative">
            <XCircle className="h-16 w-16 mx-auto text-destructive" />
            <AlertTriangle className="h-6 w-6 absolute -bottom-1 -right-1 text-yellow-500" />
          </div>
          
          <div className="space-y-3">
            <h2 className="text-xl font-semibold text-destructive">
              {error ? 'Failed to Load Calculator' : 'Calculator Not Found'}
            </h2>
            <p className="text-muted-foreground">
              {error instanceof Error ? userMessage : 'The calculator you requested could not be found.'}
            </p>
            {suggestion && (
              <p className="text-sm text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/30 p-3 rounded-lg">
                💡 {suggestion}
              </p>
            )}
          </div>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button 
              onClick={() => window.location.reload()} 
              variant="outline"
              className="flex items-center gap-2"
            >
              <RefreshCw className="h-4 w-4" />
              Try Again
            </Button>
            <Button 
              onClick={() => router.push('/calculators')} 
              variant="default"
            >
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Calculators
            </Button>
          </div>

          {/* Technical details for debugging (only in development) */}
          {process.env.NODE_ENV === 'development' && error && (
            <details className="text-left bg-gray-100 dark:bg-gray-800 p-4 rounded text-xs">
              <summary className="cursor-pointer font-medium">Technical Details</summary>
              <pre className="mt-2 whitespace-pre-wrap">
                {error instanceof Error ? error.stack : JSON.stringify(error, null, 2)}
              </pre>
            </details>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.push('/calculators')}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">{calculator.name}</h1>
            {calculator.description && (
              <p className="text-muted-foreground mt-1">{calculator.description}</p>
            )}
          </div>
        </div>
        <Button 
          onClick={handleExecute} 
          disabled={
            executeCalculatorMutation.isPending || 
            fieldErrors.some(e => getErrorSeverity(e.type) === 'error')
          }
          className={fieldErrors.some(e => getErrorSeverity(e.type) === 'error') ? 'opacity-50' : ''}
        >
          {executeCalculatorMutation.isPending ? (
            <>
              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              Calculating...
            </>
          ) : fieldErrors.some(e => getErrorSeverity(e.type) === 'error') ? (
            <>
              <XCircle className="h-4 w-4 mr-2" />
              Fix Errors to Calculate
            </>
          ) : fieldErrors.some(e => getErrorSeverity(e.type) === 'warning') ? (
            <>
              <AlertTriangle className="h-4 w-4 mr-2" />
              Calculate with Warnings
            </>
          ) : (
            <>
              <Play className="h-4 w-4 mr-2" />
              Calculate
            </>
          )}
        </Button>
      </div>

      {/* Execution Error Alert with Enhanced Messaging */}
      {executionError && (
        <Alert variant="destructive" className="border-l-4 border-l-destructive">
          <div className="flex items-start gap-3">
            <XCircle className="h-5 w-5 mt-0.5" />
            <div className="flex-1">
              <AlertTitle className="flex items-center gap-2">
                Calculation Failed
                {retryCount > 0 && (
                  <span className="text-xs bg-destructive/20 px-2 py-1 rounded">
                    Attempt {retryCount + 1}/3
                  </span>
                )}
              </AlertTitle>
              <AlertDescription className="mt-1">
                {categorizeError({ message: executionError }).userMessage}
              </AlertDescription>
              <div className="mt-3 flex gap-2">
                <Button variant="outline" size="sm" onClick={handleRetry} disabled={executeCalculatorMutation.isPending}>
                  <RefreshCw className="h-3 w-3 mr-1" />
                  Retry
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setExecutionError(null)}>
                  Dismiss
                </Button>
              </div>
            </div>
          </div>
        </Alert>
      )}

      {/* Validation Errors Summary */}
      {fieldErrors.length > 0 && (
        <Alert variant={fieldErrors.some(e => getErrorSeverity(e.type) === 'error') ? 'destructive' : 'default'} className="border-l-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 mt-0.5" />
            <div className="flex-1">
              <AlertTitle>
                {fieldErrors.filter(e => getErrorSeverity(e.type) === 'error').length > 0 
                  ? 'Input Validation Errors' 
                  : 'Input Warnings'
                }
              </AlertTitle>
              <AlertDescription className="mt-1">
                {fieldErrors.filter(e => getErrorSeverity(e.type) === 'error').length > 0 && (
                  <p className="text-sm">Please fix the following issues before calculating:</p>
                )}
                {fieldErrors.filter(e => getErrorSeverity(e.type) === 'warning').length > 0 && (
                  <p className="text-sm">The following warnings were detected:</p>
                )}
              </AlertDescription>
            </div>
          </div>
        </Alert>
      )}

      {/* Input Fields - Only show non-calculated fields */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Input Values</span>
            {/* Only show status when there are errors or all is valid after user interaction */}
            {fieldErrors.length > 0 && (
              <div className="flex items-center gap-2 text-sm">
                {fieldErrors.some(e => getErrorSeverity(e.type) === 'error') ? (
                  <><XCircle className="h-4 w-4 text-destructive" /><span className="text-destructive">{fieldErrors.filter(e => getErrorSeverity(e.type) === 'error').length} error(s)</span></>
                ) : (
                  <><AlertTriangle className="h-4 w-4 text-yellow-500" /><span className="text-yellow-600">{fieldErrors.length} warning(s)</span></>
                )}
              </div>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          {calculator.fields
            ?.filter((field) =>
              field.fieldType !== 'calculated' && field.fieldType !== 'table_lookup'
            )
            .map((field) => {
              const fieldError = fieldErrors.find(e => e.field === field.fieldName);
              const errorSeverity = fieldError ? getErrorSeverity(fieldError.type) : null;
              const ErrorIcon = fieldError ? getErrorIcon(fieldError.type) : null;
              
              return (
                <div key={field.id} className="space-y-2">
                  <Label htmlFor={field.fieldName} className={fieldError && errorSeverity === 'error' ? 'text-destructive' : ''}>
                    {field.displayLabel || field.fieldName}
                    {field.isRequired && <span className="text-destructive ml-1">*</span>}
                  </Label>
                  <div className="relative">
                    <Input
                      id={field.fieldName}
                      type={field.fieldType === 'number' ? 'number' : 'text'}
                      value={fieldValues[field.fieldName]?.toString() || ''}
                      onChange={(e) =>
                        setFieldValues((prev) => ({
                          ...prev,
                          [field.fieldName]: field.fieldType === 'number' ? parseFloat(e.target.value) : e.target.value,
                        }))
                      }
                      placeholder={field.displayLabel}
                      className={`${
                        fieldError
                          ? errorSeverity === 'error'
                            ? 'border-destructive bg-destructive/5 focus:border-destructive'
                            : errorSeverity === 'warning'
                            ? 'border-yellow-500 bg-yellow-50 dark:bg-yellow-950/20 focus:border-yellow-500'
                            : 'border-blue-500 bg-blue-50 dark:bg-blue-950/20 focus:border-blue-500'
                          : 'bg-primary/5 border-primary/10'
                      } ${fieldError ? 'pr-10' : ''}`}
                    />
                    
                    {/* Error/Warning Icon */}
                    {fieldError && ErrorIcon && (
                      <div className={`absolute right-2 top-1/2 -translate-y-1/2 ${
                        field.fieldType === 'database_lookup' && field.dataSource === 'processes' && field.sourceField?.startsWith('from_') 
                          ? 'right-8' 
                          : 'right-2'
                      }`}>
                        <ErrorIcon className={`h-4 w-4 ${
                          errorSeverity === 'error' ? 'text-destructive' :
                          errorSeverity === 'warning' ? 'text-yellow-500' : 'text-blue-500'
                        }`} />
                      </div>
                    )}
                    
                    {/* Show eye button for database lookup fields */}
                    {field.fieldType === 'database_lookup' && 
                     field.dataSource === 'processes' && 
                     field.sourceField?.startsWith('from_') && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="absolute right-2 top-1/2 -translate-y-1/2 h-6 w-6 p-0"
                        onClick={() => setViewingTableFor(
                          viewingTableFor === field.fieldName ? null : field.fieldName
                        )}
                      >
                        <Eye className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                  
                  {/* Field-specific error message */}
                  {fieldError && (
                    <div className={`flex items-start gap-2 text-xs p-2 rounded ${
                      errorSeverity === 'error' ? 'bg-destructive/10 text-destructive' :
                      errorSeverity === 'warning' ? 'bg-yellow-50 text-yellow-700 dark:bg-yellow-950/20 dark:text-yellow-300' :
                      'bg-blue-50 text-blue-700 dark:bg-blue-950/20 dark:text-blue-300'
                    }`}>
                      {ErrorIcon && <ErrorIcon className="h-3 w-3 mt-0.5 flex-shrink-0" />}
                      <div className="flex-1">
                        <p className="font-medium">{fieldError.message}</p>
                        {fieldError.suggestion && (
                          <p className="opacity-75 mt-1">{fieldError.suggestion}</p>
                        )}
                      </div>
                    </div>
                  )}
                  
                  {/* Unit information */}
                  {field.unit && !fieldError && (
                    <p className="text-xs text-muted-foreground">Unit: {field.unit}</p>
                  )}
                  
                  {/* Help text for turning parameters */}
                  {!fieldError && field.fieldType === 'number' && (
                    <div className="text-xs text-muted-foreground">
                      {field.fieldName.toLowerCase().includes('diameter') && 'Typical range: 1-500 mm'}
                      {field.fieldName.toLowerCase().includes('speed') && 'Typical range: 10-800 m/min'}
                      {field.fieldName.toLowerCase().includes('feed') && 'Typical range: 0.1-5 mm/rev'}
                      {field.fieldName.toLowerCase().includes('depth') && 'Typical range: 0.5-20 mm'}
                    </div>
                  )}
                </div>
              );
            })}
        </CardContent>
      </Card>

      {/* Table Lookup Auto-Resolved Fields */}
      {calculator.fields?.some((f: any) => f.fieldType === 'table_lookup') && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Table2 className="h-4 w-4" />
              Auto-Resolved Lookup Values
              <Badge variant="secondary" className="text-xs">From Reference Tables</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {calculator.fields
              ?.filter((field: any) => field.fieldType === 'table_lookup')
              .map((field: any) => {
                const resolved = resolvedTableLookups[field.fieldName];
                return (
                  <div key={field.id} className="space-y-1">
                    <Label className="text-xs text-muted-foreground">{field.displayLabel || field.fieldName}</Label>
                    <div className="px-3 py-2 bg-muted rounded border text-sm font-mono flex items-center justify-between">
                      <span>{resolved != null ? Number(resolved).toFixed(4) : '—'}</span>
                      {field.unit && <span className="text-xs text-muted-foreground ml-2">{field.unit}</span>}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Table: {field.inputConfig?.table_name ?? '?'}
                    </p>
                  </div>
                );
              })}
          </CardContent>
        </Card>
      )}

      {/* Reference Table Viewer */}
      {viewingTableFor && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Table2 className="h-5 w-5" />
                Reference Table for {calculator.fields?.find(f => f.fieldName === viewingTableFor)?.displayLabel || viewingTableFor}
              </CardTitle>
              <Button 
                variant="ghost" 
                size="sm"
                onClick={() => setViewingTableFor(null)}
              >
                Close
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {(() => {
              const field = calculator.fields?.find(f => f.fieldName === viewingTableFor);
              const table = lookupTables.find(t => t.fieldName === viewingTableFor);
              
              if (!table) {
                return (
                  <div className="text-center py-8">
                    <p className="text-muted-foreground">Loading reference table...</p>
                  </div>
                );
              }

              return (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Click on a row to select the value for {field?.displayLabel || viewingTableFor}
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse">
                    <thead>
                      <tr className="border-b">
                        {table.column_definitions.map((col) => (
                          <th key={col.name} className="text-left p-3 font-medium">
                            {col.label || col.name}
                            {col.unit && <span className="text-muted-foreground ml-1">({col.unit})</span>}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {table.rows.map((row, index) => (
                        <tr 
                          key={index} 
                          className="border-b hover:bg-primary/10 cursor-pointer transition-colors"
                          onClick={() => {
                            const field = calculator.fields?.find(f => f.fieldName === viewingTableFor);
                            if (field?.sourceField?.startsWith('from_')) {
                              // Extract table ID from sourceField (e.g., "from_viscosity" -> "viscosity")
                              const tableId = field.sourceField.replace('from_', '');
                              
                              // Find the appropriate column value to use
                              // For viscosity table, use the viscosity value
                              // For other tables, try to find a relevant numeric column
                              let valueToSet = null;
                              
                              if (tableId === 'viscosity' && row.viscosity !== undefined) {
                                valueToSet = row.viscosity;
                              } else {
                                // Find first numeric column that isn't 'id'
                                const numericCol = table.column_definitions.find(
                                  col => col.type === 'number' && col.name !== 'id'
                                );
                                if (numericCol) {
                                  valueToSet = row[numericCol.name];
                                }
                              }
                              
                              if (valueToSet !== null) {
                                setFieldValues(prev => ({
                                  ...prev,
                                  [viewingTableFor]: field.fieldType === 'number' ? Number(valueToSet) : valueToSet
                                }));
                                setViewingTableFor(null); // Close the table
                                toast.success(`Selected value: ${valueToSet}`);
                              }
                            }
                          }}
                        >
                          {table.column_definitions.map((col) => (
                            <td key={col.name} className="p-3">
                              {row[col.name] ?? '-'}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                    </table>
                  </div>
                </div>
              );
            })()}
          </CardContent>
        </Card>
      )}

      {/* Live Calculation Preview */}
      {calculator.fields?.some(field => field.fieldType === 'calculated') && Object.keys(fieldValues).length > 0 && (
        <Card className="bg-gradient-to-r from-blue-50 to-purple-50 dark:from-blue-950/20 dark:to-purple-950/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Eye className="h-5 w-5" />
              Live Calculation Preview
              <Badge variant="secondary">Updates in real-time</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {calculator.fields
                ?.filter((field) => field.fieldType === 'calculated' && field.defaultValue)
                .map((field) => {
                  const calculationSteps = createCalculationSteps(field.defaultValue, fieldValues);
                  
                  return (
                    <div key={field.id} className="bg-white dark:bg-gray-950 p-4 rounded-lg border">
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <Label className="text-sm font-medium">{field.displayLabel || field.fieldName}</Label>
                          <Badge variant="outline">Live Preview</Badge>
                        </div>
                        
                        <div className="font-mono text-sm bg-muted p-3 rounded border">
                          {field.defaultValue}
                        </div>
                        
                        <div className="flex items-center gap-2 text-sm text-green-600">
                          <CheckCircle className="h-4 w-4" />
                          Formula is valid - Preview updates as you change inputs
                        </div>
                        
                        {/* Live calculation breakdown */}
                        {calculationSteps.length > 0 && (
                          <div className="bg-gray-50 dark:bg-gray-900 p-4 rounded-lg border">
                            <h5 className="text-xs font-semibold mb-3 text-gray-700 dark:text-gray-300">
                              Live Calculation Steps:
                            </h5>
                            <div className="space-y-2">
                              {calculationSteps.slice(0, 4).map((step, index) => (
                                <div key={index} className="flex gap-2 items-center text-xs">
                                  <div className={`w-5 h-5 text-white rounded-full flex items-center justify-center text-xs font-bold ${
                                    step.isIntermediate ? 'bg-blue-500' : step.step === 1 ? 'bg-purple-500' : 'bg-green-500'
                                  }`}>
                                    {step.step}
                                  </div>
                                  <div className="flex-1 font-mono text-xs bg-white dark:bg-gray-950 p-2 rounded border">
                                    {step.calculation}
                                  </div>
                                  {step.result && step.isIntermediate && (
                                    <span className="text-green-600 font-bold text-xs">→ {step.result}</span>
                                  )}
                                </div>
                              ))}
                              
                              {/* Show final result if available */}
                              {calculationSteps.length > 0 && (
                                <div className="flex gap-2 items-center pt-2 border-t">
                                  <div className="w-5 h-5 bg-green-500 text-white rounded-full flex items-center justify-center text-xs font-bold">
                                    ✓
                                  </div>
                                  <div className="flex-1 font-mono text-sm bg-green-50 dark:bg-green-950/30 p-2 rounded border border-green-200 font-bold text-green-800 dark:text-green-200">
                                    Preview: {tryEvaluate(substituteNumericalValues(field.defaultValue, fieldValues))} {field.unit || ''}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                        
                        <div className="text-xs text-muted-foreground">
                          This preview updates automatically when you change input values above. Click "Calculate" to get the official result.
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Results - Show both calculated fields and formulas */}
      {results && (
        <Card>
          <CardHeader>
            <CardTitle>Results</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {/* Show calculated fields with formula breakdown */}
              {calculator.fields
                ?.filter((field) => field.fieldType === 'calculated')
                .map((field) => {
                  // Try multiple lookup strategies for field values
                  const value = results[field.id] ?? 
                               results[field.fieldName] ??
                               results[`calculate${field.fieldName}`] ??
                               results[`calculate${field.fieldName.charAt(0).toUpperCase() + field.fieldName.slice(1)}`];

                  // Handle error case
                  if (value && typeof value === 'object' && value.error) {
                    return (
                      <div key={field.id} className="py-3 px-4 bg-destructive/10 border border-destructive/20 rounded-lg">
                        <div className="flex justify-between items-center">
                          <div className="flex-1">
                            <span className="font-semibold text-base">{field.displayLabel || field.fieldName}</span>
                            {field.defaultValue && (
                              <p className="text-xs text-muted-foreground mt-1 font-mono">
                                {field.defaultValue}
                              </p>
                            )}
                            <p className="text-xs text-destructive mt-1">
                              Error: {value.error}
                            </p>
                          </div>
                          <span className="text-sm text-destructive font-medium">
                            Calculation Failed
                          </span>
                        </div>
                      </div>
                    );
                  }

                  // Don't skip if value is 0 or false, only skip if undefined
                  if (value === undefined || value === null) {
                    return (
                      <div key={field.id} className="py-3 px-4 bg-muted/50 border border-border rounded-lg">
                        <div className="flex justify-between items-center">
                          <div className="flex-1">
                            <span className="font-semibold text-base">{field.displayLabel || field.fieldName}</span>
                            {field.defaultValue && (
                              <p className="text-xs text-muted-foreground mt-1 font-mono">
                                {field.defaultValue}
                              </p>
                            )}
                          </div>
                          <span className="text-sm text-muted-foreground">
                            Pending
                          </span>
                        </div>
                      </div>
                    );
                  }

                  const displayValue = typeof value === 'object' ? value.value : value;
                  const formattedValue = typeof displayValue === 'number'
                    ? displayValue.toFixed(3)
                    : displayValue?.toString() || 'N/A';
                  
                  const isExpanded = expandedFormulas.has(field.id);

                  return (
                    <Collapsible key={field.id} open={isExpanded} onOpenChange={(open) => {
                      const newExpanded = new Set(expandedFormulas);
                      if (open) {
                        newExpanded.add(field.id);
                      } else {
                        newExpanded.delete(field.id);
                      }
                      setExpandedFormulas(newExpanded);
                    }}>
                      <div className="py-3 px-4 bg-success/5 border border-success/30 rounded-lg">
                        <div className="flex justify-between items-center">
                          <div className="flex-1">
                            <CollapsibleTrigger className="flex items-center gap-2 text-left hover:opacity-75 transition-opacity">
                              <span className="font-semibold text-base">{field.displayLabel || field.fieldName}</span>
                              {field.defaultValue && (
                                <div className="flex items-center gap-1">
                                  {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                </div>
                              )}
                            </CollapsibleTrigger>
                            <CollapsibleContent className="mt-2">
                              {field.defaultValue && (
                                <div className="space-y-3">
                                  <div className="bg-gradient-to-r from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 p-4 rounded-lg border">
                                    <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
                                      <Calculator className="h-4 w-4" />
                                      Step-by-Step Calculation
                                    </h4>
                                    <div className="space-y-3">
                                      {createCalculationSteps(field.defaultValue, fieldValues).map((step, index) => (
                                        <div key={index} className="flex gap-3 items-start">
                                          <div className={`flex-shrink-0 w-7 h-7 text-white rounded-full flex items-center justify-center text-xs font-bold ${
                                            step.isIntermediate ? 'bg-blue-500' : step.step === 1 ? 'bg-purple-500' : 'bg-green-500'
                                          }`}>
                                            {step.step}
                                          </div>
                                          <div className="flex-1 min-w-0">
                                            <div className="flex items-center justify-between mb-1">
                                              <p className="text-xs font-medium text-gray-700 dark:text-gray-300">{step.description}</p>
                                              {step.result && (
                                                <span className="text-xs bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 px-2 py-1 rounded">
                                                  = {step.result}
                                                </span>
                                              )}
                                            </div>
                                            <div className="bg-white dark:bg-gray-950 p-3 rounded border font-mono text-sm overflow-x-auto border-l-4 border-blue-500">
                                              <div className="flex items-center justify-between">
                                                <span className="text-gray-800 dark:text-gray-200">{step.calculation}</span>
                                                {step.result && step.isIntermediate && (
                                                  <span className="text-green-600 dark:text-green-400 font-bold ml-3">
                                                    → {step.result}
                                                  </span>
                                                )}
                                              </div>
                                            </div>
                                          </div>
                                        </div>
                                      ))}
                                      
                                      <div className="mt-4 pt-3 border-t border-gray-300 dark:border-gray-600">
                                        <div className="flex gap-3 items-center">
                                          <div className="flex-shrink-0 w-8 h-8 bg-green-500 text-white rounded-full flex items-center justify-center text-sm font-bold">
                                            ✓
                                          </div>
                                          <div className="flex-1">
                                            <p className="text-xs text-green-700 dark:text-green-300 mb-1">Final Result:</p>
                                            <div className="bg-green-50 dark:bg-green-950/30 p-2 rounded border border-green-200 dark:border-green-800 font-mono text-lg font-bold text-green-800 dark:text-green-200">
                                              {formattedValue} {field.unit || ''}
                                            </div>
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </CollapsibleContent>
                          </div>
                          <span className="text-2xl font-bold text-success ml-4">
                            {formattedValue}
                            {field.unit && <span className="text-sm text-muted-foreground ml-2">{field.unit}</span>}
                          </span>
                        </div>
                      </div>
                    </Collapsible>
                  );
                })}

              {/* Show regular formulas with expandable details */}
              {calculator.formulas && calculator.formulas.length > 0 && calculator.formulas
                .filter((formula) => formula.displayInResults !== false)
                .map((formula) => {
                  const value = results[formula.id] ?? results[formula.formulaName];
                  if (value === undefined) return null;

                  const displayValue = typeof value === 'object' ? value.value : value;
                  const formattedValue = typeof displayValue === 'number'
                    ? displayValue.toFixed(formula.decimalPlaces ?? 2)
                    : displayValue;
                  
                  const isExpanded = expandedFormulas.has(formula.id);

                  return (
                    <Collapsible key={formula.id} open={isExpanded} onOpenChange={(open) => {
                      const newExpanded = new Set(expandedFormulas);
                      if (open) {
                        newExpanded.add(formula.id);
                      } else {
                        newExpanded.delete(formula.id);
                      }
                      setExpandedFormulas(newExpanded);
                    }}>
                      <div className="py-3 px-4 bg-muted/50 rounded-lg border">
                        <div className="flex justify-between items-center">
                          <div className="flex-1">
                            <CollapsibleTrigger className="flex items-center gap-2 text-left hover:opacity-75 transition-opacity">
                              <span className="font-medium text-base">{formula.displayLabel || formula.formulaName}</span>
                              {formula.formulaExpression && (
                                <div className="flex items-center gap-1">
                                  {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                </div>
                              )}
                            </CollapsibleTrigger>
                            
                            <CollapsibleContent className="mt-2">
                              {formula.formulaExpression && (
                                <div className="space-y-3">
                                  <div className="bg-gradient-to-r from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 p-4 rounded-lg border">
                                    <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
                                      <Calculator className="h-4 w-4" />
                                      Step-by-Step Calculation
                                    </h4>
                                    <div className="space-y-3">
                                      {createCalculationSteps(formula.formulaExpression, fieldValues).map((step, index) => (
                                        <div key={index} className="flex gap-3 items-start">
                                          <div className="flex-shrink-0 w-6 h-6 bg-blue-500 text-white rounded-full flex items-center justify-center text-xs font-bold">
                                            {step.step}
                                          </div>
                                          <div className="flex-1 min-w-0">
                                            <p className="text-xs text-muted-foreground mb-1">{step.description}:</p>
                                            <div className="bg-white dark:bg-gray-950 p-2 rounded border font-mono text-sm overflow-x-auto">
                                              {step.calculation}
                                            </div>
                                          </div>
                                        </div>
                                      ))}
                                      
                                      <div className="mt-4 pt-3 border-t border-gray-300 dark:border-gray-600">
                                        <div className="flex gap-3 items-center">
                                          <div className="flex-shrink-0 w-8 h-8 bg-green-500 text-white rounded-full flex items-center justify-center text-sm font-bold">
                                            ✓
                                          </div>
                                          <div className="flex-1">
                                            <p className="text-xs text-green-700 dark:text-green-300 mb-1">Final Result:</p>
                                            <div className="bg-green-50 dark:bg-green-950/30 p-2 rounded border border-green-200 dark:border-green-800 font-mono text-lg font-bold text-green-800 dark:text-green-200">
                                              {formattedValue} {formula.outputUnit || ''}
                                            </div>
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </CollapsibleContent>
                          </div>
                          <span className="text-xl font-bold ml-4">
                            {formattedValue}
                            {formula.outputUnit && <span className="text-sm text-muted-foreground ml-2">{formula.outputUnit}</span>}
                          </span>
                        </div>
                      </div>
                    </Collapsible>
                  );
                })}
            </div>
          </CardContent>
        </Card>
      )}


    </div>
  );
}
