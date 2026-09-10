'use client';

import { useEffect, useState } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Button } from '@/components/ui/button';
import { ChevronsUpDown, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

// Generic combobox: real API-sourced presets + free-form typing. Shared
// across every form that needs a "pick a real value on file, or type a new
// one" field (MHR machine records, Process Calculator Mappings) — extracted
// from its original single-use home in MHRFormDialog.tsx so both consumers
// get the same real dropdown UX instead of one falling back to a bare
// native <input list>/<datalist> (no search, no click-to-select styling,
// inconsistent across browsers).
export function ComboboxWithPresets({
  value, onChange, presets, placeholder, typePlaceholder, heading,
}: {
  value: string; onChange: (v: string) => void; presets: string[];
  placeholder: string; typePlaceholder: string; heading: string;
}) {
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState(value);
  useEffect(() => { setInputValue(value); }, [value]);
  const filtered = presets.filter(p => p.toLowerCase().includes(inputValue.toLowerCase()));
  const commit = (val: string) => {
    const trimmed = val.trim();
    if (trimmed) { onChange(trimmed); }
    setOpen(false);
  };
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        // Start the search box empty on every open so the full preset list
        // shows immediately — pre-loading it with the current value (as
        // inputValue's own sync effect does) filtered the list down to
        // near-nothing for any field that already had a value, hiding the
        // rest of the real options (e.g. Category showing only itself
        // instead of all real categories on file).
        if (o) setInputValue('');
      }}
    >
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" role="combobox" aria-expanded={open}
          className="w-full justify-between font-normal h-10 px-3 text-sm">
          <span className={cn('truncate', !value && 'text-muted-foreground')}>{value || placeholder}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder={typePlaceholder} value={inputValue}
            onValueChange={v => { setInputValue(v); onChange(v); }}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(inputValue); } }} />
          <CommandList
            // The Dialog this combobox lives in scroll-locks the page (via
            // react-remove-scroll) while open, and that lock only recognizes
            // elements inside the Dialog's own DOM subtree as scrollable —
            // this list is portalled to document.body by Popover, outside
            // that subtree, so the lock swallows the wheel event before the
            // browser's native scroll ever runs, and the list looks stuck.
            // Scrolling it manually here bypasses that native scroll path
            // entirely.
            onWheel={(e) => { e.currentTarget.scrollTop += e.deltaY; }}
          >
            {filtered.length === 0 && inputValue.trim() ? (
              <CommandEmpty>
                <button type="button" className="w-full text-left px-4 py-2 text-sm hover:bg-accent" onClick={() => commit(inputValue)}>
                  Use &ldquo;<strong>{inputValue.trim()}</strong>&rdquo;
                </button>
              </CommandEmpty>
            ) : null}
            {filtered.length > 0 && (
              <CommandGroup heading={heading}>
                {filtered.map(p => (
                  <CommandItem key={p} value={p} onSelect={() => { setInputValue(p); commit(p); }}>
                    <Check className={cn('mr-2 h-4 w-4', value === p ? 'opacity-100' : 'opacity-0')} />
                    {p}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
