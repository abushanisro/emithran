"use client";

import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";

import { columnGroups, columnsFor, formatCell, visibleRows, type ColumnSet, type CostTable as CostTableData, type Display } from "@/lib/costing/cost-table";
import { cn } from "@/lib/utils";

/**
 * The applied cost as a tree table: the part, its material, its process groups and their operations, by column. One component for both views: the page's
 * compact table (`columns="basic"`) and the dialog's full one (`columns="all"`), so there is one data path and one layout. A column the cost model has no
 * data for stays in the full table, empty, with the reason on its header.
 */
export function CostTable({ table, columns, display }: { table: CostTableData; columns: ColumnSet; display: Display }) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const cols = columnsFor(table, columns);
  const rows = visibleRows(table.rows, collapsed);
  const full = columns === "all";
  const toggle = (id: string) =>
    { setCollapsed((prev) => { const next = new Set(prev); if (!next.delete(id)) next.add(id); return next; }); };

  return (
    <table className="w-full border-separate border-spacing-0 text-xs">
      <thead className="sticky top-0 z-20 bg-muted text-muted-foreground">
        {full && (
          <tr>
            <th className="sticky left-0 z-30 bg-muted" />
            {columnGroups(cols).map((g, i) => (
              <th key={`${g.group}-${i}`} colSpan={g.span} className="border-b border-l border-border/60 px-2 py-1 text-center text-[10px] font-semibold uppercase tracking-wide">
                {g.group}
              </th>
            ))}
          </tr>
        )}
        <tr>
          <th className={cn("sticky left-0 z-30 border-b border-border bg-muted px-2 py-1.5 text-left text-[10px] font-semibold uppercase tracking-wide", full ? "min-w-[220px]" : "min-w-[130px]")}>Cost object</th>
          {cols.map((c) => (
            <th
              key={c.key}
              title={c.note}
              className={cn("border-b border-l border-border/60 px-2 py-1.5 text-[10px] font-semibold", full ? "whitespace-nowrap" : "min-w-[60px] leading-tight", c.unit === "text" ? "text-left" : "text-right", !c.modelled && "text-muted-foreground/60")}
            >
              {c.label}
              {c.note && <span className="ml-0.5 align-super text-[8px]">ⓘ</span>}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className={cn("group hover:bg-muted/40", r.kind === "part" && "bg-muted/30 font-semibold", r.kind === "group" && "font-medium")}>
            <td className="sticky left-0 z-10 border-b border-border/40 bg-background group-hover:bg-muted/40 px-2 py-1">
              <div className="flex items-center gap-1" style={{ paddingLeft: r.depth * 14 }}>
                {r.hasChildren ? (
                  <button type="button" onClick={() => { toggle(r.id); }} aria-label={collapsed.has(r.id) ? `Expand ${r.name}` : `Collapse ${r.name}`} className="rounded p-0.5 hover:bg-muted">
                    {collapsed.has(r.id) ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  </button>
                ) : <span className="w-4" />}
                {r.status === "ok"
                  ? <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-500" aria-label="Costed" />
                  : <AlertTriangle className="h-3 w-3 shrink-0 text-amber-500" aria-label={r.statusNote ?? "Needs attention"} />}
                <span className="truncate" title={r.statusNote ?? r.name}>{r.name}</span>
              </div>
            </td>
            {cols.map((c) => (
              <td
                key={c.key}
                className={cn("whitespace-nowrap border-b border-l border-border/40 px-2 py-1 tabular-nums", c.unit === "text" ? "text-left" : "text-right", !c.modelled && "text-muted-foreground/40")}
              >
                {formatCell(r.values[c.key], c, display)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
