'use client';

import React from 'react';
import { Eye, EyeOff } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { CalculatorField } from '@/lib/api/calculators';
import type { FieldHighlight } from '@/lib/features/field-highlight';

/** Required vs the machine's rating, shown under the Selected Tonnage input. */
export interface TonnageCheck {
  required: number;
  theoretical: number;
  selected: number;
}

interface CalculatorInputFieldProps {
  field: CalculatorField;
  value: unknown;
  /** Where the value came from ("Why:" caption); absent for a hand-typed value. */
  provenance: string | undefined;
  /** Why the engine could not fill the value, shown while it is blank. */
  gap: string | undefined;
  selectOptions: readonly string[] | undefined;
  /** The input is read from a reference table: an eye opens it. */
  hasLookupEye: boolean;
  /** The input is measured on CAD faces: an eye shows them. Undefined when it is not. */
  cadEvidenceKey: string | undefined;
  cadHighlight: FieldHighlight | null;
  evidenceOn: boolean;
  tonnageCheck: TonnageCheck | null;
  onChange: (fieldName: string, value: string | number) => void;
  onBlur: (fieldName: string) => void;
  onViewLookup: (field: CalculatorField) => void;
  onToggleEvidence: (field: CalculatorField, highlight: FieldHighlight | null, turnOn: boolean) => void;
}

// A value that came from a real source is tinted; the calculator's own default and a hand-typed value are not.
const REAL_VALUE_CLASS = 'border-blue-400 bg-blue-50 text-blue-900 dark:border-blue-700 dark:bg-blue-950/30 dark:text-blue-200';

/**
 * One input row of the calculator form. Memoized: typing in one input re-renders that row only,
 * not the whole form, because every prop is a primitive or a reference that is stable between
 * renders (field and highlight objects are cached upstream, callbacks are stable).
 */
export const CalculatorInputField = React.memo(function CalculatorInputField({
  field, value, provenance, gap, selectOptions, hasLookupEye, cadEvidenceKey, cadHighlight, evidenceOn, tonnageCheck,
  onChange, onBlur, onViewLookup, onToggleEvidence,
}: CalculatorInputFieldProps) {
  const label = field.displayLabel || field.fieldName;
  const isRealSourcedValue = !!provenance && provenance !== "Calculator's own default value";
  const inputValue = (value ?? '') as string | number;
  const numberInput = (
    <Input
      id={field.fieldName}
      type="number"
      step="0.01"
      value={inputValue}
      onChange={(e) => { onChange(field.fieldName, parseFloat(e.target.value) || 0); }}
      onBlur={() => { onBlur(field.fieldName); }}
      placeholder={`Enter ${label}`}
      className={`flex-1 ${isRealSourcedValue ? REAL_VALUE_CLASS : ''}`}
    />
  );

  return (
    <div className="space-y-2">
      <Label htmlFor={field.fieldName}>
        {label}
        {/* Labels that already name their unit ("... (Mpa)") don't repeat it. */}
        {field.unit && !label.toLowerCase().includes(`(${field.unit.toLowerCase()})`) && (
          <span className="text-muted-foreground ml-1">({field.unit})</span>
        )}
      </Label>

      {field.fieldType === 'select' && selectOptions ? (
        <Select value={String(inputValue)} onValueChange={(v) => { onChange(field.fieldName, v); }}>
          <SelectTrigger><SelectValue placeholder={`Choose ${label}`} /></SelectTrigger>
          <SelectContent>
            {selectOptions.map((opt) => <SelectItem key={opt} value={opt}>{opt}</SelectItem>)}
          </SelectContent>
        </Select>
      ) : field.fieldType === 'select' || field.fieldType === 'text' ? (
        <Input
          id={field.fieldName}
          type="text"
          value={inputValue}
          onChange={(e) => { onChange(field.fieldName, e.target.value); }}
          placeholder={`Enter ${label}`}
        />
      ) : hasLookupEye ? (
        <div className="flex gap-2">
          {numberInput}
          <Button type="button" variant="outline" size="sm" onClick={() => { onViewLookup(field); }} className="px-3" title="View reference table">
            <Eye className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <div className="flex gap-2">
          {numberInput}
          {cadEvidenceKey && (
            <Button
              type="button"
              variant={evidenceOn ? 'default' : 'outline'}
              size="sm"
              aria-pressed={evidenceOn}
              onClick={() => { onToggleEvidence(field, cadHighlight, !evidenceOn); }}
              className="px-3"
              title={evidenceOn
                ? 'Hide the CAD faces'
                : cadHighlight
                  ? 'Show the CAD faces this value was measured on'
                  : 'Show the CAD faces for this value (the part needs re-analysis first)'}
            >
              {evidenceOn ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
            </Button>
          )}
        </div>
      )}

      {provenance && <div className="text-xs text-muted-foreground">Why: {provenance}</div>}
      {gap && (value ?? '') === '' && (
        <div className="text-xs text-amber-600 dark:text-amber-400">Missing: {gap}</div>
      )}
      {tonnageCheck && <TonnageCheckNote check={tonnageCheck} />}
    </div>
  );
});

function TonnageCheckNote({ check: { required, theoretical, selected } }: { check: TonnageCheck }) {
  const ok = selected > 0 ? required <= selected : null;
  return (
    <div className="space-y-0.5 text-xs">
      <div className="text-muted-foreground">
        Calculated tonnage:{' '}
        {theoretical > 0 && <>Theoretical {theoretical.toFixed(2)} T → </>}
        <span className="font-semibold text-foreground">Recommended {required.toFixed(2)} T</span>
      </div>
      {ok !== null && (
        <div className={`font-medium ${ok ? 'text-emerald-600' : 'text-destructive'}`}>
          Required {required.toFixed(2)} T (Recommended Force) {ok ? '≤' : '>'} selected {selected.toFixed(1)} T
          {ok ? ' — machine has enough capacity' : ' — machine is undersized for this bend'}
        </div>
      )}
    </div>
  );
}
