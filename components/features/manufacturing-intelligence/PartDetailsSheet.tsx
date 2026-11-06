"use client";

import { Maximize2, Minimize2 } from "lucide-react";
import { useState } from "react";

import { CostTable } from "@/components/features/manufacturing-intelligence/CostTable";
import { Button } from "@/components/ui/button";
import { useCostTable } from "@/lib/api/hooks/useCostTable";
import { notModelled, type Display } from "@/lib/costing/cost-table";
import { cn } from "@/lib/utils";

/**
 * The Excel tab: the part's whole applied cost as one sheet, every column, the cost object tree down the side (part, material, process groups and their
 * operations, logistics, procured parts, tooling). Same table and data path as the Part details dialog (one endpoint, the stored records), so the two
 * cannot disagree. A column the cost model holds no data for stays in the sheet, empty, with the reason in the legend.
 */
export function PartDetailsSheet({ itemId, refreshKey, display }: { itemId: string; refreshKey: number; display: Display }) {
  const { data: table, isLoading, error } = useCostTable(itemId, refreshKey);
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={cn("flex flex-col gap-2 p-3", expanded ? "fixed inset-0 z-50 bg-background" : "h-full min-h-0")}>
      <div className="flex shrink-0 items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">{table?.rows[0]?.name ?? "Part"} — Part details</h3>
          <p className="text-[11px] text-muted-foreground">Applied cost per part, by cost object. Amounts in {display.symbol}.</p>
        </div>
        <Button type="button" variant="outline" size="sm" className="h-7 gap-1 px-2 text-[11px]" onClick={() => { setExpanded((v) => !v); }}>
          {expanded ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
          {expanded ? "Close" : "Full screen"}
        </Button>
      </div>

      {isLoading && <p role="status" className="py-6 text-center text-xs text-muted-foreground">Reading the applied cost…</p>}
      {error && <p role="alert" className="py-2 text-xs text-red-600">The cost table could not be read.</p>}
      {table?.rows[0]?.statusNote && <p className="text-xs text-amber-600 dark:text-amber-500">{table.rows[0].statusNote}</p>}
      {table && (
        <>
          <div className="min-h-0 flex-1 overflow-auto rounded border border-border/60">
            <CostTable table={table} columns="all" display={display} />
          </div>
          <ul className="shrink-0 space-y-0.5 text-[11px] text-muted-foreground">
            {notModelled(table).map((c) => (
              <li key={c.label}><span className="font-medium text-foreground">{c.label}</span>: {c.note}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
