'use client';

import { AlertTriangle, Check, Info } from 'lucide-react';
import { useId, useRef } from 'react';

import { fmtMinutes, fmtMoney } from '@/lib/routing/route-format';
import { groupRouteNodes, maxRouteCost, ROUTE_SORT_MODES, sortRouteNodes, type RouteSortMode } from '@/lib/routing/route-sort';
import type { RouteNode } from '@/lib/routing/route-tree';
import { cn } from '@/lib/utils';

// The Workflow Builder's route COMPARISON surface — one job only: pick a route.
//
// Deliberately not an accordion. Nielsen Norman Group's data-table research
// (the four major user tasks) is explicit that when the task is "view or edit
// a single record", accordions "encourage clutter and impair access to nearby
// records", and the recommended shape is a side panel that keeps the record
// being edited visible ALONGSIDE the surrounding rows. The previous build put
// the entire step editor inside the selected row's expanded region, so the
// controls moved every time selection changed and the rows you were comparing
// against got pushed off screen. Editing now lives in RouteStepEditor, in a
// persistent pane beside this list.
//
// Comparison itself follows NN/g's three rules for comparison tables —
// simplicity (one row shape, no nested chrome), consistency (every row shows
// the same fields in the same columns, aligned and tabular), and scannability
// (a frozen column header, real numeric alignment, and a relative cost bar).
//
// Dumb by design: no fetching, no sorting policy, no route-application logic.
// Ordering/grouping come from the pure helpers in lib/routing/route-sort.ts.

export interface RouteCompareListProps {
  nodes: RouteNode[];
  selectedId: string | null;
  onSelect: (node: RouteNode) => void;
  /**
   * Up to the top 3 real routes for this part (selectTopRoutes — cheapest
   * among capable/feasible/fully-costed candidates), most-recommended first.
   * Empty when no candidate qualifies. Always pinned to the top of their
   * respective group in 'recommended' sort mode.
   */
  recommendedIds: readonly string[];
  sortMode: RouteSortMode;
  onSortModeChange: (mode: RouteSortMode) => void;
  currencySymbol: string;
  /** The route comparison is a real 8-18s backend computation (see
   *  useRouteComparison's own timeout note) — long enough that an empty list
   *  would otherwise be read as "this part has no routes" for most of the wait. */
  isLoading?: boolean;
  /** Real error from the comparison request, so a failure is not shown as an empty result. */
  errorMessage?: string | null;
}

function Badge({ tone, children }: { tone: 'emerald' | 'blue' | 'amber' | 'violet' | 'red'; children: React.ReactNode }) {
  const tones: Record<typeof tone, string> = {
    emerald: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    blue: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
    amber: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    violet: 'bg-violet-500/15 text-violet-300 border-violet-500/30',
    red: 'bg-red-500/15 text-red-300 border-red-500/30',
  };
  return (
    <span className={cn('inline-flex items-center rounded-full border px-1.5 py-px text-[10px] font-medium leading-4 whitespace-nowrap', tones[tone])}>
      {children}
    </span>
  );
}

export function RouteCompareList({
  nodes, selectedId, onSelect, recommendedIds, sortMode, onSortModeChange, currencySymbol,
  isLoading = false, errorMessage = null,
}: RouteCompareListProps) {
  const groupId = useId();
  const listRef = useRef<HTMLDivElement>(null);

  const groups = groupRouteNodes(sortRouteNodes(nodes, sortMode, recommendedIds));
  const costScale = maxRouteCost(nodes);
  const selectableIds = groups.flatMap((g) => g.nodes.filter((n) => n.selectable).map((n) => n.id));

  // Roving arrow-key selection across the whole radiogroup, groups included —
  // the list is one choice, so Up/Down must not stop at a group boundary.
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    if (selectableIds.length === 0) return;
    const current = selectedId ? selectableIds.indexOf(selectedId) : -1;
    const delta = e.key === 'ArrowDown' ? 1 : -1;
    const nextIndex = current < 0
      ? (delta === 1 ? 0 : selectableIds.length - 1)
      : (current + delta + selectableIds.length) % selectableIds.length;
    const nextId = selectableIds[nextIndex];
    const next = nodes.find((n) => n.id === nextId);
    if (next) {
      onSelect(next);
      listRef.current?.querySelector<HTMLElement>(`[data-route-id="${next.id}"]`)?.scrollIntoView({ block: 'nearest' });
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Toolbar — the one place sorting is decided, above the frozen header */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/60 px-4 py-2.5">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold leading-tight">Manufacturing route</h3>
          <p className="text-[11px] leading-tight text-muted-foreground">
            {isLoading
              ? 'Pricing every route for this part…'
              : `${String(nodes.length)} ${nodes.length === 1 ? 'option' : 'options'} priced for this part`}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1" role="group" aria-label="Sort routes by">
          {ROUTE_SORT_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => { onSortModeChange(m.id); }}
              aria-pressed={sortMode === m.id}
              className={cn(
                'min-h-6 rounded px-2 py-1 text-[11px] font-medium transition-colors',
                sortMode === m.id
                  ? 'bg-violet-500/20 text-violet-200 ring-1 ring-inset ring-violet-500/40'
                  : 'text-muted-foreground hover:bg-muted/40 hover:text-foreground',
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* Frozen column header — NN/g: keep the labels for numeric columns in
          view while the rows scroll, so a figure is never read unlabelled */}
      <div className="flex shrink-0 items-center gap-3 border-b border-border/60 bg-muted/30 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        <span className="flex-1">Route</span>
        <span className="w-[68px] shrink-0 text-right">Cost</span>
        <span className="w-[56px] shrink-0 text-right">Cycle</span>
      </div>

      <div
        ref={listRef}
        role="radiogroup"
        aria-labelledby={groupId}
        onKeyDown={handleKeyDown}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        <span id={groupId} className="sr-only">Manufacturing route</span>

        {groups.map((group) => (
          <section key={group.family}>
            <header className="sticky top-0 z-10 border-b border-border/60 bg-background/95 px-4 py-2 backdrop-blur">
              <h4 className="text-[11px] font-semibold uppercase tracking-wide text-foreground/80">{group.title}</h4>
              <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{group.description}</p>
            </header>

            <div className="divide-y divide-border/40">
              {group.nodes.map((node) => {
                const isSelected = node.id === selectedId;
                const recommendedRank = recommendedIds.indexOf(node.id);
                const barPct = costScale && node.cost !== null && costScale > 0
                  ? Math.max(2, Math.round((node.cost / costScale) * 100))
                  : null;

                return (
                  <div
                    key={node.id}
                    data-route-id={node.id}
                    role="radio"
                    aria-checked={isSelected}
                    aria-disabled={!node.selectable}
                    tabIndex={isSelected || (!selectedId && node.id === group.nodes[0]?.id) ? 0 : -1}
                    onClick={() => { if (node.selectable) onSelect(node); }}
                    onKeyDown={(e) => {
                      if ((e.key === 'Enter' || e.key === ' ') && node.selectable) {
                        e.preventDefault();
                        onSelect(node);
                      }
                    }}
                    className={cn(
                      'group relative flex items-start gap-3 px-4 py-2.5 outline-none transition-colors',
                      'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500',
                      node.selectable ? 'cursor-pointer hover:bg-muted/30' : 'cursor-default',
                      isSelected && 'bg-violet-500/10',
                      !node.feasible && 'opacity-70',
                    )}
                  >
                    {/* Selected marker as a full-height rail — reads at a glance
                        from anywhere in the row, unlike a 3px dot */}
                    <span
                      aria-hidden
                      className={cn('absolute inset-y-0 left-0 w-[3px]', isSelected ? 'bg-violet-500' : 'bg-transparent')}
                    />

                    <span
                      aria-hidden
                      className={cn(
                        'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border transition-colors',
                        isSelected ? 'border-violet-500 bg-violet-500 text-white' : 'border-muted-foreground/40',
                        !node.selectable && 'opacity-0',
                      )}
                    >
                      {isSelected && <Check className="h-2.5 w-2.5" strokeWidth={3.5} />}
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                        <span className={cn('text-[13px] leading-tight', isSelected ? 'font-semibold' : 'font-medium')}>
                          {node.label}
                        </span>
                        {recommendedRank === 0 && <Badge tone="blue">CAD-optimal</Badge>}
                        {recommendedRank > 0 && <Badge tone="blue">Recommended</Badge>}
                        {node.badges.lowestCost && <Badge tone="emerald">Lowest cost</Badge>}
                        {node.badges.fastest && <Badge tone="violet">Fastest</Badge>}
                        {node.badges.bestQuality && <Badge tone="amber">Best quality</Badge>}
                        {!node.feasible && <Badge tone="red">Not capable</Badge>}
                      </div>

                      {node.machineName && (
                        <p className="mt-0.5 truncate text-[11px] leading-tight text-muted-foreground" title={node.machineName}>
                          {node.machineName}
                        </p>
                      )}

                      {/* Relative cost bar — pure scannability aid over the same
                          real totals already printed in the Cost column */}
                      {barPct !== null && (
                        <div aria-hidden className="mt-1.5 h-[3px] w-full overflow-hidden rounded-full bg-muted/50">
                          <div
                            className={cn('h-full rounded-full', isSelected ? 'bg-violet-500' : 'bg-muted-foreground/40')}
                            style={{ width: `${String(barPct)}%` }}
                          />
                        </div>
                      )}

                      {!node.feasible && node.infeasibleReason && (
                        <p className="mt-1.5 flex items-start gap-1 text-[11px] leading-snug text-red-300/90">
                          <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
                          <span>{node.infeasibleReason}</span>
                        </p>
                      )}
                      {/* Why a visible, priced route cannot be picked here.
                          Shown inline rather than in a `title` tooltip: the
                          constraint has to be readable before the click, and
                          a tooltip is invisible to touch and to anyone who
                          never hovers a row they assumed was disabled-looking. */}
                      {!node.selectable && node.selectionNote && (
                        <p className="mt-1.5 flex items-start gap-1 text-[11px] leading-snug text-muted-foreground">
                          <Info className="mt-px h-3 w-3 shrink-0" />
                          <span>{node.selectionNote}</span>
                        </p>
                      )}
                      {node.toolingVolumeNote && (
                        <p className={cn(
                          'mt-1 text-[11px] leading-snug',
                          node.toolingVolumeNote.startsWith('Economical') ? 'text-emerald-300/90' : 'text-amber-300/90',
                        )}>
                          {node.toolingVolumeNote}
                        </p>
                      )}
                    </div>

                    <div className="w-[68px] shrink-0 pt-0.5 text-right text-[13px] font-medium tabular-nums">
                      {fmtMoney(node.cost, currencySymbol)}
                    </div>
                    <div className="w-[56px] shrink-0 pt-1 text-right text-[11px] tabular-nums text-muted-foreground">
                      {fmtMinutes(node.cycleTimeMin)}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}

        {nodes.length === 0 && (
          isLoading ? (
            // Skeleton rows in the real row shape, so the wait reads as
            // "results are coming" rather than "there is nothing here".
            <div className="space-y-px p-4" aria-live="polite" aria-busy="true">
              <span className="sr-only">Pricing routes…</span>
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="flex items-center gap-3 py-2.5">
                  <span className="h-4 w-4 shrink-0 animate-pulse rounded-full bg-muted" />
                  <span className="h-3 flex-1 animate-pulse rounded bg-muted" style={{ opacity: 1 - i * 0.15 }} />
                  <span className="h-3 w-[52px] shrink-0 animate-pulse rounded bg-muted" style={{ opacity: 1 - i * 0.15 }} />
                </div>
              ))}
            </div>
          ) : errorMessage ? (
            <p className="px-4 py-8 text-center text-xs leading-relaxed text-red-300">
              Routes could not be priced for this part.
              <span className="mt-1 block text-muted-foreground">{errorMessage}</span>
            </p>
          ) : (
            <p className="px-4 py-8 text-center text-xs text-muted-foreground">
              No routes have been priced for this part yet.
            </p>
          )
        )}
      </div>
    </div>
  );
}
