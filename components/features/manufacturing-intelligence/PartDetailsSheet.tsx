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
export function PartDetailsSheet({ itemId, refreshKey, display, inDialog = false }: { itemId: string; refreshKey: number; display: Display; inDialog?: boolean }) {
  const { data: table, isLoading, error } = useCostTable(itemId, refreshKey);
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={cn("flex min-w-0 flex-col gap-2 p-3", expanded ? "fixed inset-0 z-50 bg-background" : "h-full min-h-0", inDialog && "pr-10")}>
      <div className="flex shrink-0 items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">{table?.rows[0]?.name ?? "Part"} — Part details</h3>
          <p className="text-[11px] text-muted-foreground">Applied cost per part, by cost object. Amounts in {display.symbol}.</p>
        </div>
        {!inDialog && (
          <Button type="button" variant="outline" size="sm" className="h-7 gap-1 px-2 text-[11px]" onClick={() => { setExpanded((v) => !v); }}>
            {expanded ? <Minimize2 className="h-3 w-3" /> : <Maximize2 className="h-3 w-3" />}
            {expanded ? "Close" : "Full screen"}
          </Button>
        )}
      </div>

      {isLoading && <p role="status" className="py-6 text-center text-xs text-muted-foreground">Reading the applied cost…</p>}
      {error && <p role="alert" className="py-2 text-xs text-red-600">The cost table could not be read.</p>}
      {table?.rows[0]?.statusNote && <p className="text-xs text-amber-600 dark:text-amber-500">{table.rows[0].statusNote}</p>}
      {table && !table.rows.some((r) => r.kind === "process") && (
        <p role="status" className="shrink-0 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          No operation is costed for this part yet, so there are no process rows. Press Apply in the Cost Guide to cost the route; this sheet shows the stored result.
        </p>
      )}
      {table && (
        <>
          {/* The sheet is wider than the window: it scrolls sideways inside this box, with the scrollbars always drawn (a trackpad hides overlay ones). */}
          <div className="min-h-0 min-w-0 flex-1 overflow-auto rounded border border-border/60 [&::-webkit-scrollbar]:h-3 [&::-webkit-scrollbar]:w-3 [&::-webkit-scrollbar-corner]:bg-muted [&::-webkit-scrollbar-thumb]:rounded [&::-webkit-scrollbar-thumb]:bg-muted-foreground/40 [&::-webkit-scrollbar-track]:bg-muted">
            <CostTable table={table} columns="all" display={display} />
          </div>
          <details className="shrink-0 text-[11px] text-muted-foreground">
            <summary className="cursor-pointer select-none py-0.5 font-medium hover:text-foreground">Columns not modelled ({notModelled(table).length})</summary>
            <ul className="space-y-0.5 pb-2 pt-1">
              {notModelled(table).map((c) => (
                <li key={c.label}><span className="font-medium text-foreground">{c.label}</span>: {c.note}</li>
              ))}
            </ul>
          </details>
        </>
      )}
    </div>
  );
}
