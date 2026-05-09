'use client';

import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Upload,
  Settings,
  Box,
  FileText,
  CircleCheckBig,
  Loader2,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import { apiClient } from '@/lib/api/client';
import { bomItemsApi } from '@/lib/api/bom-items';
import { toast } from 'sonner';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AssemblyNode {
  id: string;
  name: string;
  type: 'assembly' | 'sub-assembly' | 'child-part' | 'part' | 'hardware' | 'fastener';
  partNumber?: string;
  quantity?: number;
  children?: AssemblyNode[];
  files?: {
    step?: string;
    pdf?: string;
  };
  level: number;
  expanded?: boolean;
  bomItemId?: string;
}

interface AssemblyData {
  modelUrl: string;
  fileName: string;
  volume: number;
  material: string;
  bomItemId: string;
}

interface AssemblyTreeGeneratorProps {
  onAssemblyGenerated?: (tree: AssemblyNode[], assemblyData?: AssemblyData) => void;
  className?: string;
  bomId?: string;
  projectId?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROCESSING_STEPS: string[] = [
  'File Validation Layer → STEP file integrity check',
  'CAD Engine → Parse STEP structure using OpenCascade',
  'Assembly Tree Walker → Identify hierarchical relationships',
  'Node Classifier → Assembly / Sub-Assembly / Child Part',
  'BOM Builder → Generate hierarchy + quantities',
  'AI Enrichment Layer → Material, make/buy, description inference',
  'BOM JSON → Supabase integration',
  'Frontend → Render tree in existing BOM UI',
];

const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024; // 100 MB

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Safely resolve a material string from nested CAD analysis responses. */
function resolveMaterial(cadAnalysis: any): string {
  const rec =
    cadAnalysis?.dfmAnalysis?.aiInsights?.materialRecommendations?.[0] ??
    cadAnalysis?.dfm_analysis?.ai_insights?.material_recommendations?.[0];
  if (!rec) return 'Aluminum 6061';
  return typeof rec === 'object' ? rec.name ?? 'Aluminum 6061' : String(rec);
}

/** Safely resolve the geometry volume from a CAD analysis response. */
function resolveVolume(cadAnalysis: any): number {
  return (
    cadAnalysis?.geometryFeatures?.volumeMm3 ??
    cadAnalysis?.geometry_features?.volume_mm3 ??
    0
  );
}

function getTypeColor(type: AssemblyNode['type']): string {
  const map: Record<AssemblyNode['type'], string> = {
    assembly:      'bg-emerald-500/10 text-emerald-700 border-emerald-500/20',
    'sub-assembly': 'bg-blue-500/10 text-blue-700 border-blue-500/20',
    'child-part':  'bg-orange-500/10 text-orange-700 border-orange-500/20',
    part:          'bg-amber-500/10 text-amber-700 border-amber-500/20',
    hardware:      'bg-purple-500/10 text-purple-700 border-purple-500/20',
    fastener:      'bg-gray-500/10 text-gray-700 border-gray-500/20',
  };
  return map[type] ?? 'bg-gray-500/10 text-gray-700 border-gray-500/20';
}

function formatNodeType(type: AssemblyNode['type']): string {
  if (type === 'sub-assembly') return 'Sub-Assembly';
  if (type === 'child-part')   return 'Child Part';
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function toggleNode(nodeId: string, nodes: AssemblyNode[]): AssemblyNode[] {
  return nodes.map(node => {
    if (node.id === nodeId) return { ...node, expanded: !node.expanded };
    if (node.children)      return { ...node, children: toggleNode(nodeId, node.children) };
    return node;
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function AssemblyTreeGenerator({
  onAssemblyGenerated,
  className,
  bomId,
  projectId,
}: AssemblyTreeGeneratorProps) {
  const [isProcessing,    setIsProcessing]    = useState(false);
  const [uploadedFile,    setUploadedFile]    = useState<File | null>(null);
  const [assemblyTree,    setAssemblyTree]    = useState<AssemblyNode[]>([]);
  const [processingSteps, setProcessingSteps] = useState<string[]>([]);

  // ✅ Helper: appends a guaranteed-string step — fixes all three TS2345 errors
  const addStep = (step: string) => setProcessingSteps(prev => [...prev, step]);

  // -------------------------------------------------------------------------
  // Dropzone
  // -------------------------------------------------------------------------

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (file) setUploadedFile(file);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/step': ['.step', '.stp'] },
    maxFiles: 1,
    maxSize: MAX_FILE_SIZE_BYTES,
  });

  // -------------------------------------------------------------------------
  // STEP processing
  // -------------------------------------------------------------------------

  const processStepFile = async () => {
    if (!uploadedFile) return;

    setIsProcessing(true);
    setProcessingSteps([]);

    try {
      // Step 0 — file validation
      addStep(PROCESSING_STEPS[0]!);
      await delay(500);

      const ext = uploadedFile.name.toLowerCase();
      if (!['.step', '.stp', '.iges', '.igs'].some(e => ext.includes(e))) {
        throw new Error('Invalid file format. Please upload a STEP (.step, .stp) or IGES (.iges, .igs) file.');
      }
      if (uploadedFile.size > MAX_FILE_SIZE_BYTES) {
        throw new Error('File too large. Please upload files smaller than 100 MB.');
      }
      if (!bomId) {
        throw new Error('BOM ID is required. Please ensure you are working within a valid BOM context.');
      }

      // Step 1 — CAD engine
      addStep(PROCESSING_STEPS[1]!);
      await delay(800);

      const formData = new FormData();
      formData.append('stepFile', uploadedFile);
      formData.append('bomId', bomId);
      if (projectId) formData.append('projectId', projectId);

      try {
        const response = await apiClient.uploadFiles<any>(
          '/bom-items/process-step-file',
          formData,
          { timeout: 120_000 },
        );

        // Remaining steps
        for (let i = 2; i < PROCESSING_STEPS.length; i++) {
          addStep(PROCESSING_STEPS[i]!);
          await delay(400);
        }

        if (response.success) {
          addStep('STEP file processed successfully');

          const usedDirect = tryDirectAssemblyData(response);
          if (!usedDirect) {
            setTimeout(() => fetchAssemblyWithRetries(response), 3_000);
          }

          toast.success('STEP file processed', {
            description: 'Assembly structure extracted and BOM items created',
            duration: 4_000,
          });
        } else {
          addStep(`Warning: ${response.message}`);
          toast.warning('CAD Engine Required', { description: response.message, duration: 6_000 });
        }

      } catch (apiError: unknown) {
        const msg = apiError instanceof Error ? apiError.message : 'Unknown error';
        addStep(`Backend processing failed: ${msg}`);
        toast.error('Processing failed', {
          description: `Upload error: ${msg}. Check console for details.`,
          duration: 8_000,
        });
      }

    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      addStep(`Error: ${msg}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // ── Direct assembly data (fast path) ────────────────────────────────────

  const tryDirectAssemblyData = (response: any): boolean => {
    if (!response.bomItemId) return false;

    const baseData: Omit<AssemblyData, 'modelUrl'> = {
      fileName:  uploadedFile!.name,
      volume:    resolveVolume(response.cadAnalysis),
      material:  resolveMaterial(response.cadAnalysis),
      bomItemId: response.bomItemId,
    };

    bomItemsApi
      .getFileUrl(response.bomItemId, '3d')
      .then(urlData => {
        const assemblyData: AssemblyData = {
          ...baseData,
          modelUrl: urlData?.url ?? '',
        };
        setAssemblyTree(response.assemblyTree ?? []);
        onAssemblyGenerated?.(response.assemblyTree ?? [], assemblyData);
      })
      // ✅ Fix TS6133: unused `error` binding — use anonymous catch
      .catch(() => {
        setTimeout(() => fetchAssemblyWithRetries(response), 2_000);
      });

    return true;
  };

  // ── Retry-based BOM fetch (slow path) ───────────────────────────────────

  const fetchAssemblyWithRetries = async (
    response: any,
    attempt   = 1,
    maxAttempts = 5,
  ): Promise<void> => {
    try {
      const bomItemsData = await apiClient.get<{ items: any[] }>(`/bom-items?bomId=${bomId}`);

      // Prefer the most-recently-created assembly
      const byCreated = (a: any, b: any) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();

      let mainItem =
        bomItemsData.items.filter((i: any) => i.itemType === 'assembly').sort(byCreated)[0] ??
        bomItemsData.items.find((i: any) =>
          i.file3dPath &&
          i.partNumber?.includes(uploadedFile!.name.replace(/\.(step|stp|iges|igs)$/i, '').slice(0, 8)),
        ) ??
        bomItemsData.items.sort(byCreated)[0];

      if (mainItem?.id) {
        try {
          const fileUrlData = await bomItemsApi.getFileUrl(mainItem.id, '3d');

          const assemblyData: AssemblyData = {
            modelUrl:  fileUrlData.url,
            fileName:  uploadedFile!.name,
            volume:    resolveVolume(response.cadAnalysis),
            material:  resolveMaterial(response.cadAnalysis),
            bomItemId: mainItem.id,
          };

          setAssemblyTree(response.assemblyTree ?? []);
          onAssemblyGenerated?.(response.assemblyTree ?? [], assemblyData);
          return;
        } catch {
          // File URL unavailable — fall through to tree-only callback
        }
      }

      setAssemblyTree(response.assemblyTree ?? []);
      onAssemblyGenerated?.(response.assemblyTree ?? []);

    } catch {
      if (attempt < maxAttempts) {
        setTimeout(() => fetchAssemblyWithRetries(response, attempt + 1, maxAttempts), attempt * 1_000);
        return;
      }
      setAssemblyTree(response.assemblyTree ?? []);
      onAssemblyGenerated?.(response.assemblyTree ?? []);
    }
  };

  // -------------------------------------------------------------------------
  // Render helpers
  // -------------------------------------------------------------------------

  const renderAssemblyNode = (node: AssemblyNode): React.ReactElement => {
    const hasChildren  = (node.children?.length ?? 0) > 0;
    const indentStyle  = { paddingLeft: `${14 + node.level * 20}px` };

    return (
      <div key={node.id}>
        <div className="group hover:bg-muted/50 rounded-md transition-colors">
          <div className="flex items-center gap-2 py-1.5 px-2" style={indentStyle}>
            {node.level > 0 && <div className="flex items-center"><div className="w-3 h-px bg-border" /></div>}

            {hasChildren ? (
              <button
                onClick={() => setAssemblyTree(prev => toggleNode(node.id, prev))}
                className="flex items-center justify-center w-4 h-4 hover:bg-muted rounded"
              >
                {node.expanded
                  ? <ChevronDown  className="h-3 w-3" />
                  : <ChevronRight className="h-3 w-3" />}
              </button>
            ) : (
              <div className="w-4" />
            )}

            <div className="flex-1 min-w-0 flex items-center gap-2">
              <p className="text-sm font-medium truncate">
                {node.name}
                {node.quantity != null && ` (Qty: ${node.quantity})`}
              </p>
              <Badge variant="outline" className={`text-[10px] px-1.5 py-0 h-4 ${getTypeColor(node.type)}`}>
                {formatNodeType(node.type)}
              </Badge>
              {node.partNumber && (
                <span className="text-xs text-muted-foreground">#{node.partNumber}</span>
              )}
            </div>

            <div className="flex items-center gap-4 text-xs">
              {node.files?.pdf && (
                <button className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors">
                  <FileText className="h-3 w-3" />
                  <span>{node.files.pdf}</span>
                </button>
              )}
              {node.files?.step && (
                <button className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors">
                  <Box className="h-3 w-3" />
                  <span>{node.files.step}</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {hasChildren && node.expanded && (
          <div>{node.children!.map(renderAssemblyNode)}</div>
        )}
      </div>
    );
  };

  // -------------------------------------------------------------------------
  // Main render
  // -------------------------------------------------------------------------

  return (
    <div className={`p-6 pt-0 space-y-6 ${className ?? ''}`}>

      {/* ── Dropzone ─────────────────────────────────────────────────────── */}
      <div
        {...getRootProps()}
        className={[
          'border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer',
          isDragActive
            ? 'border-primary bg-primary/5'
            : 'border-muted-foreground/25 hover:border-primary/50',
        ].join(' ')}
      >
        <input {...getInputProps()} />
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
            <Upload className="h-8 w-8 text-primary" />
          </div>
          <div>
            <h3 className="text-lg font-semibold">Upload STEP File</h3>
            <p className="text-sm text-muted-foreground mt-1">
              {isDragActive ? 'Drop the file here' : 'Drop your STEP file here or click to browse'}
            </p>
          </div>
          <Button variant="outline" className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Choose STEP File
          </Button>
          <p className="text-xs text-muted-foreground">Supports .step, .stp files up to 100 MB</p>
          {uploadedFile && (
            <p className="text-sm text-green-600 font-medium">Selected: {uploadedFile.name}</p>
          )}
        </div>
      </div>

      {/* ── Processing pipeline info ─────────────────────────────────────── */}
      <Card className="bg-muted/30 p-4">
        <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
          <Settings className="h-4 w-4" />
          CAD Processing Pipeline
        </h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          {[
            { color: 'bg-blue-500',    label: 'STEP file to OpenCascade to volume, surface area, holes, walls' },
            { color: 'bg-green-500',   label: 'Material DB lookup for density, price/kg' },
            { color: 'bg-yellow-500',  label: 'Process classifier for CNC / casting / sheet metal' },
            { color: 'bg-purple-500',  label: 'Cost formulas for material + machining + setup' },
            { color: 'bg-red-500',     label: 'XGBoost adjustment with correction factor from history' },
            { color: 'bg-emerald-500', label: 'ACCURATE COST', bold: true },
          ].map(({ color, label, bold }) => (
            <div key={label} className="flex items-center gap-3">
              <div className={`w-2 h-2 rounded-full ${color}`} />
              <span className={bold ? 'font-semibold' : ''}>{label}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 pt-3 border-t border-border">
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-indigo-500" />
            <span className="text-xs">LLM (optional, async) for explanation + DFM advice</span>
          </div>
        </div>
      </Card>

      {/* ── Process button ───────────────────────────────────────────────── */}
      {uploadedFile && assemblyTree.length === 0 && (
        <div className="flex justify-center">
          <Button onClick={processStepFile} disabled={isProcessing} size="lg" className="px-8">
            {isProcessing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processing STEP File...
              </>
            ) : (
              <>
                <Box className="mr-2 h-4 w-4" />
                Generate Assembly Tree
              </>
            )}
          </Button>
        </div>
      )}

      {/* ── Processing steps log ─────────────────────────────────────────── */}
      {isProcessing && (
        <Alert className="bg-blue-50 border-blue-200">
          <CircleCheckBig className="h-4 w-4 text-blue-500" />
          <AlertDescription className="text-blue-700">
            <div className="space-y-1">
              {processingSteps.map((step, i) => <p key={i}>{step}</p>)}
              {processingSteps.length < PROCESSING_STEPS.length && (
                <p className="flex items-center gap-2">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Processing...
                </p>
              )}
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* ── Assembly tree ────────────────────────────────────────────────── */}
      {assemblyTree.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-lg font-semibold flex items-center gap-2">
              <Box className="h-5 w-5" />
              Assembly Tree Structure
            </h4>
            <Badge variant="outline" className="text-xs">Auto-Generated from STEP</Badge>
          </div>

          <div className="space-y-0.5 bg-muted/20 rounded-lg p-4">
            {assemblyTree.map(renderAssemblyNode)}
          </div>
        </div>
      )}

      {/* ── Success info ─────────────────────────────────────────────────── */}
      {assemblyTree.length > 0 && (
        <Alert className="bg-blue-50 border-blue-200">
          <CircleCheckBig className="h-5 w-5 text-blue-500" />
          <div>
            <h4 className="text-sm font-medium text-blue-900 mb-1">
              Automated BOM Generation Process
            </h4>
            <div className="text-xs text-blue-700 space-y-1">
              {PROCESSING_STEPS.map(step => <p key={step}>{step}</p>)}
            </div>
          </div>
        </Alert>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tiny util
// ---------------------------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}