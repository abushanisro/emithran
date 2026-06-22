'use client';

import { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

import { X, Download, FileText, Maximize2, Upload, Loader2, Box, Cpu } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { BOMItem } from '@/lib/api/hooks/useBOMItems';
import { apiClient } from '@/lib/api/client';
import { apiConfig } from '@/lib/api/config';
import { toast } from 'sonner';
import { ModelViewer } from '@/components/ui/model-viewer';
import dynamic from 'next/dynamic';
import ManufacturingIntelligenceView from './ManufacturingIntelligenceView';

const DXFViewerComponent = dynamic(
  () => import('@/components/ui/dxf-viewer-component').then((m) => m.DXFViewerComponent),
  { ssr: false, loading: () => null }
);

interface BOMItemDetailPanelProps {
  item: BOMItem | null;
  onClose: () => void;
  onUpdate?: () => void;
  preferredView?: '2d' | '3d' | 'intelligence';
  projectId?: string;
  bomId?: string;
}

export function BOMItemDetailPanel({ item, onClose, onUpdate, preferredView = '3d', projectId, bomId }: BOMItemDetailPanelProps) {
  const [file2dUrl, setFile2dUrl] = useState<string | null>(null);
  const [file3dUrl, setFile3dUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [imageView, setImageView] = useState<'fit' | 'full'>('fit');
  const [selectedFile2d, setSelectedFile2d] = useState<File | null>(null);
  const [selectedFile3d, setSelectedFile3d] = useState<File | null>(null);
  const [activeTab, setActiveTab] = useState<'3d' | '2d' | 'intelligence'>('3d');
  const [manufacturingFeatures, setManufacturingFeatures] = useState<ManufacturingFeature[]>([]);
  const [selectedFeature, setSelectedFeature] = useState<ManufacturingFeature | null>(null);
  const [showFeatures, setShowFeatures] = useState(false);
  const [selectedProcessForHighlight, setSelectedProcessForHighlight] = useState<string | null>(null);
  const file2dInputRef = useRef<HTMLInputElement>(null);
  const file3dInputRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    if (!item) {
      setFile2dUrl(prev => { if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev); return null; });
      setFile3dUrl(null);
      setSelectedFile2d(null);
      setSelectedFile3d(null);
      return;
    }
    setFile2dUrl(prev => { if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev); return null; });

    // Set default active tab
    if (preferredView === 'intelligence') {
      setActiveTab('intelligence');
    } else if (preferredView === '2d' && item.file2dPath) {
      setActiveTab('2d');
    } else if (item.file3dPath) {
      setActiveTab('3d');
    } else if (item.file2dPath) {
      setActiveTab('2d');
    } else {
      setActiveTab('intelligence');
    }

    const loadFileUrls = async () => {
      setLoading(true);
      try {
        if (item.file2dPath) {
          const lp = item.file2dPath.toLowerCase();
          const isDxf = lp.endsWith('.dxf') || lp.endsWith('.dwg') || lp.endsWith('.dxf.gz') || lp.endsWith('.dwg.gz');
          if (isDxf) {
            // Fetch decompressed DXF from backend (handles .gz transparently)
            const token = await apiClient.getAuthToken();
            const r = await fetch(`${apiConfig.endpoints.api.v1}/bom-items/${item.id}/dxf-content-legacy`, {
              headers: token ? { Authorization: `Bearer ${token}` } : {},
            });
            if (r.ok) setFile2dUrl(URL.createObjectURL(await r.blob()));
          } else {
            const response = await apiClient.get<{ url: string }>(`/bom-items/${item.id}/file-url/2d`);
            if (response) setFile2dUrl(response.url);
          }
        }

        if (item.file3dPath) {
          const response = await apiClient.get<{ url: string }>(`/bom-items/${item.id}/file-url/3d`);
          if (response) setFile3dUrl(response.url);
        }
      } catch {
        // Non-critical
      } finally {
        setLoading(false);
      }
    };

    loadFileUrls();
  }, [item, preferredView]);

  const handleFileUpload = async () => {
    if (!item || (!selectedFile2d && !selectedFile3d)) {
      toast.error('Please select at least one file to upload.');
      return;
    }

    if (selectedFile2d) {
      const ext = selectedFile2d.name.toLowerCase().substring(selectedFile2d.name.lastIndexOf('.'));
      if (!['.pdf', '.png', '.jpg', '.jpeg'].includes(ext)) {
        toast.error('Invalid drawing file type. Please select a PDF, PNG, or JPG.');
        return;
      }
      if (selectedFile2d.size > 100 * 1024 * 1024) {
        toast.error('2D drawing file is too large. Max 100 MB.');
        return;
      }
    }

    if (selectedFile3d) {
      const ext = selectedFile3d.name.toLowerCase().substring(selectedFile3d.name.lastIndexOf('.'));
      if (!['.stp', '.step', '.stl', '.obj', '.iges', '.igs'].includes(ext)) {
        toast.error('Invalid 3D file type. Please select a STEP, STL, OBJ, or IGES file.');
        return;
      }
      if (selectedFile3d.size > 100 * 1024 * 1024) {
        toast.error('3D file is too large. Max 100 MB.');
        return;
      }
    }

    setUploading(true);
    try {
      const formData = new FormData();
      if (selectedFile2d) formData.append('file2d', selectedFile2d);
      if (selectedFile3d) formData.append('file3d', selectedFile3d);

      await apiClient.uploadFiles<BOMItem>(`/bom-items/${item.id}/upload-files`, formData);

      const names = [selectedFile2d?.name, selectedFile3d?.name].filter(Boolean).join(' and ');
      toast.success(`${names} uploaded successfully.`);

      setSelectedFile2d(null);
      setSelectedFile3d(null);
      if (file2dInputRef.current) file2dInputRef.current.value = '';
      if (file3dInputRef.current) file3dInputRef.current.value = '';

      onUpdate?.();
    } catch (error: any) {
      toast.error(`File upload failed: ${error?.message ?? 'Please try again.'}`, { duration: 8000 });
    } finally {
      setUploading(false);
    }
  };

  // Process highlighting handler for BOM analysis
  const handleProcessHighlight = (process: any) => {
    const processName = process.processGroup || process.operation || 'Selected Process';
    setSelectedProcessForHighlight(processName);
    
    // Real CAD analysis features would be loaded from the backend
    // No simulation or mock features - only use real CAD analysis data
    setManufacturingFeatures([]);
    setSelectedFeature(null);
    setShowFeatures(false);
  };


  if (!item) return null;

  const lowerPath = item.file2dPath?.toLowerCase() ?? '';
  const isDxfFile = lowerPath.endsWith('.dxf') || lowerPath.endsWith('.dwg') ||
                    lowerPath.endsWith('.dxf.gz') || lowerPath.endsWith('.dwg.gz');
  const isImage2d = !isDxfFile && (lowerPath.endsWith('.png') || lowerPath.endsWith('.jpg') || lowerPath.endsWith('.jpeg'));
  const isPdf2d = !isDxfFile && lowerPath.endsWith('.pdf');

  return (
    <div className="fixed right-0 top-0 h-screen w-full md:w-[90vw] lg:w-[80vw] xl:w-[75vw] bg-background border-l shadow-2xl z-50 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 border-b bg-background px-6 py-4">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-xl font-semibold">{item.name}</h2>
              {(item.file3dPath || item.file2dPath) && (
                <Badge variant={item.file3dPath ? 'default' : 'secondary'} className="text-xs">
                  {item.file3dPath ? (
                    <><Box className="h-3 w-3 mr-1" />3D Model</>
                  ) : isDxfFile ? (
                    <><FileText className="h-3 w-3 mr-1" />DXF Drawing</>
                  ) : (
                    <><FileText className="h-3 w-3 mr-1" />2D Drawing</>
                  )}
                </Badge>
              )}
            </div>
            {item.partNumber && (
              <p className="text-sm text-muted-foreground">Part #: {item.partNumber}</p>
            )}
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </div>

        {/* Tab Navigation */}
        <div className="flex gap-2 mt-3 border-b -mb-px">
          {item.file3dPath && (
            <button
              onClick={() => setActiveTab('3d')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === '3d'
                  ? 'border-primary text-primary bg-primary/5'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Box className="h-4 w-4 inline mr-2" />
              3D Model
            </button>
          )}
          {item.file2dPath && (
            <button
              onClick={() => setActiveTab('2d')}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === '2d'
                  ? 'border-primary text-primary bg-primary/5'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <FileText className="h-4 w-4 inline mr-2" />
              {isDxfFile ? 'DXF Drawing' : '2D Drawing'}
            </button>
          )}
          <button
            onClick={() => setActiveTab('intelligence')}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'intelligence'
                ? 'border-primary text-primary bg-primary/5'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <Cpu className="h-4 w-4 inline mr-2" />
            Manufacturing Intelligence
          </button>
        </div>
      </div>

      {/* Tab content — flex-1 so it fills all remaining height */}
      <div className="flex-1 overflow-hidden">

            {/* 3D Model Tab Content */}
            {activeTab === '3d' && (
              <div className="h-full flex flex-col">
                {loading && (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  </div>
                )}

                {!loading && file3dUrl && (
                  <div className="flex-1 overflow-hidden">
                    <ModelViewer
                      key={file3dUrl}
                      fileUrl={file3dUrl}
                      fileName={item.file3dPath?.split('/').pop() || 'model'}
                      fileType={item.file3dPath?.split('.').pop() || 'stl'}
                      bomItemId={item.id}
                      manufacturingFeatures={manufacturingFeatures}
                      selectedFeature={selectedFeature}
                      onFeatureSelect={setSelectedFeature}
                      showFeatures={showFeatures}
                    />
                  </div>
                )}

                {!loading && !file3dUrl && (
                  <div className="flex items-center justify-center flex-1 text-muted-foreground">
                    <p className="text-sm">3D model could not be loaded</p>
                  </div>
                )}
              </div>
            )}

            {/* 2D / DXF Drawing Tab Content */}
            {activeTab === '2d' && (
              <div className={`h-full ${isDxfFile ? 'overflow-hidden' : 'overflow-y-auto p-6 space-y-4'}`}>
                {loading && (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  </div>
                )}

                {!loading && file2dUrl && isDxfFile && (
                  <div className="h-full min-h-[500px]">
                    <DXFViewerComponent
                      fileUrl={file2dUrl}
                      fileName={item.file2dPath?.split('/').pop()?.replace(/\.gz$/, '') || 'drawing.dxf'}
                    />
                  </div>
                )}

                {!loading && file2dUrl && isImage2d && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-sm text-muted-foreground">{item.file2dPath?.split('/').pop()}</p>
                      <Button variant="ghost" size="sm" onClick={() => setImageView(imageView === 'fit' ? 'full' : 'fit')}>
                        <Maximize2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className={`border rounded-lg overflow-hidden bg-muted/30 ${imageView === 'fit' ? 'max-h-[400px]' : ''}`}>
                      <img src={file2dUrl} alt={item.name} className={`w-full ${imageView === 'fit' ? 'object-contain max-h-[400px]' : 'object-cover'}`} />
                    </div>
                    <Button variant="outline" className="w-full" asChild>
                      <a href={file2dUrl} download target="_blank" rel="noopener noreferrer">
                        <Download className="h-4 w-4 mr-2" />Download Image
                      </a>
                    </Button>
                  </div>
                )}

                {!loading && file2dUrl && isPdf2d && (
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">{item.file2dPath?.split('/').pop()}</p>
                    <div className="border rounded-lg overflow-hidden" style={{ height: '800px' }}>
                      <iframe src={`/api/file-proxy?url=${encodeURIComponent(file2dUrl)}`} className="w-full h-full" title="PDF Preview" />
                    </div>
                    <Button variant="outline" className="w-full" asChild>
                      <a href={file2dUrl} download target="_blank" rel="noopener noreferrer">
                        <Download className="h-4 w-4 mr-2" />Download PDF
                      </a>
                    </Button>
                  </div>
                )}

                {!loading && !file2dUrl && (
                  <div className="text-center py-12 text-muted-foreground">
                    <p className="text-sm">{isDxfFile ? 'DXF drawing' : '2D drawing'} could not be loaded</p>
                  </div>
                )}
              </div>
            )}

                {!item.file2dPath && !item.file3dPath && activeTab !== 'intelligence' && (
                  <div className="border rounded-lg p-6">
                <div className="text-center mb-6">
                  <Upload className="h-12 w-12 mx-auto mb-3 text-muted-foreground/50" />
                  <p className="text-sm text-muted-foreground mb-1">No technical files attached</p>
                  <p className="text-xs text-muted-foreground">Upload 2D drawings and 3D models</p>
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="upload-2d" className="text-sm font-medium">
                      2D Drawing (PDF, PNG, JPG)
                    </Label>
                    <div className="flex gap-2">
                      <Input
                        ref={file2dInputRef}
                        id="upload-2d"
                        type="file"
                        accept=".pdf,.png,.jpg,.jpeg"
                        onChange={(e) => setSelectedFile2d(e.target.files?.[0] || null)}
                        disabled={uploading}
                        className="flex-1"
                      />
                    </div>
                    {selectedFile2d && (
                      <p className="text-xs text-muted-foreground">
                        Selected: {selectedFile2d.name} ({(selectedFile2d.size / 1024).toFixed(1)} KB)
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="upload-3d" className="text-sm font-medium">
                      3D Model (STEP, STL, OBJ)
                    </Label>
                    <div className="flex gap-2">
                      <Input
                        ref={file3dInputRef}
                        id="upload-3d"
                        type="file"
                        accept=".stp,.step,.stl,.obj,.iges,.igs"
                        onChange={(e) => setSelectedFile3d(e.target.files?.[0] || null)}
                        disabled={uploading}
                        className="flex-1"
                      />
                    </div>
                    {selectedFile3d && (
                      <p className="text-xs text-muted-foreground">
                        Selected: {selectedFile3d.name} ({(selectedFile3d.size / 1024).toFixed(1)} KB)
                      </p>
                    )}
                  </div>

                  <Button
                    onClick={handleFileUpload}
                    disabled={uploading || (!selectedFile2d && !selectedFile3d)}
                    className="w-full"
                  >
                    {uploading ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Uploading...
                      </>
                    ) : (
                      <>
                        <Upload className="h-4 w-4 mr-2" />
                        Upload Files
                      </>
                    )}
                  </Button>
                  </div>
                </div>
                )}

            {/* Manufacturing Intelligence Tab Content */}
            {activeTab === 'intelligence' && (
              <div className="h-full overflow-y-auto">
                <ManufacturingIntelligenceView
                  item={item}
                  {...(projectId !== undefined ? { projectId } : {})}
                  {...(bomId !== undefined ? { bomId } : {})}
                  onFeatureSelect={(selection) => {
                    // Phase 2: pass face/edge IDs to ModelViewer for highlighting
                    // For now: switch to 3D view so user can see the model
                    if (item.file3dPath) {
                      setActiveTab('3d');
                    }
                  }}
                />
              </div>
            )}
      </div>
    </div>
  );
}
