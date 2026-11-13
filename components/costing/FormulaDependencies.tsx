'use client';

import { useState } from 'react';

import type { CalculationTraceStep } from '@/lib/api/hooks/useBOMItems';
import { buildCalculationTree, type CalculationNode } from '@/lib/costing/calculation-tree';

const shown = (v: number | string | null) =>
  v == null ? '—' : typeof v === 'number' ? v.toLocaleString('en-US', { maximumSignificantDigits: 4, useGrouping: false }) : v;

/** One row; a calculated value opens onto the values its formula is built from. */
function Row({ node, depth, initiallyOpen }: { node: CalculationNode; depth: number; initiallyOpen: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  const parent = node.children.length > 0;
  return (
    <>
      <tr className="border-b border-border/30 align-top hover:bg-muted/30">
        <td className="py-1 pr-3 whitespace-nowrap" style={{ paddingLeft: 8 + depth * 18 }}>
          {parent ? (
            <button
              type="button"
              onClick={() => { setOpen((v) => !v); }}
              className="inline-flex h-3.5 w-3.5 items-center justify-center border border-muted-foreground/50 text-[10px] leading-none text-muted-foreground mr-1.5 align-middle hover:text-foreground"
              aria-expanded={open}
              aria-label={`${open ? 'Collapse' : 'Expand'} ${node.name}`}
            >
              {open ? '−' : '+'}
            </button>
          ) : <span className="inline-block w-3.5 mr-1.5" />}
          <span className={depth === 0 ? 'font-semibold' : ''}>{node.name}</span>
        </td>
        <td className="py-1 pr-2 text-right tabular-nums whitespace-nowrap">{shown(node.value)}</td>
        <td className="py-1 pr-3 text-muted-foreground whitespace-nowrap">{node.unit ?? ''}</td>
        <td className="py-1 pr-2 text-muted-foreground">
          {node.kind === 'calculated' && node.description ? <span className="font-mono text-[11px]">= {node.description}</span> : node.description}
        </td>
      </tr>
      {open && node.children.map((c) => <Row key={c.name} node={c} depth={depth + 1} initiallyOpen={false} />)}
    </>
  );
}

/**
 * Formula Dependencies: the cycle time (or another result) and, under it, the values it is made of, each opening onto its own formula and
 * inputs down to where each input came from. Built from the calculator as it runs, so an edited input changes it.
 */
export function FormulaDependencies({ title, steps, rootName }: { title: string; steps: readonly CalculationTraceStep[]; rootName?: string }) {
  const root = buildCalculationTree(steps, rootName);
  if (!root) return null;
  return (
    <div className="rounded-lg border border-border">
      <div className="px-3 py-2 border-b border-border bg-muted/40">
        <div className="text-sm font-semibold">Formula Dependencies</div>
        <div className="text-xs text-muted-foreground">{title}</div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="py-1.5 pl-2 pr-3 font-medium">Name</th>
              <th className="py-1.5 pr-2 font-medium text-right">Value</th>
              <th className="py-1.5 pr-3 font-medium">Unit</th>
              <th className="py-1.5 pr-2 font-medium">Description</th>
            </tr>
          </thead>
          <tbody>
            <Row node={root} depth={0} initiallyOpen />
          </tbody>
        </table>
      </div>
    </div>
  );
}
