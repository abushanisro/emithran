'use client';

import dynamic from 'next/dynamic';
import { Suspense, useState, Component, ReactNode } from 'react';
import { Loader2, Download, RotateCcw, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { apiClient } from '@/lib/api/client';

/**
 * Production-Ready 3D Model Viewer
 *
 * Industry Standards 2025-2026:
 * - Dynamic imports for code splitting
 * - Error boundaries for graceful failures
 * - Progressive enhancement
 * - Accessibility support
 * - Performance optimized
 */

// Error Boundary for WebGL context issues
class ErrorBoundary extends Component<
  { children: ReactNode; onError: (error: string) => void },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode; onError: (error: string) => void }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error('WebGL Error:', error);
    const message = error.message.includes('WebGL') 
      ? 'WebGL context lost. Your graphics card may be experiencing issues.'
      : `3D rendering error: ${error.message}`;
    this.props.onError(message);
  }

  render() {
    if (this.state.hasError) {
      return null; // Let parent handle error display
    }
    return this.props.children;
  }
}

// Professional eDrawings-Style CAD Viewer
const EDrawingsViewer = dynamic(
  () => import('./edrawings-viewer').then((mod) => mod.EDrawingsViewer),
  {
    ssr: false,
    loading: () => (
      <div className="absolute inset-0 flex items-center justify-center bg-[#2d2d2d]">
        <div className="text-center text-white">
          <Loader2 className="h-12 w-12 mx-auto mb-3 animate-spin" />
          <p className="text-sm font-medium">Initializing 3D viewer...</p>
          <p className="text-xs text-gray-300 mt-1">Loading WebGL engine</p>
        </div>
      </div>
    ),
  }
);

// Manufacturing Feature Interface
interface ManufacturingFeature {
  id: string;
  type: 'hole' | 'pocket' | 'slot' | 'boss' | 'rib' | 'thin_wall' | 'overhang' | 'undercut';
  position: { x: number; y: number; z: number };
  dimensions: { length?: number; width?: number; diameter?: number; depth?: number };
  manufacturingProcess: string;
  cycleTime: number;
  tooling: string[];
  warnings: string[];
  aiRecommendations: string[];
}

interface ModelViewerProps {
  fileUrl: string;
  fileName: string;
  fileType: string;
  bomItemId?: string; // For triggering conversion
  isExploded?: boolean; // For exploded view
  explodeDistance?: number; // Distance multiplier for explosion (0-100)
  onMeasurements?: (data: {
    volume: number;
    dimensions: { x: number; y: number; z: number };
    surfaceArea: number;
  }) => void;
  manufacturingFeatures?: ManufacturingFeature[];
  selectedFeature?: ManufacturingFeature | null;
  onFeatureSelect?: (feature: ManufacturingFeature | null) => void;
  showFeatures?: boolean;
  // BOM Integration Props
  selectedBOMItems?: any[]; // Selected BOM items for highlighting (multiple selection)
  showOnlySelected?: boolean; // Show only the selected parts
  hoveredBOMItem?: any; // Hovered BOM item for highlighting
  onPartsDetected?: (parts: any[]) => void; // Callback when parts are detected from CAD analysis
  dfmAnalysisData?: any; // DFM analysis data for showing recommendations in Properties panel
}

export function ModelViewer({ 
  fileUrl, 
  fileName, 
  fileType, 
  bomItemId, 
  isExploded = false,
  explodeDistance = 50,
  onMeasurements,
  manufacturingFeatures,
  selectedFeature,
  onFeatureSelect,
  showFeatures,
  selectedBOMItems,
  showOnlySelected = false,
  hoveredBOMItem,
  onPartsDetected,
  dfmAnalysisData
}: ModelViewerProps) {
  const [error, setError] = useState<string | null>(null);
  const [isConverting, setIsConverting] = useState(false);
  const [viewerKey, setViewerKey] = useState(0);

  const fileExt = fileType.toLowerCase().replace(/^\.+/, '');

  // Check actual file URL extension (backend may have converted STEP to STL)
  // Remove query string first, then extract extension
  const urlPath = fileUrl.split('?')[0] || fileUrl;
  const actualFileExt = urlPath.toLowerCase().split('.').pop() || fileExt;

  // Check if format is supported for interactive viewing
  const isSTL = fileExt === 'stl' || actualFileExt === 'stl';
  const isOBJ = fileExt === 'obj' || actualFileExt === 'obj';
  const isInteractiveSupported = ['stl', 'obj'].includes(actualFileExt) || ['stl', 'obj'].includes(fileExt);
  const isOriginalSTEP = ['step', 'stp', 'iges', 'igs'].includes(fileExt);
  const isConvertedToSTL = isOriginalSTEP && actualFileExt === 'stl';
  // More robust STL detection - check filename, fileType, and URL
  const isSTLFromFilename = fileName.toLowerCase().includes('.stl');
  const isSTLFromFileType = fileType.toLowerCase().includes('stl');
  const shouldShow3DViewer = isSTL || isOBJ || isConvertedToSTL || isSTLFromFilename || isSTLFromFileType;
  
  console.log('🔍 Model Viewer file analysis:', {
    fileName,
    fileType,
    fileExt,
    actualFileExt,
    isSTL,
    isOBJ,
    isSTLFromFilename,
    isSTLFromFileType,
    isInteractiveSupported,
    isOriginalSTEP,
    isConvertedToSTL,
    shouldShow3DViewer,
    fileUrl: fileUrl.substring(0, 100) + '...'
  });

  const handleConvertToSTL = async () => {
    if (!bomItemId) {
      toast.error('Cannot convert: BOM item ID not provided');
      return;
    }

    setIsConverting(true);
    try {
      await apiClient.post(`/bom-items/${bomItemId}/convert-step`, {}, {
        timeout: 180000 // 3 minutes timeout for STEP conversion
      });

      toast.success('STEP file converted to STL successfully! Refreshing...');

      // Refresh the page to show the converted model
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    } catch (error) {
      console.error('Conversion error:', error);
      let message = 'Failed to convert STEP file.';
      if (error instanceof Error) {
        if (error.message.includes('CAD Engine not available') || error.message.includes('localhost:5000')) {
          message = 'CAD Engine is offline. Start the Python CAD service (cad-engine/) to enable STEP conversion.';
        } else if (error.message.includes('unexpected error') || error.message.includes('unexpected')) {
          message = 'CAD Engine is offline or returned an error. Make sure the cad-engine service is running on port 5000.';
        } else {
          message = error.message;
        }
      }
      toast.error(message, { duration: 6000 });
    } finally {
      setIsConverting(false);
    }
  };

  const handleRetry = () => {
    setError(null);
    setViewerKey(prev => prev + 1);
  };

  // Priority check: Always show 3D viewer for STL/OBJ files regardless of other conditions
  if (shouldShow3DViewer) {
    console.log('✅ Showing 3D viewer for file:', fileName);
    return (
      <div className="h-[85vh] min-h-[700px] overflow-hidden">
        <Suspense fallback={
          <div className="absolute inset-0 flex items-center justify-center bg-[#4a4a4a]">
            <div className="text-center text-white">
              <Loader2 className="h-12 w-12 mx-auto mb-3 animate-spin" />
              <p className="text-sm font-medium">Loading 3D model...</p>
            </div>
          </div>
        }>
          <ErrorBoundary onError={setError}>
            <EDrawingsViewer
              key={viewerKey}
              fileUrl={fileUrl}
              fileName={fileName}
              isExploded={isExploded}
              explodeDistance={explodeDistance}
              onMeasurements={onMeasurements}
              manufacturingFeatures={manufacturingFeatures}
              selectedFeature={selectedFeature}
              onFeatureSelect={onFeatureSelect}
              showFeatures={showFeatures}
              selectedBOMItems={selectedBOMItems}
              showOnlySelected={showOnlySelected}
              hoveredBOMItem={hoveredBOMItem}
              onPartsDetected={onPartsDetected}
              dfmAnalysisData={dfmAnalysisData}
            />
          </ErrorBoundary>
        </Suspense>

        {/* Error Overlay */}
        {error && (
          <div className="absolute inset-0 bg-background/95 backdrop-blur-sm flex items-center justify-center p-6 z-50">
            <div className="text-center max-w-md">
              <div className="h-16 w-16 mx-auto mb-4 rounded-full bg-destructive/10 flex items-center justify-center">
                <span className="text-2xl">⚠️</span>
              </div>
              <h3 className="text-lg font-semibold mb-2">Failed to load 3D model</h3>
              <p className="text-sm text-muted-foreground mb-4">{error}</p>
              <div className="flex gap-2 justify-center">
                <Button variant="outline" onClick={handleRetry}>
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Retry
                </Button>
                <Button asChild>
                  <a href={fileUrl} download>
                    <Download className="h-4 w-4 mr-2" />
                    Download File
                  </a>
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // STEP File not yet converted - show placeholder  
  if (isOriginalSTEP && !isConvertedToSTL && !shouldShow3DViewer) {
    console.log('🔄 Showing STEP conversion placeholder for:', fileName);
    return (
      <div className="relative h-full min-h-[400px] border rounded-lg overflow-hidden bg-gradient-to-br from-muted/30 via-muted/10 to-background">
        <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center">
          {/* File Info */}
          <div className="mb-6 space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary/10 border border-primary/20">
              <span className="text-xs font-mono font-semibold text-primary uppercase">{fileExt}</span>
              <span className="text-xs text-muted-foreground">CAD File</span>
            </div>
            <h3 className="text-lg font-semibold text-foreground max-w-md truncate">
              {fileName}
            </h3>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3">
            {bomItemId && (
              <Button
                size="lg"
                className="gap-2 shadow-lg shadow-primary/20"
                onClick={handleConvertToSTL}
                disabled={isConverting}
              >
                {isConverting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Converting...
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4" />
                    Convert to 3D
                  </>
                )}
              </Button>
            )}
            <Button
              size="lg"
              variant="outline"
              className="gap-2"
              asChild
            >
              <a href={fileUrl} download>
                <Download className="h-4 w-4" />
                Download {fileExt.toUpperCase()}
              </a>
            </Button>
          </div>

          <p className="text-xs text-muted-foreground mt-4">
            {bomItemId
              ? 'Click "Convert to 3D" to view this model in your browser'
              : 'Download to view in professional CAD software'}
          </p>
        </div>
      </div>
    );
  }

  // Interactive 3D Viewer (STL/OBJ)
  if (isInteractiveSupported) {
    return (
      <div className="h-[85vh] min-h-[700px] overflow-hidden">
        <Suspense fallback={
          <div className="absolute inset-0 flex items-center justify-center bg-[#4a4a4a]">
            <div className="text-center text-white">
              <Loader2 className="h-12 w-12 mx-auto mb-3 animate-spin" />
              <p className="text-sm font-medium">Loading 3D model...</p>
            </div>
          </div>
        }>
          <ErrorBoundary onError={setError}>
            <EDrawingsViewer
              key={viewerKey}
              fileUrl={fileUrl}
              fileName={fileName}
              isExploded={isExploded}
              explodeDistance={explodeDistance}
              onMeasurements={onMeasurements}
              manufacturingFeatures={manufacturingFeatures}
              selectedFeature={selectedFeature}
              onFeatureSelect={onFeatureSelect}
              showFeatures={showFeatures}
              selectedBOMItems={selectedBOMItems}
              showOnlySelected={showOnlySelected}
              hoveredBOMItem={hoveredBOMItem}
              onPartsDetected={onPartsDetected}
              dfmAnalysisData={dfmAnalysisData}
            />
          </ErrorBoundary>
        </Suspense>

        {/* Error Overlay */}
        {error && (
          <div className="absolute inset-0 bg-background/95 backdrop-blur-sm flex items-center justify-center p-6 z-50">
            <div className="text-center max-w-md">
              <div className="h-16 w-16 mx-auto mb-4 rounded-full bg-destructive/10 flex items-center justify-center">
                <span className="text-2xl">⚠️</span>
              </div>
              <h3 className="text-lg font-semibold mb-2">Failed to load 3D model</h3>
              <p className="text-sm text-muted-foreground mb-4">{error}</p>
              <div className="flex gap-2 justify-center">
                <Button variant="outline" onClick={handleRetry}>
                  <RotateCcw className="h-4 w-4 mr-2" />
                  Retry
                </Button>
                <Button asChild>
                  <a href={fileUrl} download>
                    <Download className="h-4 w-4 mr-2" />
                    Download File
                  </a>
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Unsupported Format Fallback
  console.log('❌ Falling back to unsupported format for file:', fileName, 'fileType:', fileType);
  return (
    <div className="relative h-full min-h-[400px] border rounded-lg overflow-hidden bg-muted/20 flex items-center justify-center p-8">
      <div className="text-center max-w-md">
        <div className="h-16 w-16 mx-auto mb-4 rounded-full bg-muted flex items-center justify-center">
          <span className="text-2xl">📄</span>
        </div>
        <h3 className="text-lg font-semibold mb-2">Unsupported File Format</h3>
        <p className="text-sm text-muted-foreground mb-4">
          File type "{fileType}" cannot be previewed in browser
        </p>
        <Button asChild>
          <a href={fileUrl} download>
            <Download className="h-4 w-4 mr-2" />
            Download File
          </a>
        </Button>
      </div>
    </div>
  );
}
