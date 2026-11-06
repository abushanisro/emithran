"use client";

import { Table2 } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * The Cost tab's link to the Excel tab: the part's applied cost as a sheet, with each operation's machine, cycle time, setup, rates and where they came
 * from. The cost sections of this tab stay the working view; the sheet is a separate place to read the same stored cost.
 */
export function CostTablePanel({ onOpenExcel }: { onOpenExcel: () => void }) {
  return (
    <section className="flex items-center justify-between gap-2 pb-3" aria-label="Part details">
      <div>
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Part details</h3>
        <p className="text-[11px] text-muted-foreground">Every operation with its machine, cycle time, setup and rates, as a sheet.</p>
      </div>
      <Button type="button" variant="outline" size="sm" className="h-6 shrink-0 gap-1 px-2 text-[11px]" onClick={onOpenExcel}>
        <Table2 className="h-3 w-3" /> Open Excel view
      </Button>
    </section>
  );
}
