"use client"

import * as React from "react"
import { Check, ChevronsUpDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

export interface ComboboxOption {
  value: string
  label: string
  // Extra search terms that don't appear in the visible label (e.g. regional
  // aliases like "AL6101" for a row labelled "Generic Aluminum, ANSI 6101")
  // -- matched by cmdk's fuzzy filter alongside value/label, never displayed.
  keywords?: string[]
}

interface ComboboxProps {
  options: ComboboxOption[]
  value?: string
  onValueChange?: (value: string) => void
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  disabled?: boolean
  className?: string
}

export function Combobox({
  options,
  value,
  onValueChange,
  placeholder = "Select option...",
  searchPlaceholder = "Search...",
  emptyText = "No results found.",
  disabled = false,
  className,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false)

  const selectedOption = options.find((option) => option.value === value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "w-full justify-between font-normal",
            !selectedOption && "text-muted-foreground",
            className
          )}
          disabled={disabled}
        >
          <span className="truncate text-left">
            {selectedOption ? selectedOption.label : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50 flex-shrink-0" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        {/* shouldFilter left at cmdk's default -- Command's own value/
            onValueChange controls its transient KEYBOARD-CURSOR position
            (aria-selected, cmdk's bg-accent highlight), a different concept
            from "which option is actually chosen" (the persistent tint +
            checkmark below, driven purely by value === option.value).
            Confirmed live: trying to make cmdk's cursor track the real
            selection on open raced with cmdk's own hover/scroll handling and
            landed on the wrong row a few positions off -- not fixable by
            fighting cmdk's internal state, so the real selection gets its
            own always-correct marker instead and cmdk's cursor is left to
            behave normally (starts at the top, moves with arrow keys/hover). */}
        <Command shouldFilter={true}>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList className="max-h-[300px]">
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => {
                const isSelected = option.value === value
                return (
                  <CommandItem
                    key={option.value}
                    value={option.label}
                    keywords={[option.value, option.label, ...(option.keywords ?? [])]}
                    onSelect={() => {
                      onValueChange?.(isSelected ? "" : option.value)
                      setOpen(false)
                    }}
                    className={cn("text-foreground font-normal", isSelected && "bg-accent/40")}
                  >
                    {/* Only the selected row pays for a Check icon -- with
                        ~500 options, rendering an always-present opacity-0
                        SVG per row was real, measurable scroll-perf cost for
                        ~499 icons nobody ever sees. */}
                    {isSelected && <Check className="mr-2 h-4 w-4 flex-shrink-0" />}
                    <span className={cn("truncate", !isSelected && "pl-6")}>{option.label}</span>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
