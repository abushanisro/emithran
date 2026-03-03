'use client';

import { useState, useRef, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from '@/components/ui/command';
import { AlertCircle, CheckCircle2, Info, Search, Plus } from 'lucide-react';
import { validateFormula, getAutocompleteSuggestions } from '@/lib/formula/validator';
import { FORMULA_FUNCTIONS } from '@/lib/formula/functions';
import { cn } from '@/lib/utils';

type FormulaEditorProps = {
  value: string;
  onChange: (value: string) => void;
  availableFields: Array<{ id?: string; name: string; type: string; label?: string }>;
  placeholder?: string;
  showHelp?: boolean;
  disabled?: boolean;
};

export function FormulaEditor({
  value,
  onChange,
  availableFields,
  placeholder = 'e.g., {volume} * {density} + 100',
  showHelp = true,
  disabled = false,
}: FormulaEditorProps) {
  const [cursorPosition, setCursorPosition] = useState(0);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showFunctionHelp, setShowFunctionHelp] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  const fieldNames = availableFields
    .filter(f => f.name && f.name.trim() !== '')
    .map(f => f.name);
  const validation = validateFormula(value, fieldNames);
  const suggestions = getAutocompleteSuggestions(value, cursorPosition, fieldNames);

  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        suggestionsRef.current &&
        !suggestionsRef.current.contains(event.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(event.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Handle input change
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    onChange(newValue);
    setCursorPosition(e.target.selectionStart || 0);
    setShowSuggestions(true);
  };

  // Handle cursor position change
  const handleCursorChange = () => {
    if (inputRef.current) {
      setCursorPosition(inputRef.current.selectionStart || 0);
    }
  };

  // Handle blur - close suggestions with delay to allow clicks
  const handleBlur = () => {
    setTimeout(() => {
      setShowSuggestions(false);
    }, 200);
  };

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setShowSuggestions(false);
    }
  };

  // Insert suggestion
  const insertSuggestion = (suggestion: { type: 'field' | 'function'; value: string }) => {
    if (!inputRef.current) return;

    const before = value.substring(0, cursorPosition);
    const after = value.substring(cursorPosition);

    let newValue = '';
    let newCursorPos = cursorPosition;

    if (suggestion.type === 'field') {
      // Check if we're inside a brace
      const lastOpenBrace = before.lastIndexOf('{');
      const lastCloseBrace = before.lastIndexOf('}');

      if (lastOpenBrace > lastCloseBrace) {
        // Replace partial field name
        const beforeBrace = before.substring(0, lastOpenBrace + 1);
        newValue = beforeBrace + suggestion.value + '}' + after;
        newCursorPos = beforeBrace.length + suggestion.value.length + 1;
      } else {
        // Insert new field reference
        newValue = before + '{' + suggestion.value + '}' + after;
        newCursorPos = before.length + suggestion.value.length + 2;
      }
    } else if (suggestion.type === 'function') {
      // Insert function with parentheses
      newValue = before + suggestion.value + '()' + after;
      newCursorPos = before.length + suggestion.value.length + 1;
    }

    onChange(newValue);
    setShowSuggestions(false);

    // Set cursor position after update
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.setSelectionRange(newCursorPos, newCursorPos);
      }
    }, 0);
  };

  // Insert field reference
  const insertField = (fieldName: string) => {
    const before = value.substring(0, cursorPosition);
    const after = value.substring(cursorPosition);
    const newValue = before + '{' + fieldName + '}' + after;
    onChange(newValue);

    // Set cursor after inserted field
    setTimeout(() => {
      if (inputRef.current) {
        const newPos = before.length + fieldName.length + 2;
        inputRef.current.focus();
        inputRef.current.setSelectionRange(newPos, newPos);
        setCursorPosition(newPos);
      }
    }, 0);
  };

  // Insert function
  const insertFunction = (funcName: string) => {
    const before = value.substring(0, cursorPosition);
    const after = value.substring(cursorPosition);
    const newValue = before + funcName + '()' + after;
    onChange(newValue);

    // Set cursor inside parentheses
    setTimeout(() => {
      if (inputRef.current) {
        const newPos = before.length + funcName.length + 1;
        inputRef.current.focus();
        inputRef.current.setSelectionRange(newPos, newPos);
        setCursorPosition(newPos);
      }
    }, 0);
  };

  return (
    <div className="space-y-3">
      {/* Formula Input */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Formula Expression</Label>
          {showHelp && (
            <Popover open={showFunctionHelp} onOpenChange={setShowFunctionHelp}>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm" className="h-6 px-2" disabled={disabled}>
                  <span className="text-xs">Functions</span>
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-96 max-h-96 overflow-y-auto" align="end">
                <div className="space-y-3">
                  <div>
                    <h4 className="font-semibold mb-2">Available Functions</h4>
                    <p className="text-xs text-muted-foreground mb-3">
                      Click a function to insert it into your formula
                    </p>
                  </div>

                  {['math', 'logical', 'statistical'].map((category) => {
                    const funcs = FORMULA_FUNCTIONS.filter(f => f.category === category);
                    if (funcs.length === 0) return null;

                    return (
                      <div key={category} className="space-y-2">
                        <h5 className="text-xs font-medium capitalize text-muted-foreground">
                          {category}
                        </h5>
                        <div className="space-y-1">
                          {funcs.map((func) => (
                            <button
                              key={func.name}
                              onClick={() => {
                                insertFunction(func.name);
                                setShowFunctionHelp(false);
                              }}
                              className="w-full text-left p-2 rounded-md hover:bg-accent text-xs group"
                            >
                              <div className="flex items-start justify-between">
                                <div className="flex-1">
                                  <div className="font-mono font-semibold text-primary">
                                    {func.syntax}
                                  </div>
                                  <div className="text-muted-foreground mt-0.5">
                                    {func.description}
                                  </div>
                                  <div className="text-muted-foreground/70 mt-1 font-mono text-[10px]">
                                    {func.example}
                                  </div>
                                </div>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </PopoverContent>
            </Popover>
          )}
        </div>

        <div className="relative">
          <Input
            ref={inputRef}
            value={value}
            onChange={handleChange}
            onKeyUp={handleCursorChange}
            onKeyDown={handleKeyDown}
            onClick={handleCursorChange}
            onBlur={handleBlur}
            placeholder={placeholder}
            disabled={disabled}
            className={cn(
              'font-mono text-sm',
              disabled ? "bg-secondary/20" : "bg-primary/5 border-primary/10",
              validation.errors.length > 0 && 'border-destructive focus-visible:ring-destructive',
              validation.isValid && value && 'border-green-500 focus-visible:ring-green-500'
            )}
          />

          {/* Autocomplete Suggestions */}
          {showSuggestions && suggestions.length > 0 && (
            <div
              ref={suggestionsRef}
              className="absolute z-50 w-full mt-1 bg-popover border rounded-md shadow-lg max-h-60 overflow-y-auto"
            >
              {suggestions.map((suggestion, index) => (
                <button
                  key={`${suggestion.type}-${suggestion.value}-${index}`}
                  onClick={() => insertSuggestion(suggestion)}
                  className="w-full text-left px-3 py-2 hover:bg-accent text-sm flex items-center justify-between"
                >
                  <div className="flex items-center gap-2">
                    <Badge variant={suggestion.type === 'field' ? 'default' : 'secondary'} className="text-xs">
                      {suggestion.type}
                    </Badge>
                    <span className="font-mono">{suggestion.value}</span>
                  </div>
                  {suggestion.description && (
                    <span className="text-xs text-muted-foreground">{suggestion.description}</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Validation Status */}
        <div className="flex items-start gap-2 text-xs">
          {validation.isValid && value && (
            <div className="flex items-center gap-1 text-green-600">
              <CheckCircle2 className="h-3 w-3" />
              <span>Formula is valid</span>
            </div>
          )}

          {validation.errors.length > 0 && (
            <div className="flex items-start gap-1 text-destructive">
              <AlertCircle className="h-3 w-3 mt-0.5" />
              <div className="space-y-1">
                {validation.errors.map((error, index) => (
                  <div key={index}>{error.message}</div>
                ))}
              </div>
            </div>
          )}

          {validation.warnings.length > 0 && (
            <div className="flex items-start gap-1 text-amber-600">
              <Info className="h-3 w-3 mt-0.5" />
              <div className="space-y-1">
                {validation.warnings.map((warning, index) => (
                  <div key={index}>{warning.message}</div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Help Text */}
        <p className="text-xs text-muted-foreground">
          Use <code className="px-1 py-0.5 bg-muted rounded">{'{fieldName}'}</code> for fields,{' '}
          <code className="px-1 py-0.5 bg-muted rounded">FUNCTION()</code> for functions.{' '}
          Examples: <code className="px-1 py-0.5 bg-muted rounded">SUM({'{volume}'}, {'{weight}'})</code>,{' '}
          <code className="px-1 py-0.5 bg-muted rounded">IF({'{quantity}'} {'>'} 100, {'{price}'} * 0.9, {'{price}'})</code>
        </p>
      </div>

      {/* Quick Insert Dropdowns */}
      <div className="grid grid-cols-2 gap-2">
        {/* Fields Dropdown */}
        <div>
          <Select
            value=""
            disabled={disabled}
            onValueChange={(fieldName) => {
              if (fieldName) {
                insertField(fieldName);
              }
            }}
          >
            <SelectTrigger className={cn("h-9 text-xs", disabled ? "bg-secondary/20" : "bg-primary/5 border-primary/10")}>
              <SelectValue placeholder={availableFields.length > 0 ? "+ Insert Field" : "No fields"} />
            </SelectTrigger>
            <SelectContent>
              {availableFields.length > 0 ? (
                availableFields
                  .filter((field) => field.name && field.name.trim() !== '')
                  .map((field) => (
                    <SelectItem key={field.id || field.name} value={field.name}>
                      <span className="text-xs">{field.label || field.name}</span>
                    </SelectItem>
                  ))
              ) : (
                <SelectItem value="_none" disabled>No fields available</SelectItem>
              )}
              {availableFields.length > 0 && availableFields.filter((field) => field.name && field.name.trim() !== '').length === 0 && (
                <SelectItem value="_none" disabled>No fields with labels yet</SelectItem>
              )}
            </SelectContent>
          </Select>
        </div>

        {/* Common Functions */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className={cn("w-full justify-start text-xs", disabled ? "bg-secondary/20" : "bg-primary/5 border-primary/10")} disabled={disabled}>
              <span className="mr-2">ƒ</span> Insert Function
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-2" align="end">
            <div className="space-y-1 max-h-60 overflow-y-auto">
              {['SUM', 'AVG', 'MIN', 'MAX', 'IF', 'ROUND'].map((funcName) => {
                const func = FORMULA_FUNCTIONS.find(f => f.name === funcName);
                return (
                  <button
                    key={funcName}
                    onClick={() => insertFunction(funcName)}
                    className="w-full text-left px-2 py-1.5 rounded-md hover:bg-accent text-xs"
                  >
                    <div className="font-mono font-semibold">{func?.syntax}</div>
                    <div className="text-muted-foreground text-[10px] mt-0.5">{func?.description}</div>
                  </button>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {/* Detected Fields & Functions */}
      {(validation.fields.length > 0 || validation.functions.length > 0) && (
        <div className="flex flex-wrap gap-2 pt-2 border-t">
          {validation.fields.length > 0 && (
            <div className="flex items-center gap-1">
              <span className="text-xs text-muted-foreground">Fields:</span>
              {validation.fields
                .filter(fieldName => fieldName && fieldName.trim() !== '')
                .map((fieldName, idx) => {
                  const field = availableFields.find(f => f.name === fieldName);
                  return (
                    <Badge key={`${fieldName}-${idx}`} variant="default" className="text-xs">
                      {field?.label || fieldName}
                    </Badge>
                  );
                })}
            </div>
          )}

          {validation.functions.length > 0 && (
            <div className="flex items-center gap-1">
              <span className="text-xs text-muted-foreground">Functions:</span>
              {validation.functions.map((func) => (
                <Badge key={func} variant="secondary" className="text-xs">
                  {func}
                </Badge>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
