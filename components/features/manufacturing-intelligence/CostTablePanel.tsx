"use client";

import { Table2 } from "lucide-react";
import { useState } from "react";

import { PartDetailsSheet } from "@/components/features/manufacturing-intelligence/PartDetailsSheet";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { Display } from "@/lib/costing/cost-table";

/**
 * The Cost tab's entry to the Excel view: the part's applied cost as a sheet (each operation with its machine, cycle time, setup, rates and where they
 * came from) in a near full-screen dialog over the page. The cost sections of the tab stay the working view; the sheet is a separate place to read the
 * same stored cost.
 */
export function CostTablePanel({ itemId, refreshKey, display }: { itemId: string; refreshKey: number; display: Display }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="flex items-center justify-between gap-2 pb-3" aria-label="Part details">
      <div>
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Part details</h3>
        <p className="text-[11px] text-muted-foreground">Every operation with its machine, cycle time, setup and rates, as a sheet.</p>
      </div>
      <Button type="button" variant="outline" size="sm" className="h-6 shrink-0 gap-1 px-2 text-[11px]" onClick={() => { setOpen(true); }}>
        <Table2 className="h-3 w-3" /> Open Excel view
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="h-[94vh] w-[98vw] max-w-[98vw] gap-0 p-0 sm:max-w-[98vw]">
          <DialogTitle className="sr-only">Part details</DialogTitle>
          <DialogDescription className="sr-only">The part's applied cost as a sheet.</DialogDescription>
          {open && <PartDetailsSheet itemId={itemId} refreshKey={refreshKey} display={display} inDialog />}
        </DialogContent>
      </Dialog>
    </section>
  );
}
