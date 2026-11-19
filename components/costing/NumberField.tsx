'use client';

import { useEffect, useState } from 'react';

import type { FieldCommit } from '@/lib/costing/sand-scenario';

const rowClass = 'flex items-center gap-2 py-0.5';
const labelClass = 'text-xs text-muted-foreground w-24 shrink-0';
const controlClass = 'flex-1 min-w-0 text-xs border border-border rounded px-2 py-1 bg-background focus:outline-hidden focus:ring-1 focus:ring-primary/40';

/**
 * A Cost Guide number that commits on blur: an unusable number keeps the field and changes nothing. Empty is the engine's own value, shown as
 * the placeholder.
 */
export function NumberField({ label, value, placeholder, parse, onCommit, title }: {
  label: string;
  value: number | null;
  placeholder: string;
  parse: (text: string) => FieldCommit;
  onCommit: (v: number | null) => void;
  title: string;
}) {
  const [draft, setDraft] = useState(value == null ? '' : String(value));
  useEffect(() => { setDraft(value == null ? '' : String(value)); }, [value]);
  const parsed = parse(draft);
  return (
    <div className={rowClass} title={title}>
      <span className={labelClass}>{label}</span>
      <input
        className={`${controlClass} ${parsed === 'invalid' ? 'border-red-500' : ''}`}
        inputMode="decimal"
        value={draft}
        placeholder={placeholder}
        aria-invalid={parsed === 'invalid'}
        onChange={(e) => { setDraft(e.target.value); }}
        onBlur={() => {
          if (parsed === 'invalid') { setDraft(value == null ? '' : String(value)); return; }
          if (parsed !== value) onCommit(parsed);
        }}
      />
    </div>
  );
}
