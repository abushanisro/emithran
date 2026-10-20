'use client';

import { Search, X } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { footprintCounts } from '@/lib/electronics/viewer-model';

import type { ViewerState } from './useViewerState';

const MAX_LISTED = 200;

/** Search the parts of the board and pick one: it is selected, zoomed to, and shown in the Selected tab. */
export function ComponentsPanel({ v }: { v: ViewerState }) {
  const { data, components, matches, onSide, side, selected } = v;
  if (!data) return <p className="p-3 text-xs text-muted-foreground">The board has not been drawn yet.</p>;
  const listed = matches.slice(0, MAX_LISTED);

  return (
    <div className="space-y-2 p-3">
      {data.meta?.stale && <p className="text-xs text-amber-600" data-testid="preview-stale">Showing the drawing stored on {new Date(data.meta.renderedAt).toLocaleString()}: the extraction engine is not reachable to redraw it.</p>}
      {data.componentsError && <p className="text-xs text-amber-600" data-testid="components-error">Parts cannot be shown: {data.componentsError}</p>}
      {!data.componentsError && components.length === 0 && <p className="text-xs text-muted-foreground">This set has no Pick Place file, so there are no parts to show: a bare PCB.</p>}
      {components.length > 0 && (
        <>
          <p className="text-xs text-muted-foreground" data-testid="component-count">{components.length} components</p>
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input data-testid="component-search" className="pl-8" placeholder="Search designator, value or footprint" value={v.query} onChange={(e) => { v.setQuery(e.target.value); }} aria-label="Search components" />
          </div>
          <p className="text-xs text-muted-foreground">
            {footprintCounts(onSide).slice(0, 3).map((f) => `${f.count} × ${f.footprint}`).join(' · ')}{onSide.length === 0 ? `No parts on the ${side}` : ` on the ${side}`}
          </p>
          <ul className="divide-y rounded-md border" data-testid="component-list">
            {listed.map((c) => (
              <li key={c.designator}>
                <button
                  type="button"
                  data-testid={`component-row-${c.designator}`}
                  onClick={() => { v.choose(c); }}
                  className={`flex w-full items-center gap-2 px-2 py-1 text-left text-xs hover:bg-secondary ${c.designator === selected ? 'bg-secondary' : ''}`}
                >
                  <span className="w-16 shrink-0 font-medium">{c.designator}</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{c.comment || c.footprint}</span>
                  <span className="shrink-0 text-muted-foreground">{c.side}</span>
                </button>
              </li>
            ))}
            {matches.length === 0 && <li className="px-2 py-3 text-xs text-muted-foreground">No part matches “{v.query}”.</li>}
          </ul>
          {matches.length > listed.length && <p className="text-xs text-muted-foreground">Showing {listed.length} of {matches.length}. Refine the search to see the rest.</p>}
        </>
      )}
    </div>
  );
}

/** Which layers are drawn and how strongly. */
export function LayersPanel({ v }: { v: ViewerState }) {
  if (v.layers.length === 0) return <p className="p-3 text-xs text-muted-foreground">No layers drawn yet.</p>;
  return (
    <div className="space-y-2 p-3">
      {[...v.layers].reverse().map((l) => (
        <div key={l.name} className="space-y-1">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" data-testid={`layer-toggle-${l.role}`} checked={v.visible(l.role, l.name)} onChange={() => { v.toggleLayer(l.role, l.name); }} aria-label={`Show ${l.label}`} />
            <span className="inline-block h-3 w-3 rounded-sm border" style={{ backgroundColor: l.color, opacity: l.opacity }} />
            <span className="capitalize">{l.label}</span>
          </label>
          {v.visible(l.role, l.name) && (
            <input
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={v.opacities[l.name] ?? l.opacity}
              onChange={(e) => { v.setOpacity(l.name, Number(e.target.value)); }}
              className="ml-6 w-40"
              aria-label={`${l.label} opacity`}
            />
          )}
        </div>
      ))}
    </div>
  );
}

/** The part picked on the board, exactly as the Pick Place file states it. */
export function SelectedPanel({ v }: { v: ViewerState }) {
  const part = v.selectedPart;
  if (!part) return <p className="p-3 text-xs text-muted-foreground">Click a part on the board, or choose one in Components.</p>;
  return (
    <div className="p-3 text-xs" data-testid="inspector">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-sm font-semibold">{part.designator}</span>
        <button type="button" onClick={v.clear} aria-label="Clear selection" className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
      </div>
      <dl className="grid grid-cols-[6rem_1fr] gap-y-0.5">
        <dt className="text-muted-foreground">Value</dt><dd className="font-medium">{part.comment || '—'}</dd>
        <dt className="text-muted-foreground">Footprint</dt><dd className="font-medium">{part.footprint}</dd>
        <dt className="text-muted-foreground">Side</dt><dd className="font-medium">{part.side}</dd>
        <dt className="text-muted-foreground">Position</dt><dd className="font-medium">{part.xMm}, {part.yMm} mm</dd>
        <dt className="text-muted-foreground">Rotation</dt><dd className="font-medium">{part.rotationDeg}°</dd>
      </dl>
    </div>
  );
}
