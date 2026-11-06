"use client";

import { Maximize2 } from "lucide-react";
import { useState } from "react";

import { CostTable } from "@/components/features/manufacturing-intelligence/CostTable";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useCostTable } from "@/lib/api/hooks/useCostTable";
import { notModelled, type Display } from "@/lib/costing/cost-table";

/**
 * The Cost tab's entry to the Part Details table (the applied cost, every column) in a dialog (every column, the period and
 * capital columns the cost model has no data for shown empty with the reason). It reads the stored records, so it shows what Apply wrote.
 */
export function CostTablePanel({ itemId, refreshKey, display }: { itemId: string; refreshKey: number; display: Display }) {
  const { data: table, isLoading, error } = useCostTable(itemId, refreshKey);
  const [open, setOpen] = useState(false);
  const part = table?.rows[0];

  return (
    <section className="space-y-1.5 pb-3" aria-label="Part cost">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Part details</h3>
        <Button type="button" variant="outline" size="sm" className="h-6 gap-1 px-2 text-[11px]" disabled={!table} onClick={() => { setOpen(true); }}>
          <Maximize2 className="h-3 w-3" /> Open table
        </Button>
      </div>

      {isLoading && <p role="status" className="py-4 text-center text-xs text-muted-foreground">Reading the applied cost…</p>}
      {error && <p role="alert" className="py-2 text-xs text-red-600">The cost table could not be read.</p>}
      {table && part?.statusNote && <p className="text-xs text-amber-600 dark:text-amber-500">{part.statusNote}</p>}
      {table && (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="flex h-[88vh] w-[96vw] max-w-[96vw] flex-col gap-2 sm:max-w-[96vw]">
            <DialogHeader>
              <DialogTitle>Part details — {part?.name}</DialogTitle>
              <DialogDescription>
                The applied cost per part, by cost object. Amounts in {display.symbol} (stored in {table.currency}).
              </DialogDescription>
            </DialogHeader>
            <div className="min-h-0 flex-1 overflow-auto rounded border border-border/60">
              <CostTable table={table} columns="all" display={display} />
            </div>
            <ul className="space-y-0.5 text-[11px] text-muted-foreground">
              {notModelled(table).map((c) => (
                <li key={c.label}><span className="font-medium text-foreground">{c.label}</span>: {c.note}</li>
              ))}
            </ul>
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}
