/**
 * Pure geometry and search for the board viewer. Everything here works in millimetres on the frame the engine measured
 * (the board outline); the viewer draws in a "scene" whose origin is the frame's top-left corner with y pointing down, so
 * the layer pictures (drawn by the engine the same way) line up with no further transform.
 */

import type { BoardPreview, SceneComponent } from '@/lib/api/electronics';

export type Bounds = BoardPreview['bounds'];
export interface Point {
  x: number;
  y: number;
}
export interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface MmPoint {
  xMm: number;
  yMm: number;
}

/** A board coordinate (mm, y up) as a scene point (mm from the frame's top-left, y down). */
export function toScene(bounds: Bounds, p: MmPoint): Point {
  return { x: p.xMm - bounds.minXMm, y: bounds.minYMm + bounds.heightMm - p.yMm };
}

/** The inverse of toScene: where a scene point is on the board. */
export function fromScene(bounds: Bounds, p: Point): MmPoint {
  return { xMm: p.x + bounds.minXMm, yMm: bounds.minYMm + bounds.heightMm - p.y };
}

/** The whole frame inside a container of the given width/height ratio, with a margin so the outline is not clipped. */
export function fitView(bounds: Bounds, aspect: number, margin = 0.04): ViewBox {
  const padW = bounds.widthMm * (1 + 2 * margin);
  const padH = bounds.heightMm * (1 + 2 * margin);
  const w = Math.max(padW, padH * aspect);
  const h = w / aspect;
  return { x: bounds.widthMm / 2 - w / 2, y: bounds.heightMm / 2 - h / 2, w, h };
}

// The closest the viewer zooms: a view this many millimetres wide (a 0402 part is 1 mm long).
export const MIN_VIEW_WIDTH_MM = 2;
// The furthest it zooms out, relative to the fitted view.
export const MAX_ZOOM_OUT = 1.5;

/** Zoom about a scene point (the one under the cursor stays where it is). factor < 1 zooms in. */
export function zoomAt(view: ViewBox, about: Point, factor: number, fitted: ViewBox): ViewBox {
  const w = Math.min(Math.max(view.w * factor, MIN_VIEW_WIDTH_MM), fitted.w * MAX_ZOOM_OUT);
  const f = w / view.w;
  const h = view.h * f;
  return { x: about.x - (about.x - view.x) * f, y: about.y - (about.y - view.y) * f, w, h };
}

export function panBy(view: ViewBox, dx: number, dy: number): ViewBox {
  return { ...view, x: view.x - dx, y: view.y - dy };
}

/** A view centred on a scene point, `widthMm` wide, in a container of the given aspect. */
export function centerOn(point: Point, widthMm: number, aspect: number): ViewBox {
  const h = widthMm / aspect;
  return { x: point.x - widthMm / 2, y: point.y - h / 2, w: widthMm, h };
}

export function distanceMm(a: MmPoint, b: MmPoint): number {
  return Math.hypot(a.xMm - b.xMm, a.yMm - b.yMm);
}

/**
 * Parts matching a query: every word of the query must appear (case-insensitive, plain substring) in the designator,
 * value or footprint. An empty query matches everything. No pattern syntax is interpreted.
 */
export function searchComponents(components: SceneComponent[], query: string): SceneComponent[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return components;
  return components.filter((c) => {
    const haystack = `${c.designator} ${c.comment} ${c.footprint}`.toLowerCase();
    return words.every((w) => haystack.includes(w));
  });
}

/** The part nearest to a board point within `radiusMm`, among those given (the visible side's). */
export function nearestComponent(components: SceneComponent[], at: MmPoint, radiusMm: number): SceneComponent | null {
  let best: SceneComponent | null = null;
  let bestDistance = radiusMm;
  for (const c of components) {
    const d = distanceMm(c, at);
    if (d <= bestDistance) {
      best = c;
      bestDistance = d;
    }
  }
  return best;
}

/** Footprints and counts on one side, most frequent first: what the inspector summarises. */
export function footprintCounts(components: SceneComponent[]): { footprint: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const c of components) counts.set(c.footprint, (counts.get(c.footprint) ?? 0) + 1);
  return [...counts].map(([footprint, count]) => ({ footprint, count })).sort((a, b) => b.count - a.count || a.footprint.localeCompare(b.footprint));
}

export type Side = 'top' | 'bottom';

export interface ViewerUrlState {
  component: string | null;
  side: Side;
}

/** What a review link carries: the selected part and the side being viewed. Anything else in the URL is ignored. */
export function parseViewerUrl(params: Pick<URLSearchParams, 'get'>): ViewerUrlState {
  const component = params.get('c');
  return { component: component === null || component === '' ? null : component, side: params.get('side') === 'bottom' ? 'bottom' : 'top' };
}

export function serializeViewerUrl(state: ViewerUrlState, existing: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(existing);
  if (state.component) next.set('c', state.component);
  else next.delete('c');
  if (state.side === 'bottom') next.set('side', 'bottom');
  else next.delete('side');
  return next;
}

/** The side a layer belongs to, from its role name (copper_top, paste_bottom, ...); null for a layer of both (outline, drill). */
export function layerSide(role: string): Side | null {
  if (role.endsWith('_top')) return 'top';
  if (role.endsWith('_bottom')) return 'bottom';
  return null;
}

/** A layer is shown by default when it belongs to the side being viewed or to both. A person's choice overrides this. */
export function defaultLayerVisible(role: string, side: Side): boolean {
  const own = layerSide(role);
  return own === null || own === side;
}
