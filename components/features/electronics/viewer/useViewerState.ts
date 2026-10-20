'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { SceneComponent } from '@/lib/api/electronics';
import { useBoardPreview } from '@/lib/api/hooks/useElectronics';
import { stackLayers } from '@/lib/electronics/preview-view';
import {
  centerOn,
  defaultLayerVisible,
  fitView,
  fromScene,
  nearestComponent,
  panBy,
  parseViewerUrl,
  searchComponents,
  serializeViewerUrl,
  toScene,
  zoomAt,
  type MmPoint,
  type Point,
  type Side,
  type ViewBox,
} from '@/lib/electronics/viewer-model';

// Marker and hit sizes are screen sizes (a part stays clickable at any zoom), not board dimensions.
export const MARKER_PX = 4;
const HIT_PX = 8;
const CLICK_SLOP_PX = 4;
export const ZOOM_STEP = 0.7;
const ZOOM_TO_WIDTH_MM = 12;

/**
 * All the state of the board viewer, in one place so the canvas and the panels that sit in other panes (components, layers,
 * the selected part) share it. Read only: nothing here changes the design. The selected part and the side viewed live in the URL
 * so a review can be shared by link.
 */
export function useViewerState(uploadId: string) {
  const preview = useBoardPreview(uploadId, true);
  const data = preview.data;
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const urlState = parseViewerUrl(search);

  const layers = useMemo(() => (data ? stackLayers(data) : []), [data]);
  const [side, setSide] = useState<Side>(urlState.side);
  const [selected, setSelected] = useState<string | null>(urlState.component);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [opacities, setOpacities] = useState<Record<string, number>>({});
  const [query, setQuery] = useState('');
  const [measuring, setMeasuring] = useState(false);
  const [ruler, setRuler] = useState<MmPoint[]>([]);
  const [cursor, setCursor] = useState<MmPoint | null>(null);

  const box = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const sceneRef = useRef<SVGGElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<ViewBox | null>(null);
  const pointers = useRef(new Map<number, Point>());
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const pinch = useRef<number | null>(null);

  const aspect = size.w > 0 && size.h > 0 ? size.w / size.h : 0;
  const bounds = data?.bounds;
  const fitted = useMemo(() => (bounds && aspect ? fitView(bounds, aspect) : null), [bounds, aspect]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    observer.observe(el);
    return () => { observer.disconnect(); };
  }, [data]);

  // First fit once the frame and the container are known; later size changes keep the person's view.
  const fittedOnce = useRef(false);
  useEffect(() => {
    if (fitted && !fittedOnce.current) {
      fittedOnce.current = true;
      setView(fitted);
    }
  }, [fitted]);

  const components = useMemo(() => data?.components ?? [], [data]);
  const onSide = useMemo(() => components.filter((c) => c.side === side), [components, side]);
  const matches = useMemo(() => searchComponents(components, query), [components, query]);
  const selectedPart = useMemo(() => components.find((c) => c.designator === selected) ?? null, [components, selected]);
  const mmPerPx = view && size.w ? view.w / size.w : 0;

  const syncUrl = useCallback(
    (next: { component: string | null; side: Side }) => {
      const params = serializeViewerUrl(next, new URLSearchParams(search.toString()));
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, search],
  );

  // ---- coordinates ---------------------------------------------------------------------------------------------------
  const rootPoint = (clientX: number, clientY: number): Point | null => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    const p = svg.createSVGPoint();
    p.x = clientX;
    p.y = clientY;
    const q = p.matrixTransform(ctm.inverse());
    return { x: q.x, y: q.y };
  };
  const boardPoint = (clientX: number, clientY: number): MmPoint | null => {
    const g = sceneRef.current;
    const svg = svgRef.current;
    const ctm = g?.getScreenCTM();
    if (!g || !svg || !ctm || !bounds) return null;
    const p = svg.createSVGPoint();
    p.x = clientX;
    p.y = clientY;
    const q = p.matrixTransform(ctm.inverse());
    return fromScene(bounds, { x: q.x, y: q.y });
  };

  // ---- view control --------------------------------------------------------------------------------------------------
  const zoomBy = (factor: number, about?: Point) => {
    if (!view || !fitted) return;
    setView(zoomAt(view, about ?? { x: view.x + view.w / 2, y: view.y + view.h / 2 }, factor, fitted));
  };
  const fit = () => {
    if (fitted) setView(fitted);
  };

  const hasView = view !== null;
  // The wheel needs a non-passive listener to stop the page scrolling while zooming.
  const latest = useRef({ view, fitted });
  latest.current = { view, fitted };
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (event: WheelEvent) => {
      const { view: v, fitted: f } = latest.current;
      if (!v || !f) return;
      event.preventDefault();
      const ctm = svg.getScreenCTM();
      if (!ctm) return;
      const p = svg.createSVGPoint();
      p.x = event.clientX;
      p.y = event.clientY;
      const q = p.matrixTransform(ctm.inverse());
      setView(zoomAt(v, { x: q.x, y: q.y }, Math.exp(event.deltaY * 0.0015), f));
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => { svg.removeEventListener('wheel', onWheel); };
  }, [data, hasView]);

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) drag.current = { x: e.clientX, y: e.clientY, moved: false };
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = a && b ? Math.hypot(a.x - b.x, a.y - b.y) : null;
      drag.current = null;
    }
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const previous = pointers.current.get(e.pointerId);
    setCursor(boardPoint(e.clientX, e.clientY));
    if (!previous || !view) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && pinch.current && fitted) {
      const [a, b] = [...pointers.current.values()];
      if (!a || !b) return;
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = rootPoint((a.x + b.x) / 2, (a.y + b.y) / 2);
      if (mid && distance > 0) setView(zoomAt(view, mid, pinch.current / distance, fitted));
      pinch.current = distance;
      return;
    }
    const d = drag.current;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) > CLICK_SLOP_PX) d.moved = true;
    if (d.moved) setView(panBy(view, (e.clientX - previous.x) * mmPerPx, (e.clientY - previous.y) * mmPerPx));
  };

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (!d || d.moved) {
      drag.current = null;
      return;
    }
    drag.current = null;
    const at = boardPoint(e.clientX, e.clientY);
    if (!at) return;
    if (measuring) {
      setRuler((current) => (current.length >= 2 ? [at] : [...current, at]));
      return;
    }
    const hit = nearestComponent(onSide, at, HIT_PX * mmPerPx);
    const next = hit?.designator ?? null;
    setSelected(next);
    syncUrl({ component: next, side });
  };

  // ---- actions -------------------------------------------------------------------------------------------------------
  const flip = () => {
    const next: Side = side === 'top' ? 'bottom' : 'top';
    setSide(next);
    setOverrides({});
    setSelected(null);
    syncUrl({ component: null, side: next });
  };

  const choose = (part: SceneComponent) => {
    setSelected(part.designator);
    if (part.side !== side) {
      setSide(part.side);
      setOverrides({});
    }
    if (bounds && aspect) setView(centerOn(toScene(bounds, part), ZOOM_TO_WIDTH_MM, aspect));
    syncUrl({ component: part.designator, side: part.side });
  };

  const clear = () => {
    setSelected(null);
    syncUrl({ component: null, side });
  };

  const toggleMeasure = () => {
    setMeasuring((m) => !m);
    setRuler([]);
  };

  const visible = (role: string, name: string) => overrides[name] ?? defaultLayerVisible(role, side);
  const toggleLayer = (role: string, name: string) => { setOverrides((c) => ({ ...c, [name]: !visible(role, name) })); };
  const setOpacity = (name: string, value: number) => { setOpacities((c) => ({ ...c, [name]: value })); };

  return {
    // data
    isLoading: preview.isLoading,
    error: preview.error,
    data,
    bounds,
    layers,
    components,
    onSide,
    matches,
    selectedPart,
    // state
    side,
    selected,
    query,
    setQuery,
    measuring,
    ruler,
    cursor,
    view,
    mmPerPx,
    opacities,
    // refs and pointer handlers for the canvas
    box,
    svgRef,
    sceneRef,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerLeave: () => { setCursor(null); },
    // actions
    zoomBy,
    fit,
    flip,
    choose,
    clear,
    toggleMeasure,
    visible,
    toggleLayer,
    setOpacity,
  };
}

export type ViewerState = ReturnType<typeof useViewerState>;
