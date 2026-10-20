'use client';

import { FlipHorizontal2, Loader2, Maximize, Ruler, ZoomIn, ZoomOut } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api/client';
import { distanceMm, toScene } from '@/lib/electronics/viewer-model';

import { MARKER_PX, ZOOM_STEP, type ViewerState } from './useViewerState';

/** The board drawn on its measured frame: layers, parts, the ruler, and the toolbar. Read only. */
export function ViewerCanvas({ v }: { v: ViewerState }) {
  const { data, bounds, view } = v;
  if (v.isLoading) return <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground" role="status"><Loader2 className="h-4 w-4 animate-spin" />Drawing the board…</div>;
  if (v.error || !data || !bounds) {
    // Say why: the engine being unreachable (503) is not the same as files it cannot draw (422).
    const reason = v.error instanceof ApiError ? v.error.message : 'The preview did not load.';
    return (
      <div className="space-y-1 p-4 text-sm" role="alert" data-testid="viewer-error">
        <p className="font-medium text-destructive">The board could not be drawn.</p>
        <p className="text-muted-foreground">{reason}</p>
        {v.error instanceof ApiError && v.error.status === 503 && <p className="text-muted-foreground">The extraction service is not reachable. Try again once it is running.</p>}
      </div>
    );
  }

  const markerR = MARKER_PX * v.mmPerPx;
  const rulerLength = v.ruler.length === 2 && v.ruler[0] && v.ruler[1] ? distanceMm(v.ruler[0], v.ruler[1]) : null;

  return (
    <div className="flex h-full flex-col" data-testid="board-viewer">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => { v.zoomBy(ZOOM_STEP); }} aria-label="Zoom in"><ZoomIn className="h-4 w-4" /></Button>
        <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => { v.zoomBy(1 / ZOOM_STEP); }} aria-label="Zoom out"><ZoomOut className="h-4 w-4" /></Button>
        <Button variant="outline" size="icon" className="h-7 w-7" onClick={v.fit} aria-label="Fit board"><Maximize className="h-4 w-4" /></Button>
        <Button variant="outline" size="sm" className="h-7" onClick={v.flip} aria-label="Flip board"><FlipHorizontal2 className="mr-1 h-4 w-4" />{v.side === 'top' ? 'Top' : 'Bottom'} view</Button>
        <Button variant={v.measuring ? 'default' : 'outline'} size="sm" className="h-7" onClick={v.toggleMeasure} aria-pressed={v.measuring}>
          <Ruler className="mr-1 h-4 w-4" />Measure
        </Button>
        {rulerLength !== null && <span className="text-sm font-medium" data-testid="ruler-length">{rulerLength.toFixed(2)} mm</span>}
        {v.measuring && rulerLength === null && <span className="text-xs text-muted-foreground">{v.ruler.length === 0 ? 'Click the first point' : 'Click the second point'}</span>}
        <span className="ml-auto font-mono text-xs text-muted-foreground" data-testid="cursor-readout">
          {v.cursor ? `X ${v.cursor.xMm.toFixed(2)}  Y ${v.cursor.yMm.toFixed(2)} mm` : `${bounds.widthMm} × ${bounds.heightMm} mm`}
        </span>
      </div>

      <div ref={v.box} className="relative min-h-0 flex-1 overflow-hidden bg-neutral-900">
        {view && (
          <svg
            ref={v.svgRef}
            data-testid="viewer-canvas"
            className={`h-full w-full ${v.measuring ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'}`}
            style={{ touchAction: 'none' }}
            viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
            onPointerDown={v.onPointerDown}
            onPointerMove={v.onPointerMove}
            onPointerUp={v.onPointerUp}
            onPointerCancel={v.onPointerUp}
            onPointerLeave={v.onPointerLeave}
          >
            <g ref={v.sceneRef} transform={v.side === 'bottom' ? `translate(${bounds.widthMm} 0) scale(-1 1)` : undefined}>
              {v.layers.map((l) =>
                v.visible(l.role, l.name) ? (
                  <image key={l.name} data-testid={`layer-${l.role}`} href={l.src} x={0} y={0} width={bounds.widthMm} height={bounds.heightMm} preserveAspectRatio="none" opacity={v.opacities[l.name] ?? l.opacity} />
                ) : null,
              )}
              {v.onSide.map((c) => {
                const p = toScene(bounds, c);
                const isSelected = c.designator === v.selected;
                return (
                  <circle
                    key={c.designator}
                    data-testid={`marker-${c.designator}`}
                    cx={p.x}
                    cy={p.y}
                    r={isSelected ? markerR * 1.8 : markerR}
                    fill={isSelected ? '#facc15' : 'none'}
                    stroke={isSelected ? '#facc15' : '#22d3ee'}
                    strokeWidth={markerR * 0.35}
                    opacity={isSelected ? 1 : 0.8}
                    pointerEvents="none"
                  />
                );
              })}
              {v.ruler.map((r, i) => {
                const p = toScene(bounds, r);
                return <circle key={i} cx={p.x} cy={p.y} r={markerR} fill="#f97316" pointerEvents="none" />;
              })}
              {v.ruler.length === 2 && v.ruler[0] && v.ruler[1] && (
                <line
                  x1={toScene(bounds, v.ruler[0]).x}
                  y1={toScene(bounds, v.ruler[0]).y}
                  x2={toScene(bounds, v.ruler[1]).x}
                  y2={toScene(bounds, v.ruler[1]).y}
                  stroke="#f97316"
                  strokeWidth={markerR * 0.5}
                  pointerEvents="none"
                />
              )}
            </g>
          </svg>
        )}
      </div>
    </div>
  );
}
