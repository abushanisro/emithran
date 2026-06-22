'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, ZoomIn, ZoomOut, Maximize2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface DXFViewerComponentProps {
  fileUrl: string;
  fileName: string;
}

export function DXFViewerComponent({ fileUrl, fileName }: DXFViewerComponentProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let destroyed = false;

    async function init() {
      if (!containerRef.current) return;
      setLoading(true);
      setError(null);

      try {
        const { DxfViewer } = await import('dxf-viewer');

        if (destroyed || !containerRef.current) return;

        const viewer = new DxfViewer(containerRef.current, {
          autoResize: true,
          colorCorrection: true,
          blackWhiteInversion: true,
          pointSize: 2,
          sceneOptions: {
            wireframeMesh: false,
          },
        });

        viewerRef.current = viewer;

        await viewer.Load({
          url: fileUrl,
          fonts: null,
        });

        if (!destroyed) setLoading(false);
      } catch (e: any) {
        if (!destroyed) {
          console.error('DXF viewer error:', e);
          setError(e?.message ?? 'Failed to load DXF file');
          setLoading(false);
        }
      }
    }

    init();

    return () => {
      destroyed = true;
      if (viewerRef.current) {
        try { viewerRef.current.Destroy?.(); } catch {}
        viewerRef.current = null;
      }
    };
  }, [fileUrl]);

  const handleFit = () => {
    try { viewerRef.current?.FitView?.(); } catch {}
  };

  const handleZoomIn = () => {
    try {
      const v = viewerRef.current;
      if (v?.camera) {
        v.camera.zoom *= 1.3;
        v.camera.updateProjectionMatrix?.();
        v.Render?.();
      }
    } catch {}
  };

  const handleZoomOut = () => {
    try {
      const v = viewerRef.current;
      if (v?.camera) {
        v.camera.zoom /= 1.3;
        v.camera.updateProjectionMatrix?.();
        v.Render?.();
      }
    } catch {}
  };

  return (
    <div className="h-full flex flex-col bg-[#1e1e1e]">
      {/* Toolbar */}
      <div className="flex-shrink-0 flex items-center gap-2 px-3 py-1.5 bg-[#2d2d2d] border-b border-[#444]">
        <span className="text-xs text-gray-300 font-mono truncate max-w-[300px]">{fileName}</span>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={handleFit} className="text-white hover:bg-[#505050] gap-1.5 text-xs" title="Fit to view">
            <Maximize2 className="h-3.5 w-3.5" /> Fit
          </Button>
          <Button variant="ghost" size="sm" onClick={handleZoomIn} className="text-white hover:bg-[#505050]" title="Zoom in">
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={handleZoomOut} className="text-white hover:bg-[#505050]" title="Zoom out">
            <ZoomOut className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={handleFit} className="text-white hover:bg-[#505050]" title="Reset view">
            <RotateCcw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Canvas container */}
      <div className="flex-1 relative">
        <div ref={containerRef} className="absolute inset-0" />

        {loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#1e1e1e] z-10">
            <Loader2 className="h-10 w-10 animate-spin text-primary mb-3" />
            <p className="text-sm text-gray-300">Loading DXF drawing…</p>
            <p className="text-xs text-gray-500 mt-1">Large files may take a few seconds</p>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#1e1e1e] z-10 p-8 text-center">
            <p className="text-sm text-red-400 mb-1">Failed to render DXF</p>
            <p className="text-xs text-gray-500">{error}</p>
          </div>
        )}
      </div>
    </div>
  );
}
