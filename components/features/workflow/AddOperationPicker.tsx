'use client';

import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

// Replaces the Workflow Builder's three chained native <select>s (Group →
// Route → Operation) plus a separate "+ Add" button — four interactions and
// three disabled states to add one operation, with no way to search and no
// way to see what a group contains before committing to it.
//
// Same real source (process_calculator_mappings, already filtered to active
// operations by the caller) and the same Group › Route hierarchy — but
// flattened into one searchable list with the hierarchy kept as visible
// section headings, so the structure still reads while typing an operation
// name jumps straight to it. Picking an item IS the add, so the trailing
// button disappears too.

export interface AddOperationOption {
  operation: string;
  processGroup: string;
  processRoute: string;
  machineClass?: string | null;
}

export interface AddOperationPickerProps {
  options: AddOperationOption[];
  onAdd: (option: AddOperationOption) => void;
  disabled?: boolean;
  /** Shown in place of the list when the catalog is real but fully consumed. */
  emptyLabel?: string;
}

export function AddOperationPicker({ options, onAdd, disabled, emptyLabel }: AddOperationPickerProps) {
  const [open, setOpen] = useState(false);

  // Group › Route sections, alphabetised at both levels so the list is stable
  // between renders regardless of catalog fetch order.
  const sections = useMemo(() => {
    const byHeading = new Map<string, AddOperationOption[]>();
    for (const option of options) {
      const heading = `${option.processGroup} › ${option.processRoute}`;
      const bucket = byHeading.get(heading);
      if (bucket) bucket.push(option);
      else byHeading.set(heading, [option]);
    }
    return [...byHeading.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([heading, items]) => ({
        heading,
        items: [...items].sort((a, b) => a.operation.localeCompare(b.operation)),
      }));
  }, [options]);

  const isEmpty = options.length === 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled === true || isEmpty}
          className={cn(
            'flex min-h-8 w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border px-3 py-1.5',
            'text-xs font-medium text-muted-foreground transition-colors',
            'hover:border-violet-500/60 hover:bg-violet-500/10 hover:text-violet-200',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500',
            'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-border disabled:hover:bg-transparent disabled:hover:text-muted-foreground',
          )}
        >
          <Plus className="h-3.5 w-3.5" />
          {isEmpty ? (emptyLabel ?? 'No further operations available') : 'Add operation'}
        </button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-[380px] p-0">
        <Command>
          <CommandInput placeholder="Search operations…" className="h-9 text-xs" />
          <CommandList className="max-h-[280px]">
            <CommandEmpty className="py-6 text-center text-xs text-muted-foreground">
              No matching operation in the catalog.
            </CommandEmpty>
            {sections.map((section) => (
              <CommandGroup key={section.heading} heading={section.heading}>
                {section.items.map((item) => (
                  <CommandItem
                    key={`${section.heading}:${item.operation}`}
                    value={`${item.operation} ${section.heading}`}
                    onSelect={() => {
                      onAdd(item);
                      setOpen(false);
                    }}
                    className="text-xs"
                  >
                    {item.operation}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
