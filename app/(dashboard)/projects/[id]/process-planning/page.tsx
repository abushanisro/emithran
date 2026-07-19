'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useBOMs } from '@/lib/api/hooks/useBOM';
import { useBOMItems } from '@/lib/api/hooks/useBOMItems';
import { useProcessPlanningSpecsByBomItem } from '@/lib/api/hooks/useProcessPlanningSpecs';
import { ModelViewer } from '@/components/ui/model-viewer';
import { PartDimensionViewer } from '@/components/ui/part-dimension-viewer';
import { Viewer2D } from '@/components/ui/viewer-2d';
import { apiClient } from '@/lib/api/client';
import { bomItemsApi } from '@/lib/api/bom-items';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { ArrowLeft, DollarSign, Download, RefreshCw, Image as ImageIcon, FileText as FileTextIcon, Loader2, ChevronRight, Zap, Trophy, TrendingDown, CheckCircle2, Ruler } from 'lucide-react';
import { useRouteComparison, useApplyRoute } from '@/lib/api/hooks/useBOMItems';
import type { RouteResultDto } from '@/lib/api/hooks/useBOMItems';

// Reset circuit breaker on page load if it's stuck
if (typeof window !== 'undefined') {
  try {
    apiClient.resetCircuitBreaker();
  } catch (error) {
    // Could not reset circuit breaker
  }
}
import { BOMSelectionCard } from '@/components/features/process-planning/BOMSelectionCard';
import { usePageContext } from '@/lib/echo/PageContextProvider';
import { RawMaterialsSection } from '@/components/features/process-planning/RawMaterialsSection';
import { ToolingSection } from '@/components/features/process-planning/ToolingSection';
import { ManufacturingProcessSection } from '@/components/features/process-planning/ManufacturingProcessSection';
import { PackagingLogisticsSection } from '@/components/features/process-planning/PackagingLogisticsSection';
import { ProcuredPartsSection } from '@/components/features/process-planning/ProcuredPartsSection';
import { CostDataProvider } from '@/lib/providers/cost-data-provider';
import { CostAnalysisEngine } from '@/components/features/cost-analysis/CostAnalysisEngine';
import { BomCostReportWrapper } from '@/components/features/cost-analysis/BomCostReportWrapper';
import { useBomItemCostAnalysis } from '@/lib/api/hooks/useCostAnalysis';
import { generateEMithranPdf } from '@/lib/utils/generate-emithran-pdf';
import { generateEMithranImage } from '@/lib/utils/generate-emithran-image';
import { WorkflowNavigation } from '@/components/features/workflow/WorkflowNavigation';
import { toViewerFeature, FEATURE_GROUP_META } from '@/lib/utils/feature-colors';
import type { FeatureGroup } from '@/lib/utils/feature-colors';

// ── Dimension Validation Dialog ───────────────────────────────────────────────
// Shows the actual 3D CAD model with live-extracted measurements (aPriori-style).

function DimMetricCard({ label, value, unit, accent }: { label: string; value: string; unit?: string; accent?: string }) {
  return (
    <div className="flex flex-col gap-0.5 bg-[#1a2235] rounded-lg p-2.5">
      <span className="text-[9px] uppercase tracking-widest font-medium" style={{ color: accent ?? '#6b7280' }}>{label}</span>
      <span className="text-sm font-mono font-bold text-[#f0f4ff] leading-tight">{value}</span>
      {unit && <span className="text-[9px] text-[#4b5563]">{unit}</span>}
    </div>
  );
}


function DimensionValidationDialog({
  open, onClose,
  fileUrl, fileType, screenshot,
  dims, volumeMm3, surfaceAreaMm2,
  material, weight, tolerance, surfaceFinish, densityGcm3 = 7.85,
}: {
  open: boolean;
  onClose: () => void;
  fileUrl: string | null;
  fileType: string;
  screenshot: string | null;
  dims: { x: number; y: number; z: number } | null;
  volumeMm3: number | null;
  surfaceAreaMm2: number | null;
  material?: string;
  weight?: string;
  tolerance?: string;
  surfaceFinish?: string;
  densityGcm3?: number;
}) {
  const volMm3 = volumeMm3 ?? 0;
  const saMm2 = surfaceAreaMm2 ?? 0;
  const volCm3 = volMm3 / 1000;
  const calcWeightKg = volCm3 * densityGcm3 / 1000;

  const displaySA  = saMm2 > 0    ? `${saMm2.toFixed(0)} mm²`    : '—';
  const displayVol = volMm3 > 0   ? `${volCm3.toFixed(3)} cm³`   : '—';
  const displayWt  = calcWeightKg > 0
    ? `${calcWeightKg.toFixed(4)} kg`
    : weight && parseFloat(weight) > 0 ? `${parseFloat(weight).toFixed(4)} kg` : '—';

  const isStl = fileType?.toLowerCase() === 'stl';

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-[640px] p-0 overflow-hidden border border-[#1a2540] bg-[#0b0f1a]">
        <DialogHeader className="px-5 pt-4 pb-3 border-b border-[#1a2540]">
          <DialogTitle className="text-sm font-semibold text-[#c9d8f0] flex items-center gap-2">
            <Ruler className="h-4 w-4 text-emerald-400" />
            Part Dimension Validation
          </DialogTitle>
          <DialogDescription className="text-[10px] text-[#4a6080]">
            Bounding envelope extracted from CAD geometry
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-0 overflow-y-auto" style={{ maxHeight: '85vh' }}>

          {/* ── Part Envelope: full-width PartDimensionViewer ── */}
          <div className="relative bg-[#0d1520] border-b border-[#1a2540] flex justify-center overflow-hidden" style={{ height: 320 }}>

            {/* Isometric thumbnail — top-right corner if screenshot available */}
            {screenshot && (
              <div className="absolute top-2 right-2 z-10 rounded overflow-hidden border border-[#1a2540]" style={{ width: 80, height: 60 }}>
                <img src={screenshot} alt="iso" style={{ width: 80, height: 60, objectFit: 'cover', background: '#0d1117' }} />
                <span className="absolute bottom-0 left-0 right-0 text-center text-[7px] font-mono text-[#4a6080] bg-[#0b0f1a]/80 py-0.5">ISO</span>
              </div>
            )}

            {/* Depth badge — top-left */}
            {dims?.z != null && (
              <div className="absolute top-2 left-2 z-10 flex items-center gap-1 bg-[#0b0f1a]/90 border border-[#2a3f60] rounded px-2 py-1">
                <span className="text-[8px] uppercase tracking-widest text-[#4a6080]">D</span>
                <span className="text-[11px] font-mono font-bold text-[#f59e0b]">{dims.z.toFixed(2)}</span>
                <span className="text-[8px] text-[#4a6080]">mm</span>
              </div>
            )}

            {isStl && fileUrl ? (
              /* STL — full-width orthographic render with auto-fitted model + projected dim arrows */
              <PartDimensionViewer
                fileUrl={fileUrl}
                {...(dims?.x != null ? { maxLength: dims.x } : {})}
                {...(dims?.y != null ? { maxWidth: dims.y } : {})}
                {...(dims?.z != null ? { maxHeight: dims.z } : {})}
                canvasWidth={580}
                canvasHeight={320}
              />
            ) : screenshot ? (
              <img
                src={screenshot}
                alt="Part 3D"
                style={{ display: 'block', width: '100%', height: 320, objectFit: 'contain', background: '#0d1520' }}
              />
            ) : (
              <div className="flex flex-col items-center justify-center gap-2 text-[#3a5070]" style={{ height: 320 }}>
                <Ruler className="h-10 w-10 opacity-20" />
                <p className="text-xs">Load a 3D model in the viewer first.</p>
              </div>
            )}
          </div>

          {/* ── Metrics — 3 columns in one row ── */}
          <div className="px-5 py-4 grid grid-cols-3 gap-3 border-b border-[#1a2540]">
            <DimMetricCard label="Width (X)"    value={dims?.x ? dims.x.toFixed(2) : '—'} unit="mm" accent="#60a5fa" />
            <DimMetricCard label="Height (Y)"   value={dims?.y ? dims.y.toFixed(2) : '—'} unit="mm" accent="#34d399" />
            <DimMetricCard label="Depth (Z)"    value={dims?.z ? dims.z.toFixed(2) : '—'} unit="mm" accent="#f59e0b" />
          </div>

          <div className="px-5 py-4 grid grid-cols-3 gap-3 border-b border-[#1a2540]">
            <DimMetricCard label="Surface Area" value={displaySA}  accent="#a78bfa" />
            <DimMetricCard label="Volume"        value={displayVol} accent="#38bdf8" />
            <DimMetricCard label="Calc. Weight"  value={displayWt}  accent="#34d399" />
          </div>

          <div className="px-5 py-4 grid grid-cols-4 gap-3">
            <DimMetricCard label="Material"       value={material || '—'}                                              accent="#fb923c" />
            <DimMetricCard label="Density"        value={densityGcm3 > 0 ? `${densityGcm3.toFixed(2)} g/cm³` : '—'}  accent="#64748b" />
            <DimMetricCard label="Tolerance"      value={tolerance || '—'}                                             accent="#64748b" />
            <DimMetricCard label="Surface Finish" value={surfaceFinish || '—'}                                         accent="#64748b" />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function getMaterialDensityGcm3(material: string): number {
  const m = material.toLowerCase();
  if (m.includes('stainless') || m.includes('ss ') || /\b(304|316|202|410|430)\b/.test(m)) return 7.93;
  if (m.includes('cast iron') || m.includes('grey iron') || m.includes('ductile iron') || /\bci\b/.test(m)) return 7.2;
  if (m.includes('alumin') || /\b(6061|7075|2024|5052|6082)\b/.test(m)) return 2.70;
  if (m.includes('titanium') || m.includes('ti-6') || m.includes('grade 5')) return 4.51;
  if (m.includes('brass')) return 8.50;
  if (m.includes('copper') || /\bcu\b/.test(m)) return 8.96;
  if (m.includes('plastic') || m.includes('nylon') || m.includes('pom') || m.includes('abs') || m.includes('peek') || m.includes('ptfe') || m.includes('polymer')) return 1.20;
  // steel (mild, EN8, EN24, EN31, alloy) — default
  return 7.85;
}

// ── Route badge chips ─────────────────────────────────────────────────────────
function RouteBadge({ label, icon }: { label: string; icon: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-semibold text-white/90">
      {icon}
      {label}
    </span>
  );
}

// ── Route card inside the dialog ──────────────────────────────────────────────
function RouteCard({
  route,
  currencySymbol,
  onSelect,
  isApplying,
}: {
  route: RouteResultDto;
  currencySymbol: string;
  onSelect: (routeId: string) => void;
  isApplying: boolean;
}) {
  const infeasible = !route.isFeasible;
  return (
    <div
      className={[
        'rounded-lg border p-4 transition-all',
        infeasible
          ? 'border-border bg-muted/30 opacity-50'
          : 'border-border bg-card hover:border-primary/50 hover:shadow-sm',
      ].join(' ')}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-sm text-foreground">{route.routeLabel}</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {route.badges.lowestCost && (
              <RouteBadge label="Lowest Cost" icon={<TrendingDown className="h-2.5 w-2.5" />} />
            )}
            {route.badges.fastest && (
              <RouteBadge label="Fastest" icon={<Zap className="h-2.5 w-2.5" />} />
            )}
            {route.badges.bestQuality && (
              <RouteBadge label="Best Quality" icon={<Trophy className="h-2.5 w-2.5" />} />
            )}
          </div>
          <div className="mt-2 flex gap-4 text-xs text-muted-foreground">
            <span>
              <span className="font-medium text-foreground">
                {infeasible ? '—' : `${currencySymbol}${route.totalCost?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
              </span>{' '}
              total/pc
            </span>
            <span>
              <span className="font-medium text-foreground">
                {route.cycleTimes.totalMin.toFixed(1)} min
              </span>{' '}
              cycle
            </span>
            <span>
              <span className="font-medium text-foreground">
                {route.processLines.length}
              </span>{' '}
              ops
            </span>
          </div>
          {infeasible && route.warnings[0] && (
            <p className="mt-1.5 text-[11px] text-destructive">{route.warnings[0]}</p>
          )}
        </div>
        <Button
          size="sm"
          variant={infeasible ? 'ghost' : 'default'}
          disabled={infeasible || isApplying}
          onClick={() => onSelect(route.routeId)}
          className="h-8 shrink-0 gap-1 text-xs"
        >
          {isApplying ? <Loader2 className="h-3 w-3 animate-spin" /> : <ChevronRight className="h-3 w-3" />}
          Select
        </Button>
      </div>
    </div>
  );
}

// ── Route Selection Button + Dialog ──────────────────────────────────────────
function RouteSelectionButton({ bomItemId, location }: { bomItemId: string | null; location: string }) {
  const [open, setOpen] = useState(false);
  const [applyingRouteId, setApplyingRouteId] = useState<string | null>(null);

  const routes = useRouteComparison(bomItemId ?? undefined, 1, location);
  const applyRoute = useApplyRoute(bomItemId ?? undefined);

  const handleSelect = (routeId: string) => {
    if (!bomItemId || applyRoute.isPending) return;
    setApplyingRouteId(routeId);
    applyRoute.mutate(
      { routeId, batchSize: 1, location },
      {
        onSettled: () => {
          setApplyingRouteId(null);
          setOpen(false);
        },
      },
    );
  };

  const feasibleRoutes = routes.data?.routes.filter((r) => r.isFeasible) ?? [];
  const infeasibleRoutes = routes.data?.routes.filter((r) => !r.isFeasible) ?? [];
  const symbol = routes.data?.currencySymbol ?? '$';

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => bomItemId && setOpen(true)}
        disabled={!bomItemId}
        className="h-6 px-2 text-xs text-white hover:bg-white/20 disabled:opacity-50"
      >
        Auto-Fill from CAD
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Select Manufacturing Route</DialogTitle>
            <DialogDescription>
              Choose a route — operations and cycle times will be written to the Process Cost table.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-1">
            {routes.isLoading && (
              <div className="flex items-center justify-center py-10 gap-2 text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading routes…
              </div>
            )}

            {routes.isError && (
              <p className="py-6 text-center text-sm text-destructive">
                Failed to load routes. Ensure a CAD file has been analyzed first.
              </p>
            )}

            {routes.isSuccess && feasibleRoutes.length === 0 && infeasibleRoutes.length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                No routes available for this part family. Run Auto-Fill on the CAD file first.
              </p>
            )}

            {feasibleRoutes.length > 0 && (
              <div className="space-y-2">
                {feasibleRoutes.map((route) => (
                  <RouteCard
                    key={route.routeId}
                    route={route}
                    currencySymbol={symbol}
                    onSelect={handleSelect}
                    isApplying={applyingRouteId === route.routeId && applyRoute.isPending}
                  />
                ))}
              </div>
            )}

            {infeasibleRoutes.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-0.5">
                  Not feasible for this part
                </p>
                {infeasibleRoutes.map((route) => (
                  <RouteCard
                    key={route.routeId}
                    route={route}
                    currencySymbol={symbol}
                    onSelect={handleSelect}
                    isApplying={false}
                  />
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ProcessPlanningPageContent() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectId = params.id as string;
  const queryClient = useQueryClient();
  const [isExporting, setIsExporting] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [validationDialogOpen, setValidationDialogOpen] = useState(false);

  usePageContext({
    entityType: 'project',
    entityId: projectId,
    breadcrumbs: ['Project', 'Process planning'],
  });
  const [selectedBomId, setSelectedBomId] = useState<string>('');
  const [selectedPartNumber, setSelectedPartNumber] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [location, setLocation] = useState<string>('USA');
  const [file3dUrl, setFile3dUrl] = useState<string | null>(null);
  const [file2dUrl, setFile2dUrl] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string>(() => {
    // Initialize tab from URL parameter, default to 'overview'
    const tabParam = searchParams.get('tab');
    return (tabParam && ['overview', 'process', 'costing'].includes(tabParam)) ? tabParam : 'overview';
  });

  // Edit mode states for part details
  const [isEditingPartDetails, setIsEditingPartDetails] = useState(false);
  const [editablePartData, setEditablePartData] = useState({
    partNumber: '',
    name: '',
    description: '',
    itemType: 'child_part',
    material: '',
    quantity: '',
    unit: '',
    annualVolume: '',
    unitWeight: '',
    unitCost: '',
    length: '',
    width: '',
    height: '',
    toleranceGrade: 'IT8',
    surfaceFinish: 'Ra 3.2 μm',
    heatTreatment: 'As Required',
    hardness: '',
    manufacturingFamilyOverride: '' as string,
  });

  const modelViewerRef = useRef<HTMLDivElement>(null);
  const [cadVolumeMm3, setCadVolumeMm3] = useState<number | null>(null);
  const [cadSurfaceArea, setCadSurfaceArea] = useState<number | null>(null);
  const [cadDimensions, setCadDimensions] = useState<{ x: number; y: number; z: number } | null>(null);
  const [localScreenshot, setLocalScreenshot] = useState<string | null>(null);
  const [manufacturingFeatures, setManufacturingFeatures] = useState<any[]>([]);
  const [selectedFeature, setSelectedFeature] = useState<any | null>(null);

  // Feature highlight state — hover is temporary, locked persists until toggled
  const [highlightFeature, setHighlightFeature] = useState<any | null>(null);
  const [highlightGroup, setHighlightGroup] = useState<FeatureGroup | null>(null);
  const [lockedFeature, setLockedFeature] = useState<any | null>(null);
  const [lockedGroup, setLockedGroup] = useState<FeatureGroup | null>(null);

  const handleFeatureHighlight = (feat: any | null, group: FeatureGroup | null) => {
    setHighlightFeature(feat);
    setHighlightGroup(group);
  };

  const handleFeatureFocus = (feat: any | null, group: FeatureGroup | null) => {
    const isUnlocking = lockedFeature?.type === feat?.type && lockedGroup === group;
    setLockedFeature(isUnlocking ? null : feat);
    setLockedGroup(isUnlocking ? null : group);
    if (!isUnlocking && feat) {
      modelViewerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  // Active viewer feature: hover takes priority over lock
  const activeRawFeature = highlightFeature ?? lockedFeature;
  const activeGroup = highlightGroup ?? lockedGroup;
  const activeViewerFeat = toViewerFeature(activeRawFeature);
  const activeCameraPreset = activeGroup ? (FEATURE_GROUP_META[activeGroup]?.cameraPreset ?? null) : null;

  const handleModelMeasurements = (data: any) => {
    if (data?.volume && data.volume > 0) setCadVolumeMm3(data.volume);
    if (data?.surfaceArea && data.surfaceArea > 0) setCadSurfaceArea(data.surfaceArea);
    if (data?.dimensions) setCadDimensions(data.dimensions);
  };

  // Fetch data with loading and error states - force fresh data with higher limit
  const { data: bomsData, isLoading: bomsLoading, error: bomsError, refetch: refetchBOMs } = useBOMs({
    projectId,
    limit: 50,  // Increase limit to ensure we get all BOMs
    page: 1     // Ensure we start from page 1
  });
  const boms = bomsData?.boms || [];


  // Force refetch on mount to ensure fresh data
  useEffect(() => {
    // Clear any cached queries and refetch
    refetchBOMs();
  }, [projectId, refetchBOMs]);

  // Auto-select first BOM when BOMs are loaded and no BOM is selected
  useEffect(() => {
    const firstBom = boms[0];
    if (firstBom && !selectedBomId) {
      setSelectedBomId(firstBom.id);
    }
  }, [boms, selectedBomId]);

  // Sync activeTab with URL parameter changes
  useEffect(() => {
    const tabParam = searchParams.get('tab');
    if (tabParam && ['overview', 'process', 'costing'].includes(tabParam) && tabParam !== activeTab) {
      setActiveTab(tabParam);
    }
  }, [searchParams, activeTab]);

  // Handler for tab changes - updates both state and URL
  const handleTabChange = (newTab: string) => {
    setActiveTab(newTab);
    // Update URL with new tab parameter
    const newSearchParams = new URLSearchParams(searchParams.toString());
    if (newTab === 'overview') {
      newSearchParams.delete('tab'); // Remove tab param for default tab
    } else {
      newSearchParams.set('tab', newTab);
    }
    const newUrl = `${window.location.pathname}${newSearchParams.toString() ? '?' + newSearchParams.toString() : ''}`;
    router.push(newUrl);
  };

  const { data: bomItemsData, isLoading: bomItemsLoading, error: bomItemsError } = useBOMItems(selectedBomId);
  const bomItems = bomItemsData?.items || [];
  const selectedItem = bomItems.find((item) => item.partNumber === selectedPartNumber);
  const { data: exportAnalysis } = useBomItemCostAnalysis(selectedItem?.id);

  const handleScreenshotReady = useCallback(async (dataUrl: string) => {
    // Keep a full-res copy locally for the Validation dialog overlay
    setLocalScreenshot(dataUrl);

    const itemId = selectedItem?.id;
    if (!itemId) return;
    if (selectedItem?.thumbnailUrl && selectedItem.thumbnailUrl.length > 100) return;

    try {
      // Resize to 256×256 JPEG to keep the stored value compact
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = reject;
        img.src = dataUrl;
      });
      const thumb = document.createElement('canvas');
      thumb.width = 256; thumb.height = 256;
      const ctx = thumb.getContext('2d');
      if (!ctx) return;
      ctx.fillStyle = '#2d2d2d';
      ctx.fillRect(0, 0, 256, 256);
      const aspect = img.width / img.height;
      const dw = aspect > 1 ? 256 : 256 * aspect;
      const dh = aspect > 1 ? 256 / aspect : 256;
      ctx.drawImage(img, (256 - dw) / 2, (256 - dh) / 2, dw, dh);
      const jpegUrl = thumb.toDataURL('image/jpeg', 0.8);

      await apiClient.patch(`/bom-items/${itemId}/thumbnail`, { thumbnailUrl: jpegUrl });
      queryClient.invalidateQueries({ queryKey: ['bom-items'], exact: false });
    } catch {
      // Non-fatal — thumbnail capture is best-effort
    }
  }, [selectedItem?.id, selectedItem?.thumbnailUrl, queryClient]);

  const exportReport = useCallback(async (
    _scope: 'part' | 'full',
    format: 'pdf' | 'image',
  ) => {
    setExportMenuOpen(false);
    if (isExporting) return;
    setIsExporting(true);

    const partInfo = {
      partNumber:   selectedItem?.partNumber ?? undefined,
      partName:     selectedItem?.partName   ?? selectedItem?.name ?? undefined,
      material:     selectedItem?.material   ?? undefined,
      thumbnailUrl: selectedItem?.thumbnailUrl ?? undefined,
    };

    try {
      if (!exportAnalysis) { setIsExporting(false); return; }

      if (format === 'pdf') {
        await generateEMithranPdf(exportAnalysis, partInfo);
        return;
      }

      // Image: build a clean off-screen white HTML report, then capture it
      await generateEMithranImage(exportAnalysis, partInfo);
    } catch (e) {
      console.error('Export failed', e);
    } finally {
      setIsExporting(false);
    }
  }, [isExporting, exportAnalysis, selectedItem]);

  // DFM features — always seed with all detectable types when a 3D file is present.
  // DFMColorMesh detects features from geometry itself; this list just enables each type.
  const DEFAULT_DFM_FEATURES = [
    { id: 'hole',      type: 'hole'      as const, position: { x:0,y:0,z:0 }, dimensions: {}, manufacturingProcess: 'Drilling',        cycleTime: 0, tooling: [], warnings: [], aiRecommendations: [] },
    { id: 'pocket',    type: 'pocket'    as const, position: { x:0,y:0,z:0 }, dimensions: {}, manufacturingProcess: 'Milling',          cycleTime: 0, tooling: [], warnings: [], aiRecommendations: [] },
    { id: 'thin_wall', type: 'thin_wall' as const, position: { x:0,y:0,z:0 }, dimensions: {}, manufacturingProcess: 'Precision Milling', cycleTime: 0, tooling: [], warnings: [], aiRecommendations: [] },
    { id: 'undercut',  type: 'undercut'  as const, position: { x:0,y:0,z:0 }, dimensions: {}, manufacturingProcess: 'T-Slot Milling',   cycleTime: 0, tooling: [], warnings: [], aiRecommendations: [] },
  ];

  useEffect(() => {
    if (!selectedItem?.id || !selectedItem.file3dPath) {
      setManufacturingFeatures([]);
      setSelectedFeature(null);
      setCadVolumeMm3(null);
      return;
    }
    // Seed immediately so the DFM button appears while analysis loads
    setManufacturingFeatures(DEFAULT_DFM_FEATURES);
    setSelectedFeature(null);

    bomItemsApi.getCADAnalysis(selectedItem.id)
      .then((result: any) => {
        const stored =
          result?.analysis?.geometryFeatures?.manufacturingFeatures ??
          result?.analysis?.features ??
          result?.features ?? [];
        if (Array.isArray(stored) && stored.length > 0) {
          setManufacturingFeatures(stored);
        }
        // else keep the default seed
      })
      .catch(() => { /* keep default seed */ });
  }, [selectedItem?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load process planning specifications for the selected BOM item
  const { data: processSpecs } = useProcessPlanningSpecsByBomItem(selectedItem?.id);

  // Initialize editable data with BOM item data and process planning specifications
  useEffect(() => {
    if (selectedItem) {
      setEditablePartData({
        partNumber: String(selectedItem.partNumber || selectedItem.id || ''),
        name: String(selectedItem.name || ''),
        description: String(selectedItem.description || ''),
        itemType: String(selectedItem.itemType || 'child_part'),
        material: String(selectedItem.material || selectedItem.materialGrade || ''),
        quantity: String(selectedItem.quantity || ''),
        unit: String(selectedItem.unit || ''),
        annualVolume: String(selectedItem.annualVolume || ''),
        unitWeight: String(selectedItem.unitWeight || selectedItem.weight || ''),
        unitCost: String(selectedItem.unitCost || ''),
        length: String(selectedItem.maxLength || selectedItem.length || ''),
        width: String(selectedItem.maxWidth || selectedItem.width || ''),
        height: String(selectedItem.maxHeight || selectedItem.height || ''),
        // Use process planning specifications if available, otherwise fallback to defaults
        toleranceGrade: String(processSpecs?.toleranceGrade || 'IT8'),
        surfaceFinish: String(processSpecs?.surfaceFinish || 'Ra 3.2 μm'),
        heatTreatment: String(processSpecs?.heatTreatment || 'As Required'),
        hardness: String(processSpecs?.hardness || ''),
        manufacturingFamilyOverride: String((selectedItem as any).manufacturingFamilyOverride || ''),
      });
    } else {
      // Initialize with default values if no item is selected
      setEditablePartData({
        partNumber: '',
        name: '',
        description: '',
        itemType: 'child_part',
        material: '',
        quantity: '',
        unit: '',
        annualVolume: '',
        unitWeight: '',
        unitCost: '',
        length: '',
        width: '',
        height: '',
        toleranceGrade: 'IT8',
        surfaceFinish: 'Ra 3.2 μm',
        heatTreatment: 'As Required',
        hardness: '',
        manufacturingFamilyOverride: '',
      });
    }
  }, [selectedItem?.id, processSpecs]);

  // CAD-derived weight from STL volume (mm³ → cm³ → g → kg)
  const cadDerivedWeightKg = cadVolumeMm3 != null && editablePartData.material
    ? (cadVolumeMm3 / 1_000_000) * getMaterialDensityGcm3(editablePartData.material)
    : null;

  // Auto-fill unit weight from CAD when BOM has no weight set
  useEffect(() => {
    if (cadDerivedWeightKg == null) return;
    const w = parseFloat(editablePartData.unitWeight);
    if (!editablePartData.unitWeight || isNaN(w) || w <= 0) {
      setEditablePartData(prev => ({ ...prev, unitWeight: cadDerivedWeightKg.toFixed(4) }));
    }
  }, [cadDerivedWeightKg]); // eslint-disable-line react-hooks/exhaustive-deps

  // Weight mismatch badge — warn when BOM weight differs from CAD estimate by >30%
  const bomWeightKg = parseFloat(editablePartData.unitWeight);
  const cadWeightDiffPct = cadDerivedWeightKg != null && cadDerivedWeightKg > 0 && !isNaN(bomWeightKg) && bomWeightKg > 0
    ? Math.round(Math.abs(bomWeightKg - cadDerivedWeightKg) / cadDerivedWeightKg * 100)
    : null;
  const cadWeightMismatch = cadWeightDiffPct != null && cadWeightDiffPct > 30;

  const handleBomChange = (bomId: string) => {
    setSelectedBomId(bomId);
    setSelectedPartNumber('');
    setSearchTerm('');
    setStatusFilter('all');
    setTypeFilter('all');
  };

  // Quick Action handlers

  // Navigation handlers
  const tabs = ['overview', 'process', 'costing'];
  const currentTabIndex = tabs.indexOf(activeTab);

  const handlePrevious = () => {
    if (currentTabIndex > 0) {
      const prevTab = tabs[currentTabIndex - 1];
      if (prevTab) setActiveTab(prevTab);
    }
  };

  const handleNext = () => {
    if (currentTabIndex < tabs.length - 1) {
      const nextTab = tabs[currentTabIndex + 1];
      if (nextTab) setActiveTab(nextTab);
    }
  };

  // Handlers for part details editing
  const handleEditPartDetails = () => {
    setIsEditingPartDetails(true);
  };

  const handleSavePartDetails = async () => {
    if (!selectedItem || !projectId) return;

    try {
      // Prepare manufacturing specifications for database update
      const manufacturingSpecs = {
        bomItemId: selectedItem.id,
        projectId: projectId,
        toleranceGrade: editablePartData.toleranceGrade,
        surfaceFinish: editablePartData.surfaceFinish,
        heatTreatment: editablePartData.heatTreatment,
        hardness: editablePartData.hardness,
      };

      // Save manufacturing specifications to database via Process Planning API
      await apiClient.post('/process-planning/specifications/upsert', manufacturingSpecs);
      
      setIsEditingPartDetails(false);
      
      // Show success message
      alert('Manufacturing specifications saved successfully!');
      
    } catch (error) {
      alert('Failed to save manufacturing specifications. Please try again.');
    }
  };

  const handleCancelEdit = () => {
    if (selectedItem) {
      setEditablePartData({
        partNumber: String(selectedItem.partNumber || selectedItem.id || ''),
        name: String(selectedItem.name || ''),
        description: String(selectedItem.description || ''),
        itemType: String(selectedItem.itemType || 'child_part'),
        material: String(selectedItem.material || selectedItem.materialGrade || ''),
        quantity: String(selectedItem.quantity || ''),
        unit: String(selectedItem.unit || ''),
        annualVolume: String(selectedItem.annualVolume || ''),
        unitWeight: String(selectedItem.unitWeight || selectedItem.weight || ''),
        unitCost: String(selectedItem.unitCost || ''),
        length: String(selectedItem.maxLength || selectedItem.length || ''),
        width: String(selectedItem.maxWidth || selectedItem.width || ''),
        height: String(selectedItem.maxHeight || selectedItem.height || ''),
        // Revert to saved process planning specifications
        toleranceGrade: String(processSpecs?.toleranceGrade || 'IT8'),
        surfaceFinish: String(processSpecs?.surfaceFinish || 'Ra 3.2 μm'),
        heatTreatment: String(processSpecs?.heatTreatment || 'As Required'),
        hardness: String(processSpecs?.hardness || ''),
        manufacturingFamilyOverride: String((selectedItem as any).manufacturingFamilyOverride || ''),
      });
    }
    setIsEditingPartDetails(false);
  };

  // Load file URLs — depend on stable IDs, not the full object reference
  useEffect(() => {
    if (!selectedItem) {
      setFile3dUrl(null);
      setFile2dUrl(null);
      return;
    }

    const itemId = selectedItem.id;
    const path3d = selectedItem.file3dPath;
    const path2d = selectedItem.file2dPath;

    const loadFile3dUrl = async () => {
      try {
        if (path3d) {
          const response = await apiClient.get<{ url: string }>(`/bom-items/${itemId}/file-url/3d`);
          setFile3dUrl(response.url);
        } else {
          setFile3dUrl(null);
        }
      } catch (error) {
        setFile3dUrl(null);
      }
    };

    const loadFile2dUrl = async () => {
      try {
        if (path2d) {
          const response = await apiClient.get<{ url: string }>(`/bom-items/${itemId}/file-url/2d`);
          setFile2dUrl(response.url);
        } else {
          setFile2dUrl(null);
        }
      } catch (error) {
        setFile2dUrl(null);
      }
    };

    loadFile3dUrl();
    loadFile2dUrl();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedItem?.id, selectedItem?.file3dPath, selectedItem?.file2dPath]);

  // Transform BOM items to match BOMSelectionCard expected format
  // Only transform the selected BOM with its items
  const transformedBoms = boms.map(bom => ({
    ...bom,
    items: bom.id === selectedBomId ? bomItems.map(item => ({
      id: item.id,
      partNumber: item.partNumber || item.id,
      description: item.name || item.description || '',
      itemType: (item.itemType || 'child_part') as 'assembly' | 'sub_assembly' | 'child_part',
      status: 'pending' as const, // You can map this from your actual data if available
    })) : [], // Empty array for non-selected BOMs
  }));

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-[1800px] mx-auto space-y-6">
        {/* PAGE HEADER */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => router.push(`/projects/${projectId}`)}
              className="flex items-center gap-2"
            >
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
            <div>
              <h1 className="text-2xl font-bold text-foreground">Manufacturing Engineering Platform</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Integrated workflow for process planning, costing, and project management
              </p>
            </div>
          </div>
          {selectedPartNumber && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Active Part:</span>
              <Badge variant="default" className="text-xs">
                {selectedPartNumber}
              </Badge>
            </div>
          )}
        </div>

        {/* TAB INTERFACE */}
        <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-4">
          <div className="flex items-center justify-between">
            <TabsList className="grid grid-cols-3 h-10">
              <TabsTrigger value="overview" className="text-xs">
                Project Overview
              </TabsTrigger>
              <TabsTrigger value="process" className="text-xs">
                Process Planning
              </TabsTrigger>
              <TabsTrigger value="costing" className="text-xs">
                Cost Analysis
              </TabsTrigger>
            </TabsList>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-3"
                onClick={handlePrevious}
                disabled={currentTabIndex === 0}
              >
                Previous
              </Button>
              <Button
                size="sm"
                className="h-8 px-3"
                onClick={handleNext}
                disabled={currentTabIndex === tabs.length - 1}
              >
                Next →
              </Button>
            </div>
          </div>

          {/* TAB 1: PROJECT OVERVIEW - For OEM Engineers */}
          <TabsContent value="overview" className="space-y-6">
            {/* Project Stats Cards - Compact */}
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
              <Card className="border-l-4 border-l-blue-500">
                <CardContent className="p-3">
                  <p className="text-xs text-muted-foreground">Total BOMs</p>
                  <p className="text-lg font-bold">{boms.length}</p>
                </CardContent>
              </Card>

              <Card className="border-l-4 border-l-green-500">
                <CardContent className="p-3">
                  <p className="text-xs text-muted-foreground">Parts Ready</p>
                  <p className="text-lg font-bold">{bomItems.length}</p>
                </CardContent>
              </Card>

              <Card className="border-l-4 border-l-yellow-500">
                <CardContent className="p-3">
                  <p className="text-xs text-muted-foreground">In Progress</p>
                  <p className="text-lg font-bold">0</p>
                </CardContent>
              </Card>

              <Card className="border-l-4 border-l-primary">
                <CardContent className="p-3">
                  <p className="text-xs text-muted-foreground">Project Progress</p>
                  <p className="text-lg font-bold">0%</p>
                </CardContent>
              </Card>
            </div>

            {/* Loading State */}
            {bomsLoading && (
              <div className="bg-card border border-border rounded-lg p-8 text-center">
                <p className="text-muted-foreground">Loading BOMs...</p>
              </div>
            )}

            {/* Error State */}
            {bomsError && (
              <div className="bg-destructive/10 border border-destructive rounded-lg p-4">
                <p className="text-destructive">Error loading BOMs: {bomsError.message}</p>
              </div>
            )}

            {/* BOM SELECTION CARD WITH FILTERS - HIGHLIGHTED */}
            {!bomsLoading && !bomsError && (
              <div className="border-2 border-primary/50 rounded-lg bg-primary/5 p-1">
                <BOMSelectionCard
                  boms={transformedBoms}
                  selectedBomId={selectedBomId}
                  selectedPartNumber={selectedPartNumber}
                  searchTerm={searchTerm}
                  statusFilter={statusFilter}
                  typeFilter={typeFilter}
                  onBomChange={handleBomChange}
                  onPartChange={setSelectedPartNumber}
                  onSearchChange={setSearchTerm}
                  onStatusFilterChange={setStatusFilter}
                  onTypeFilterChange={setTypeFilter}
                />
              </div>
            )}

            {/* BOM Items Loading State */}
            {selectedBomId && bomItemsLoading && (
              <div className="bg-card border border-border rounded-lg p-8 text-center">
                <p className="text-muted-foreground">Loading BOM items...</p>
              </div>
            )}

            {/* BOM Items Error State */}
            {selectedBomId && bomItemsError && (
              <div className="bg-destructive/10 border border-destructive rounded-lg p-4">
                <p className="text-destructive">Error loading BOM items: {bomItemsError.message}</p>
              </div>
            )}

            {/* DETAILED BOM INFORMATION SECTION */}
            {selectedBomId && !bomItemsLoading && !bomItemsError && bomItems.length > 0 && (
              <Card className="mt-6">
                <CardHeader>
                  <CardTitle className="text-lg">BOM Details - {boms.find(b => b.id === selectedBomId)?.name}</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    Complete breakdown of all parts and components in this BOM
                  </p>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {bomItems.map((item, index) => (
                      <div
                        key={item.id}
                        className={`rounded-lg border bg-card text-card-foreground shadow-sm border-l-4 ${item.itemType === 'assembly' ? 'border-l-emerald-500' :
                          item.itemType === 'sub_assembly' ? 'border-l-blue-500' : 'border-l-amber-500'
                          }`}
                      >
                        <div className="p-4">
                          <div className="flex flex-col md:flex-row items-start justify-between gap-4">
                            <div className="flex items-start gap-4 flex-1 w-full">
                              <div className="flex-1 min-w-0">
                                <div className="flex flex-wrap items-center gap-2 mb-2">
                                  <span className="text-sm font-bold text-muted-foreground">#{index + 1}</span>
                                  <h3 className="text-lg font-semibold text-foreground truncate">
                                    {item.name || item.partNumber || `Item ${index + 1}`}
                                  </h3>
                                  <Badge
                                    variant="outline"
                                    className={`text-xs ${item.itemType === 'assembly' ? 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20' :
                                      item.itemType === 'sub_assembly' ? 'bg-blue-500/10 text-blue-700 border-blue-500/20' :
                                        'bg-amber-500/10 text-amber-700 border-amber-500/20'
                                      }`}
                                  >
                                    {item.itemType === 'assembly' ? 'Assembly' :
                                      item.itemType === 'sub_assembly' ? 'Sub-Assembly' : 'Child Part'}
                                  </Badge>
                                </div>

                                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mt-3">
                                  <div className="text-sm">
                                    <p className="text-muted-foreground text-xs mb-1">Part Number</p>
                                    <p className="font-medium text-foreground">{item.partNumber || '—'}</p>
                                  </div>
                                  <div className="text-sm">
                                    <p className="text-muted-foreground text-xs mb-1">Quantity</p>
                                    <p className="font-medium text-foreground">{item.quantity} {item.unit}</p>
                                  </div>
                                  <div className="text-sm">
                                    <p className="text-muted-foreground text-xs mb-1">Annual Volume</p>
                                    <p className="font-medium text-foreground">{item.annualVolume?.toLocaleString() || '—'}</p>
                                  </div>
                                  <div className="text-sm">
                                    <p className="text-muted-foreground text-xs mb-1">Material</p>
                                    <p className="font-medium text-foreground" title={item.materialGrade || '—'}>
                                      {item.materialGrade || item.material || '—'}
                                    </p>
                                  </div>
                                  <div className="text-sm">
                                    <p className="text-muted-foreground text-xs mb-1">Status</p>
                                    <Badge variant="secondary" className="text-xs">
                                      Pending
                                    </Badge>
                                  </div>
                                </div>

                                {item.description && (
                                  <div className="text-sm mt-3">
                                    <p className="text-muted-foreground text-xs mb-1">Description</p>
                                    <p className="font-medium text-foreground">{item.description}</p>
                                  </div>
                                )}

                                {/* Additional Technical Details */}
                                <div className="mt-3 pt-3 border-t border-border">
                                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                                    <div>
                                      <p className="text-muted-foreground mb-1">3D Model</p>
                                      <p className="font-medium text-foreground">
                                        {item.file3dPath ? '✓ Available' : '— Not Available'}
                                      </p>
                                    </div>
                                    <div>
                                      <p className="text-muted-foreground mb-1">2D Drawing</p>
                                      <p className="font-medium text-foreground">
                                        {item.file2dPath ? '✓ Available' : '— Not Available'}
                                      </p>
                                    </div>
                                    <div>
                                      <p className="text-muted-foreground mb-1">Procurement</p>
                                      <p className="font-medium text-foreground">
                                        {item.itemType === 'child_part' ? 'Manufacturing' : 'Assembly'}
                                      </p>
                                    </div>
                                    <div>
                                      <p className="text-muted-foreground mb-1">Priority</p>
                                      <Badge variant="outline" className="text-xs">
                                        {item.itemType === 'assembly' ? 'High' : 'Medium'}
                                      </Badge>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 w-full md:w-auto justify-end">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setSelectedPartNumber(item.partNumber || item.id);
                                  setActiveTab('process');
                                }}
                                className={`${selectedPartNumber === (item.partNumber || item.id) ? 'bg-primary text-primary-foreground' : ''}`}
                              >
                                {selectedPartNumber === (item.partNumber || item.id) ? 'Selected' : 'Select'}
                              </Button>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* TAB 2: PROCESS PLANNING - For Process Engineers */}
          <TabsContent value="process" className="space-y-4">
            {selectedPartNumber && selectedItem ? (
              <>
                {/* Selected Part Details Card - Compact & Editable */}
                <Card className="border-l-4 border-l-green-500">
                  <CardHeader className="bg-green-500 py-2 px-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-white text-sm font-semibold">
                        Complete BOM Details & Process Planning
                      </CardTitle>
                      <div className="flex items-center gap-2">
                        <select
                          value={location}
                          onChange={(e) => setLocation(e.target.value)}
                          className="h-6 text-xs bg-white text-gray-800 font-medium border border-green-300 rounded px-1.5 focus:outline-none focus:ring-2 focus:ring-white/60 shadow-sm [&>option]:bg-white [&>option]:text-gray-800"
                        >
                          <option value="India">India</option>
                          <option value="USA">USA</option>
                          <option value="China">China</option>
                          <option value="Germany">Germany</option>
                          <option value="France">France</option>
                          <option value="W. Europe">W. Europe</option>
                          <option value="E. Europe">E. Europe</option>
                          <option value="UK">UK</option>
                          <option value="Vietnam">Vietnam</option>
                          <option value="Mexico">Mexico</option>
                        </select>
                        <RouteSelectionButton bomItemId={selectedItem?.id ?? null} location={location} />
                        {!isEditingPartDetails ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleEditPartDetails}
                            className="h-6 px-2 text-xs text-white hover:bg-white/20"
                          >
                            Edit All
                          </Button>
                        ) : (
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={handleSavePartDetails}
                              className="h-6 px-2 text-xs text-white hover:bg-white/20"
                            >
                              Save
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={handleCancelEdit}
                              className="h-6 px-2 text-xs text-white hover:bg-white/20"
                            >
                              Cancel
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="p-3">

                    {/* Basic Information */}
                    <div className="mb-3">
                      <h4 className="text-xs font-semibold text-foreground mb-2 uppercase tracking-wide">Basic Information</h4>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                        <div>
                          <label className="text-xs text-muted-foreground">Part Number</label>
                          {isEditingPartDetails ? (
                            <Input
                              value={editablePartData.partNumber}
                              onChange={(e) => setEditablePartData(prev => ({ ...prev, partNumber: e.target.value }))}
                              className="h-7 text-xs"
                            />
                          ) : (
                            <p className="text-xs font-medium">{editablePartData.partNumber}</p>
                          )}
                        </div>
                        <div>
                          <label className="text-xs text-muted-foreground">Part Name</label>
                          {isEditingPartDetails ? (
                            <Input
                              value={editablePartData.name}
                              onChange={(e) => setEditablePartData(prev => ({ ...prev, name: e.target.value }))}
                              className="h-7 text-xs"
                            />
                          ) : (
                            <p className="text-xs font-medium">{editablePartData.name || '—'}</p>
                          )}
                        </div>
                        <div>
                          <label className="text-xs text-muted-foreground">Item Type</label>
                          {isEditingPartDetails ? (
                            <select
                              value={editablePartData.itemType}
                              onChange={(e) => setEditablePartData(prev => ({ ...prev, itemType: e.target.value }))}
                              className="h-7 w-full text-xs border rounded px-2"
                            >
                              <option value="child_part">Child Part</option>
                              <option value="sub_assembly">Sub Assembly</option>
                              <option value="assembly">Assembly</option>
                            </select>
                          ) : (
                            <Badge variant="outline" className="text-xs h-5">
                              {editablePartData.itemType.replace('_', ' ').toUpperCase()}
                            </Badge>
                          )}
                        </div>
                        <div>
                          <label className="text-xs text-muted-foreground">Material</label>
                          {isEditingPartDetails ? (
                            <Input
                              value={editablePartData.material}
                              onChange={(e) => setEditablePartData(prev => ({ ...prev, material: e.target.value }))}
                              className="h-7 text-xs"
                            />
                          ) : (
                            <p className="text-xs font-medium">{editablePartData.material || '—'}</p>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Technical Specifications */}
                    <div className="mb-3">
                      <h4 className="text-xs font-semibold text-foreground mb-2 uppercase tracking-wide">Technical Specs</h4>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                        <div>
                          <label className="text-xs text-muted-foreground">Quantity</label>
                          {isEditingPartDetails ? (
                            <Input
                              value={editablePartData.quantity}
                              onChange={(e) => setEditablePartData(prev => ({ ...prev, quantity: e.target.value }))}
                              className="h-7 text-xs"
                            />
                          ) : (
                            <p className="text-xs font-medium">{editablePartData.quantity || '—'}</p>
                          )}
                        </div>
                        <div>
                          <label className="text-xs text-muted-foreground">Unit</label>
                          {isEditingPartDetails ? (
                            <Input
                              value={editablePartData.unit}
                              onChange={(e) => setEditablePartData(prev => ({ ...prev, unit: e.target.value }))}
                              className="h-7 text-xs"
                            />
                          ) : (
                            <p className="text-xs font-medium">{editablePartData.unit || '—'}</p>
                          )}
                        </div>
                        <div>
                          <label className="text-xs text-muted-foreground">Annual Volume</label>
                          {isEditingPartDetails ? (
                            <Input
                              value={editablePartData.annualVolume}
                              onChange={(e) => setEditablePartData(prev => ({ ...prev, annualVolume: e.target.value }))}
                              className="h-7 text-xs"
                            />
                          ) : (
                            <p className="text-xs font-medium">{editablePartData.annualVolume ? Number(editablePartData.annualVolume).toLocaleString() : '—'}</p>
                          )}
                        </div>
                        <div>
                          <label className="text-xs text-muted-foreground">Unit Weight (kg)</label>
                          {isEditingPartDetails ? (
                            <div className="space-y-1">
                              <Input
                                value={editablePartData.unitWeight}
                                onChange={(e) => setEditablePartData(prev => ({ ...prev, unitWeight: e.target.value }))}
                                className="h-7 text-xs"
                              />
                              {cadDerivedWeightKg != null && (
                                <div className="flex items-center gap-1 flex-wrap">
                                  <span className="text-xs text-amber-600">CAD est: {cadDerivedWeightKg.toFixed(4)} kg</span>
                                  <button
                                    type="button"
                                    onClick={() => setEditablePartData(prev => ({ ...prev, unitWeight: cadDerivedWeightKg.toFixed(4) }))}
                                    className="text-xs text-blue-600 hover:underline"
                                  >
                                    Use CAD
                                  </button>
                                </div>
                              )}
                            </div>
                          ) : (
                            <div>
                              <p className="text-xs font-medium">{editablePartData.unitWeight || '—'}</p>
                              {cadWeightMismatch && cadDerivedWeightKg != null && (
                                <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                                  <span className="text-xs bg-amber-100 text-amber-700 px-1 py-0.5 rounded">
                                    ⚠ CAD: {cadDerivedWeightKg.toFixed(4)} kg ({cadWeightDiffPct}% diff)
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditablePartData(prev => ({ ...prev, unitWeight: cadDerivedWeightKg.toFixed(4) }));
                                      setIsEditingPartDetails(true);
                                    }}
                                    className="text-xs text-blue-600 hover:underline"
                                  >
                                    Use CAD Weight
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {/* Dimensions */}
                      <div>
                        <h4 className="text-xs font-semibold text-foreground mb-2 uppercase tracking-wide">Dimensions (mm)</h4>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-xs text-muted-foreground">Length</label>
                            {isEditingPartDetails ? (
                              <Input
                                value={editablePartData.length}
                                onChange={(e) => setEditablePartData(prev => ({ ...prev, length: e.target.value }))}
                                className="h-7 text-xs"
                              />
                            ) : (
                              <p className="text-xs font-medium">{editablePartData.length || '—'}</p>
                            )}
                          </div>
                          <div>
                            <label className="text-xs text-muted-foreground">Width</label>
                            {isEditingPartDetails ? (
                              <Input
                                value={editablePartData.width}
                                onChange={(e) => setEditablePartData(prev => ({ ...prev, width: e.target.value }))}
                                className="h-7 text-xs"
                              />
                            ) : (
                              <p className="text-xs font-medium">{editablePartData.width || '—'}</p>
                            )}
                          </div>
                          <div>
                            <label className="text-xs text-muted-foreground">Height</label>
                            {isEditingPartDetails ? (
                              <Input
                                value={editablePartData.height}
                                onChange={(e) => setEditablePartData(prev => ({ ...prev, height: e.target.value }))}
                                className="h-7 text-xs"
                              />
                            ) : (
                              <p className="text-xs font-medium">{editablePartData.height || '—'}</p>
                            )}
                          </div>
                          <div>
                            <label className="text-xs text-muted-foreground">Tolerance</label>
                            {isEditingPartDetails ? (
                              <Input
                                value={editablePartData.toleranceGrade}
                                onChange={(e) => setEditablePartData(prev => ({ ...prev, toleranceGrade: e.target.value }))}
                                className="h-7 text-xs"
                              />
                            ) : (
                              <p className="text-xs font-medium">{editablePartData.toleranceGrade}</p>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Manufacturing */}
                      <div>
                        <h4 className="text-xs font-semibold text-foreground mb-2 uppercase tracking-wide">Manufacturing</h4>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-xs text-muted-foreground">Surface Finish</label>
                            {isEditingPartDetails ? (
                              <Input
                                value={editablePartData.surfaceFinish}
                                onChange={(e) => setEditablePartData(prev => ({ ...prev, surfaceFinish: e.target.value }))}
                                className="h-7 text-xs"
                              />
                            ) : (
                              <p className="text-xs font-medium">{editablePartData.surfaceFinish}</p>
                            )}
                          </div>
                          <div>
                            <label className="text-xs text-muted-foreground">Heat Treatment</label>
                            {isEditingPartDetails ? (
                              <Input
                                value={editablePartData.heatTreatment}
                                onChange={(e) => setEditablePartData(prev => ({ ...prev, heatTreatment: e.target.value }))}
                                className="h-7 text-xs"
                              />
                            ) : (
                              <p className="text-xs font-medium">{editablePartData.heatTreatment}</p>
                            )}
                          </div>
                          <div>
                            <label className="text-xs text-muted-foreground">Hardness (HRC)</label>
                            {isEditingPartDetails ? (
                              <Input
                                value={editablePartData.hardness}
                                onChange={(e) => setEditablePartData(prev => ({ ...prev, hardness: e.target.value }))}
                                className="h-7 text-xs"
                              />
                            ) : (
                              <p className="text-xs font-medium">{editablePartData.hardness || '—'}</p>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Bottom Row - Cost, Files */}
                    <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <h4 className="text-xs font-semibold text-foreground mb-2 uppercase tracking-wide">Cost</h4>
                        <div className="space-y-1">
                          <div>
                            <label className="text-xs text-muted-foreground">Unit Cost ($)</label>
                            {isEditingPartDetails ? (
                              <Input
                                value={editablePartData.unitCost}
                                onChange={(e) => setEditablePartData(prev => ({ ...prev, unitCost: e.target.value }))}
                                className="h-7 text-xs"
                              />
                            ) : (
                              <p className="text-xs font-medium">${editablePartData.unitCost || '—'}</p>
                            )}
                          </div>
                        </div>
                      </div>

                      <div>
                        <h4 className="text-xs font-semibold text-foreground mb-2 uppercase tracking-wide">Files</h4>
                        <div className="space-y-1">
                          <div className="flex items-center gap-1">
                            <Badge variant={selectedItem?.file3dPath ? "default" : "secondary"} className="text-xs h-5">
                              3D {selectedItem?.file3dPath ? '✓' : '✗'}
                            </Badge>
                            {selectedItem?.file3dPath && (
                              <span className="text-xs text-muted-foreground">
                                {selectedItem.file3dPath.split('.').pop()?.toUpperCase()}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1">
                            <Badge variant={selectedItem?.file2dPath ? "default" : "secondary"} className="text-xs h-5">
                              2D {selectedItem?.file2dPath ? '✓' : '✗'}
                            </Badge>
                            {selectedItem?.file2dPath && (
                              <span className="text-xs text-muted-foreground">
                                {selectedItem.file2dPath.split('.').pop()?.toUpperCase()}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Description - Full Width */}
                    {(selectedItem?.description || isEditingPartDetails) && (
                      <div className="mt-3">
                        <label className="text-xs font-medium text-muted-foreground">Description</label>
                        {isEditingPartDetails ? (
                          <Input
                            value={editablePartData.description}
                            onChange={(e) => setEditablePartData(prev => ({ ...prev, description: e.target.value }))}
                            className="h-7 text-xs mt-1"
                            placeholder="Enter part description"
                          />
                        ) : (
                          <p className="text-xs text-foreground bg-muted/30 p-2 rounded mt-1">
                            {editablePartData.description || 'No description available'}
                          </p>
                        )}
                      </div>
                    )}

                  </CardContent>
                </Card>

                {/* 3D MODEL VIEWER — full height with all tools */}
                <div ref={modelViewerRef} className="border border-border rounded-lg overflow-hidden shadow-md">
                  <div className="bg-primary p-3 flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-primary-foreground">3D Model Viewer</h2>
                    <div className="flex items-center gap-2">
                      {selectedItem.file3dPath && (
                        <span className="text-xs text-primary-foreground/70 font-mono">
                          {selectedItem.file3dPath.split('.').pop()?.toUpperCase()}
                        </span>
                      )}
                      <button
                        onClick={() => setValidationDialogOpen(true)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-semibold bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30 transition-colors"
                      >
                        <CheckCircle2 className="h-3 w-3" />
                        Validation
                      </button>
                    </div>
                  </div>
                  <div className="bg-card h-[calc(100vh-220px)] min-h-[600px]">
                    {selectedItem.file3dPath && file3dUrl ? (
                      <ModelViewer
                        fileUrl={file3dUrl}
                        fileName={selectedItem.file3dPath.split('/').pop() || selectedItem.name || 'model'}
                        fileType={selectedItem.file3dPath.split('.').pop() || 'step'}
                        bomItemId={selectedItem.id}
                        onMeasurements={handleModelMeasurements}
                        onScreenshotReady={handleScreenshotReady}
                        manufacturingFeatures={manufacturingFeatures}
                        selectedFeature={activeViewerFeat ?? selectedFeature}
                        onFeatureSelect={setSelectedFeature}
                        cameraPreset={activeCameraPreset}
                      />
                    ) : (
                      <div className="h-full flex items-center justify-center text-muted-foreground">
                        <p className="text-sm">No 3D file available for this part</p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Dimension Validation Dialog — thumbnail + live measurements from the 3D viewer */}
                <DimensionValidationDialog
                  open={validationDialogOpen}
                  onClose={() => setValidationDialogOpen(false)}
                  fileUrl={file3dUrl}
                  fileType={selectedItem.file3dPath?.split('.').pop() ?? ''}
                  screenshot={localScreenshot}
                  dims={cadDimensions}
                  volumeMm3={cadVolumeMm3}
                  surfaceAreaMm2={cadSurfaceArea}
                  material={editablePartData.material}
                  weight={editablePartData.unitWeight}
                  tolerance={editablePartData.toleranceGrade}
                  surfaceFinish={editablePartData.surfaceFinish}
                  densityGcm3={getMaterialDensityGcm3(editablePartData.material)}
                />

                {/* 2D DRAWING VIEWER */}
                {selectedItem.file2dPath && (
                  <div className="border border-border rounded-lg overflow-hidden shadow-md">
                    <div className="bg-muted p-3">
                      <h2 className="text-sm font-semibold">2D Drawing</h2>
                    </div>
                    <div className="bg-card p-4">
                      <div className="h-[600px] bg-secondary border border-border rounded overflow-hidden">
                        {file2dUrl ? (
                          <Viewer2D
                            fileUrl={file2dUrl}
                            fileName={selectedItem.file2dPath.split('/').pop() || selectedItem.name || 'drawing'}
                            fileType={
                              selectedItem.file2dPath.toLowerCase().endsWith('.pdf')
                                ? 'pdf'
                                : ['.png', '.jpg', '.jpeg', '.webp'].some((ext) =>
                                  selectedItem.file2dPath?.toLowerCase().endsWith(ext)
                                )
                                  ? 'img'
                                  : 'other'
                            }
                          />
                        ) : (
                          <div className="h-full flex items-center justify-center text-muted-foreground">
                            <p className="text-sm">Loading 2D drawing...</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Raw Materials Section */}
                <RawMaterialsSection bomItemId={selectedItem.id} bomItem={selectedItem} location={location} />

                {/* Manufacturing Process Section */}
                <ManufacturingProcessSection
                  bomItemId={selectedItem.id}
                  bomItem={selectedItem}
                  location={location}
                  onFeatureHighlight={handleFeatureHighlight}
                  onFeatureFocus={handleFeatureFocus}
                />

                {/* Packaging & Logistics Section */}
                <PackagingLogisticsSection bomItemId={selectedItem.id} />

                {/* Procured Parts Section */}
                <ProcuredPartsSection bomItemId={selectedItem.id} />

                {/* Tooling & Fixtures Section - Moved to last */}
                <ToolingSection bomItemId={selectedItem.id} bomItem={selectedItem} />
              </>
            ) : (
              <div className="text-center py-8 bg-card border-2 border-dashed border-border rounded-lg">
                <p className="text-sm font-medium text-muted-foreground mb-1">No Part Selected</p>
                <p className="text-xs text-muted-foreground">
                  Go to Project Overview tab to select a part for process planning
                </p>
              </div>
            )}
          </TabsContent>

          {/* TAB 3: COST ANALYSIS - For Cost Engineers */}
          <TabsContent value="costing" className="space-y-6">

            {/* ── Export button ── */}
            <div className="flex justify-end">
              <div className="relative">
                <button
                  onClick={() => setExportMenuOpen(v => !v)}
                  disabled={isExporting}
                  className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-md border border-border bg-background hover:bg-muted transition-colors disabled:opacity-50"
                >
                  {isExporting
                    ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    : <Download className="w-3.5 h-3.5" />}
                  {isExporting ? 'Exporting…' : 'Export'}
                </button>

                {exportMenuOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setExportMenuOpen(false)} />
                  <div className="absolute right-0 top-full mt-1 w-56 rounded-md border border-border bg-popover shadow-lg z-50 py-1">
                    <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Selected Part</p>
                    <button onClick={() => exportReport('part', 'pdf')}   className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-muted text-left">
                      <FileTextIcon className="w-3.5 h-3.5 text-muted-foreground" /> Download PDF
                    </button>
                    <button onClick={() => exportReport('part', 'image')} className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-muted text-left">
                      <ImageIcon className="w-3.5 h-3.5 text-muted-foreground" /> Download Image
                    </button>
                    <div className="my-1 border-t border-border" />
                    <p className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Full Report</p>
                    <button onClick={() => exportReport('full', 'pdf')}   className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-muted text-left">
                      <FileTextIcon className="w-3.5 h-3.5 text-muted-foreground" /> Download PDF
                    </button>
                    <button onClick={() => exportReport('full', 'image')} className="w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-muted text-left">
                      <ImageIcon className="w-3.5 h-3.5 text-muted-foreground" /> Download Image
                    </button>
                  </div>
                  </>
                )}
              </div>
            </div>

            {boms.length > 0 ? (
              <div className="space-y-6">
                {/* Show cost analysis for all BOMs or the selected one */}
                {boms.map((bom, index) => {
                  // Only show selected BOM if one is selected, otherwise show first BOM
                  const targetBom = selectedBomId ? (bom.id === selectedBomId ? bom : null) : (index === 0 ? bom : null);
                  if (!targetBom) return null;

                  // Get items for this BOM
                  const currentBomItems = targetBom.id === selectedBomId ? bomItems : [];

                  return (
                    <div key={targetBom.id} id="cost-analysis-full-report" className="space-y-6">
                      {/* Cost Analysis Engine - A-Priori Report */}
                      <CostAnalysisEngine
                        bomId={targetBom.id}
                        bomName={targetBom.name || "Assembly"}
                        itemCount={currentBomItems.length || 2}
                        location={location}
                        {...(selectedItem?.id ? { bomItemId: selectedItem.id } : {})}
                        {...(selectedItem?.thumbnailUrl ? { thumbnailUrl: selectedItem.thumbnailUrl } : {})}
                        {...(selectedItem?.partNumber ? { partNumber: String(selectedItem.partNumber) } : {})}
                        {...((selectedItem?.partName ?? selectedItem?.partNumber) ? { partName: String(selectedItem?.partName ?? selectedItem?.partNumber) } : {})}
                        {...(selectedItem?.material ? { material: selectedItem.material } : {})}
                      />

                      {/* Detailed BOM Cost Report - Part-by-Part Breakdown */}
                      <div className="border-t border-border pt-6">
                        <div className="mb-4">
                          <h3 className="text-lg font-semibold text-foreground">Detailed BOM Cost Breakdown</h3>
                          <p className="text-sm text-muted-foreground">
                            Comprehensive part-by-part cost analysis with raw materials, processes, and margins
                          </p>
                        </div>
                        <BomCostReportWrapper
                          bomId={targetBom.id}
                          bomName={targetBom.name || "Assembly"}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <Card>
                <CardContent className="py-12">
                  <div className="text-center">
                    <DollarSign className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
                    <h3 className="text-lg font-semibold text-foreground mb-2">No BOMs Available</h3>
                    <p className="text-sm text-muted-foreground">
                      Create a BOM in the Project Overview to begin cost analysis
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>

        {/* WORKFLOW NAVIGATION */}
        <WorkflowNavigation
          currentModuleId={activeTab === 'overview' ? 'process' : activeTab === 'process' ? 'process-planning' : 'costing'}
          projectId={projectId}
        />
      </div>
    </div>
  );
}

// Wrapper component with CostDataProvider
export default function ProcessPlanningPage() {
  return (
    <CostDataProvider>
      <ProcessPlanningPageContent />
    </CostDataProvider>
  );
}
