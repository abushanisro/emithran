import { useState, useEffect, useRef } from 'react';

import { Pencil } from '@/components/ui/icons';
import { cn } from '@/lib/utils';

import { Input } from './input';

interface EditableValueProps {
  value: number;
  onChange: (value: number) => void;
  isEditable?: boolean;
  formatDisplay?: (value: number) => string;
  className?: string;
  inputClassName?: string;
  min?: number;
  max?: number;
  step?: number;
}

export function EditableValue({
  value,
  onChange,
  isEditable = true,
  formatDisplay,
  className,
  inputClassName,
  min,
  max,
  step = 0.01,
}: EditableValueProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [inputValue, setInputValue] = useState(String(value));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setInputValue(String(value));
  }, [value]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleBlur = () => {
    setIsEditing(false);
    const numValue = parseFloat(inputValue);
    if (!isNaN(numValue)) {
      let finalValue = numValue;
      if (min !== undefined && finalValue < min) finalValue = min;
      if (max !== undefined && finalValue > max) finalValue = max;
      onChange(finalValue);
    } else {
      setInputValue(String(value));
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleBlur();
    } else if (e.key === 'Escape') {
      setInputValue(String(value));
      setIsEditing(false);
    }
  };

  if (!isEditable) {
    return (
      <span className={className}>
        {formatDisplay ? formatDisplay(value) : value}
      </span>
    );
  }

  if (isEditing) {
    return (
      <Input
        ref={inputRef}
        type="number"
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        className={cn('h-6 w-full text-sm', inputClassName)}
        min={min}
        max={max}
        step={step}
      />
    );
  }

  return (
    <button
      onClick={() => setIsEditing(true)}
      className={cn(
        'group inline-flex items-center gap-1 hover:bg-accent hover:text-accent-foreground rounded px-1 -mx-1 transition-colors',
        className
      )}
    >
      <span>{formatDisplay ? formatDisplay(value) : value}</span>
      <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-50 transition-opacity" />
    </button>
  );
}
