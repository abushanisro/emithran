'use client';

import { useState, useRef, useCallback, useMemo } from 'react';

export interface ViewBox { x: number; y: number; w: number; h: number }

// Raw SVG viewBox pan/zoom -- no charting/canvas dependency exists in this
// repo for 2D drawing (dxf-viewer-component.tsx's zoom is internal to the
// `dxf-viewer` npm package's own camera, not reusable for plain SVG), so
// this mirrors that same "zoom in place, drag to pan" behavior directly via
// viewBox math. Shared by nest-view.tsx and flat-pattern-view.tsx -- both
// render a single plain-SVG 2D drawing sized in real mm.
export function useSvgPanZoom(contentWidthMm: number | undefined, contentLengthMm: number | undefined) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [viewBox, setViewBox] = useState<ViewBox | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; vb: ViewBox } | null>(null);

  const fittedViewBox = useMemo<ViewBox | null>(() => {
    if (!contentWidthMm || !contentLengthMm) return null;
    const pad = Math.max(contentWidthMm, contentLengthMm) * 0.05;
    return { x: -pad, y: -pad, w: contentWidthMm + pad * 2, h: contentLengthMm + pad * 2 };
  }, [contentWidthMm, contentLengthMm]);

  const effectiveViewBox = viewBox ?? fittedViewBox;

  const handleWheel = useCallback((e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    if (!effectiveViewBox || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    const scale = e.deltaY > 0 ? 1.15 : 1 / 1.15;
    const newW = effectiveViewBox.w * scale;
    const newH = effectiveViewBox.h * scale;
    setViewBox({
      x: effectiveViewBox.x + (effectiveViewBox.w - newW) * px,
      y: effectiveViewBox.y + (effectiveViewBox.h - newH) * py,
      w: newW,
      h: newH,
    });
  }, [effectiveViewBox]);

  const handleMouseDown = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!effectiveViewBox) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, vb: effectiveViewBox };
  }, [effectiveViewBox]);

  const handleMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (!dragRef.current || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const { startX, startY, vb } = dragRef.current;
    const dx = ((e.clientX - startX) / rect.width) * vb.w;
    const dy = ((e.clientY - startY) / rect.height) * vb.h;
    setViewBox({ x: vb.x - dx, y: vb.y - dy, w: vb.w, h: vb.h });
  }, []);

  const handleMouseUp = useCallback(() => { dragRef.current = null; }, []);

  return { svgRef, effectiveViewBox, handleWheel, handleMouseDown, handleMouseMove, handleMouseUp };
}
