'use client';

import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Box,
  FileText,
  Loader2,
  ChevronDown,
  ChevronRight,
  X,
  CheckCircle2,
  XCircle,
  Clock,
  UploadCloud,
} from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import { apiClient } from '@/lib/api/client';
import { bomItemsApi } from '@/lib/api/bom-items';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

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
  files?: { step?: string; pdf?: string };
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

interface PipelineStage {
  title: string;
  desc: string;
  optional?: boolean;
}

interface FileQueueItem {
  id: string;
  file: File;
  status: 'pending' | 'processing' | 'done' | 'error';
  steps: string[];
  assemblyTree: AssemblyNode[];
  error?: string;
  expanded: boolean;
  pipelineStep: number | null;
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

const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024;
const ACCEPTED_EXTENSIONS = ['.step', '.stp', '.iges', '.igs', '.stl', '.sldprt'];

const PIPELINE_STAGES: PipelineStage[] = [
  { title: 'STEP Parse & Geometry',       desc: 'STEP file → OpenCascade → volume, surface area, holes, walls' },
  { title: 'Material DB Lookup',          desc: 'Density, price/kg from material master' },
  { title: 'Process Classifier',          desc: 'CNC / casting / sheet metal' },
  { title: 'Cost Formulas',              desc: 'Material + machining + setup' },
  { title: 'XGBoost Adjustment',         desc: 'Correction factor from cost history' },
  { title: 'Accurate Cost',              desc: 'Final estimate, ready for quoting' },
  { title: 'LLM Explanation + DFM Advice', desc: 'Runs after costing — never blocks the estimate', optional: true },
];


// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function resolveMaterial(cadAnalysis: any): string {
  const rec =
    cadAnalysis?.dfmAnalysis?.aiInsights?.materialRecommendations?.[0] ??
    cadAnalysis?.dfm_analysis?.ai_insights?.material_recommendations?.[0];
  if (!rec) return 'Aluminum 6061';
  return typeof rec === 'object' ? rec.name ?? 'Aluminum 6061' : String(rec);
}

function resolveVolume(cadAnalysis: any): number {
  return (
    cadAnalysis?.geometryFeatures?.volumeMm3 ??
    cadAnalysis?.geometry_features?.volume_mm3 ??
    0
  );
}

function getTypeColor(type: AssemblyNode['type']): string {
  const map: Record<AssemblyNode['type'], string> = {
    assembly:       'bg-emerald-500/10 text-emerald-700 border-emerald-500/20',
    'sub-assembly': 'bg-blue-500/10 text-blue-700 border-blue-500/20',
    'child-part':   'bg-orange-500/10 text-orange-700 border-orange-500/20',
    part:           'bg-amber-500/10 text-amber-700 border-amber-500/20',
    hardware:       'bg-purple-500/10 text-purple-700 border-purple-500/20',
    fastener:       'bg-gray-500/10 text-gray-700 border-gray-500/20',
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

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
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
  const [fileQueue,    setFileQueue]    = useState<FileQueueItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  // ── Queue helpers ──────────────────────────────────────────────────────────

  const updateItem = useCallback((id: string, patch: Partial<FileQueueItem>) => {
    setFileQueue(prev => prev.map(item => item.id === id ? { ...item, ...patch } : item));
  }, []);

  const addStep = useCallback((id: string, step: string) => {
    setFileQueue(prev =>
      prev.map(item =>
        item.id === id ? { ...item, steps: [...item.steps, step] } : item,
      ),
    );
  }, []);

  const toggleTreeNode = useCallback((fileId: string, nodeId: string) => {
    setFileQueue(prev =>
      prev.map(item =>
        item.id === fileId
          ? { ...item, assemblyTree: toggleNode(nodeId, item.assemblyTree) }
          : item,
      ),
    );
  }, []);

  // ── Dropzone ───────────────────────────────────────────────────────────────

  // ── Single-file processing ─────────────────────────────────────────────────

  const processSingleFile = useCallback(async (item: FileQueueItem): Promise<boolean> => {
    updateItem(item.id, { status: 'processing', steps: [], pipelineStep: 0, expanded: true });

    try {
      addStep(item.id, PROCESSING_STEPS[0]!);
      await delay(300);

      const ext = item.file.name.toLowerCase();
      if (!ACCEPTED_EXTENSIONS.some(e => ext.endsWith(e))) {
        throw new Error(`Invalid format for "${item.file.name}". Supported: ${ACCEPTED_EXTENSIONS.join(', ')}`);
      }
      if (item.file.size > MAX_FILE_SIZE_BYTES) {
        throw new Error(`"${item.file.name}" exceeds 100 MB limit.`);
      }
      if (!bomId) {
        throw new Error('BOM ID is required.');
      }

      addStep(item.id, PROCESSING_STEPS[1]!);

      const formData = new FormData();
      formData.append('stepFile', item.file);
      formData.append('bomId', bomId);
      if (projectId) formData.append('projectId', projectId);

      // Animate pipeline stages while backend processes
      let animPipelineStep = 1;
      let animLogStep = 2;
      const animInterval = setInterval(() => {
        if (animPipelineStep < PIPELINE_STAGES.length - 1) {
          updateItem(item.id, { pipelineStep: animPipelineStep });
          if (animLogStep < PROCESSING_STEPS.length) {
            addStep(item.id, PROCESSING_STEPS[animLogStep]!);
            animLogStep++;
          }
          animPipelineStep++;
        }
      }, 1800);

      let response: any;
      try {
        response = await apiClient.uploadFiles<any>(
          '/bom-items/process-step-file',
          formData,
          { timeout: 120_000 },
        );
      } finally {
        clearInterval(animInterval);
      }

      if (response.success) {
        addStep(item.id, `✓ "${item.file.name}" processed — BOM item created`);
        updateItem(item.id, { status: 'done', assemblyTree: [], pipelineStep: PIPELINE_STAGES.length - 1 });

        if (response.bomItemId) {
          bomItemsApi
            .getFileUrl(response.bomItemId, '3d')
            .then(urlData => {
              const assemblyData: AssemblyData = {
                modelUrl:  urlData?.url ?? '',
                fileName:  item.file.name,
                volume:    resolveVolume(response.cadAnalysis),
                material:  resolveMaterial(response.cadAnalysis),
                bomItemId: response.bomItemId,
              };
              onAssemblyGenerated?.([], assemblyData);
            })
            .catch(() => onAssemblyGenerated?.([]));
        } else {
          onAssemblyGenerated?.([]);
        }
        return true;
      } else {
        addStep(item.id, `⚠ ${response.message ?? 'CAD engine unavailable'}`);
        updateItem(item.id, { status: 'error', error: response.message, pipelineStep: null });
        return false;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      addStep(item.id, `✗ ${msg}`);
      updateItem(item.id, { status: 'error', error: msg, pipelineStep: null });
      return false;
    }
  }, [updateItem, addStep, bomId, projectId, onAssemblyGenerated]);

  // ── Auto-process on drop ───────────────────────────────────────────────────

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (!acceptedFiles.length) return;
    const newItems: FileQueueItem[] = acceptedFiles.map(file => ({
      id: crypto.randomUUID(),
      file,
      status: 'pending',
      steps: [],
      assemblyTree: [],
      expanded: false,
      pipelineStep: null,
    }));
    setFileQueue(prev => [...prev, ...newItems]);

    setIsProcessing(true);
    let errorCount = 0;
    for (const item of newItems) {
      const ok = await processSingleFile(item);
      if (!ok) errorCount++;
    }
    setIsProcessing(false);

    if (errorCount === 0) {
      toast.success(
        `${newItems.length} file${newItems.length > 1 ? 's' : ''} processed`,
        { description: 'BOM items created from assembly structure', duration: 4000 },
      );
    } else {
      toast.warning(`${newItems.length - errorCount} succeeded, ${errorCount} failed`, { duration: 5000 });
    }
  }, [processSingleFile]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/octet-stream': ACCEPTED_EXTENSIONS,
      'application/step':         ['.step', '.stp'],
      'application/x-sldprt':    ['.sldprt'],
    },
    maxSize: MAX_FILE_SIZE_BYTES,
    multiple: true,
  });

  // ── Render helpers ─────────────────────────────────────────────────────────

  const renderAssemblyNode = (fileId: string) => (node: AssemblyNode): React.ReactElement => {
    const hasChildren = (node.children?.length ?? 0) > 0;
    const indentStyle = { paddingLeft: `${14 + node.level * 20}px` };

    return (
      <div key={node.id}>
        <div className="group hover:bg-muted/50 rounded-md transition-colors">
          <div className="flex items-center gap-2 py-1.5 px-2" style={indentStyle}>
            {node.level > 0 && <div className="flex items-center"><div className="w-3 h-px bg-border" /></div>}

            {hasChildren ? (
              <button
                onClick={() => toggleTreeNode(fileId, node.id)}
                className="flex items-center justify-center w-4 h-4 hover:bg-muted rounded"
              >
                {node.expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              </button>
            ) : <div className="w-4" />}

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
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <FileText className="h-3 w-3" />{node.files.pdf}
                </span>
              )}
              {node.files?.step && (
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Box className="h-3 w-3" />{node.files.step}
                </span>
              )}
            </div>
          </div>
        </div>
        {hasChildren && node.expanded && (
          <div>{node.children!.map(renderAssemblyNode(fileId))}</div>
        )}
      </div>
    );
  };

  const pendingCount    = fileQueue.filter(f => f.status === 'pending').length;
  const processingCount = fileQueue.filter(f => f.status === 'processing').length;
  const doneCount       = fileQueue.filter(f => f.status === 'done').length;
  const errorCount      = fileQueue.filter(f => f.status === 'error').length;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className={`p-6 pt-0 space-y-6 ${className ?? ''}`}>

      {/* Dropzone */}
      <div
        {...getRootProps()}
        className={cn(
          'flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed',
          'cursor-pointer transition-colors duration-200 py-10',
          isDragActive
            ? 'border-primary/60 bg-primary/5'
            : 'border-border hover:border-primary/40 hover:bg-muted/40',
        )}
      >
        <input {...getInputProps()} />
        <UploadCloud
          className={cn(
            'w-9 h-9 transition-colors duration-200',
            isDragActive ? 'text-primary' : 'text-muted-foreground',
          )}
        />
        <div className="text-center">
          <p className="text-sm font-medium text-foreground">
            {isDragActive ? 'Release to start CAD processing' : 'Drop STEP / STL files here'}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            or <span className="text-primary underline underline-offset-2">browse</span> to choose files
          </p>
        </div>
        <p className="text-[11px] text-muted-foreground/60">.step · .stp · .stl · .iges · .igs · .sldprt</p>
      </div>

      {/* Items & Parts */}
      {fileQueue.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 text-sm">
              <span className="font-semibold text-foreground">Items &amp; Parts</span>
              <span className="text-muted-foreground">({fileQueue.length})</span>
              {pendingCount > 0    && <Badge variant="secondary">{pendingCount} pending</Badge>}
              {processingCount > 0 && <Badge className="bg-blue-500/10 text-blue-600 border-blue-500/20">{processingCount} processing</Badge>}
              {doneCount > 0       && <Badge className="bg-green-500/10 text-green-600 border-green-500/20">{doneCount} done</Badge>}
              {errorCount > 0      && <Badge className="bg-red-500/10 text-red-600 border-red-500/20">{errorCount} failed</Badge>}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-muted-foreground"
              onClick={() => setFileQueue([])}
              disabled={isProcessing}
            >
              Clear all
            </Button>
          </div>

          {/* File cards */}
          <div className="space-y-2">
            {fileQueue.map(item => (
              <div
                key={item.id}
                className={cn(
                  'rounded-lg border transition-colors',
                  item.status === 'done'       && 'border-green-500/20 bg-green-500/5',
                  item.status === 'error'      && 'border-red-500/20 bg-red-500/5',
                  item.status === 'processing' && 'border-blue-500/20 bg-blue-500/5',
                  item.status === 'pending'    && 'border-border bg-muted/20',
                )}
              >
                {/* Card header row */}
                <div className="flex items-center gap-3 px-4 py-3">
                  {/* Status icon */}
                  <div className="shrink-0">
                    {item.status === 'pending'    && <Clock className="h-4 w-4 text-muted-foreground" />}
                    {item.status === 'processing' && <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />}
                    {item.status === 'done'       && <CheckCircle2 className="h-4 w-4 text-green-500" />}
                    {item.status === 'error'      && <XCircle className="h-4 w-4 text-red-500" />}
                  </div>

                  {/* File info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{item.file.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatBytes(item.file.size)}
                      {item.status === 'error' && item.error && (
                        <span className="text-red-600 ml-2">{item.error}</span>
                      )}
                    </p>
                  </div>

                  {/* Done badge */}
                  {item.status === 'done' && (
                    <Badge variant="outline" className="shrink-0 text-xs border-green-500/30 text-green-600">
                      Assembly created
                    </Badge>
                  )}

                  {/* Expand/collapse for done items */}
                  {(item.status === 'done' || item.status === 'error') && item.pipelineStep !== null && (
                    <button
                      type="button"
                      onClick={() => updateItem(item.id, { expanded: !item.expanded })}
                      className="shrink-0 text-muted-foreground hover:text-foreground"
                    >
                      {item.expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </button>
                  )}

                  {/* Remove (only for non-processing items) */}
                  {item.status !== 'processing' && (
                    <button
                      type="button"
                      onClick={() => setFileQueue(prev => prev.filter(f => f.id !== item.id))}
                      className="shrink-0 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>

                {/* Inline pipeline stepper — shown while processing or after */}
                {item.expanded && item.pipelineStep !== null && (
                  <div className="px-4 pb-4 pt-3 border-t border-border/50">
                    <ol className="space-y-0">
                      {PIPELINE_STAGES.map((stage, i) => {
                        const isActive   = item.pipelineStep === i;
                        const isComplete = item.pipelineStep !== null && i < item.pipelineStep;
                        const isDone     = item.status === 'done';
                        const allDone    = isDone && i <= (item.pipelineStep ?? -1);
                        return (
                          <li key={stage.title} className="flex gap-3 relative">
                            {/* Vertical connector */}
                            {i < PIPELINE_STAGES.length - 1 && (
                              <span
                                className={cn(
                                  'absolute left-[9px] top-[22px] bottom-0 w-px',
                                  (isComplete || allDone) ? 'bg-emerald-500/40' : 'bg-border/40',
                                )}
                              />
                            )}
                            {/* Step circle */}
                            <span
                              className={cn(
                                'relative z-10 mt-1 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border text-[9px] font-bold transition-colors',
                                (isActive && !isDone)  && 'border-blue-500 bg-blue-500/15 text-blue-600',
                                (isComplete || allDone) && 'border-emerald-500 bg-emerald-500/15 text-emerald-600',
                                !isActive && !isComplete && !allDone && 'border-border bg-background text-muted-foreground/40',
                              )}
                            >
                              {isActive && !isDone
                                ? <Loader2 className="h-2.5 w-2.5 animate-spin" />
                                : (isComplete || allDone)
                                ? <CheckCircle2 className="h-2.5 w-2.5" />
                                : i + 1}
                            </span>
                            {/* Label + desc */}
                            <div className="pb-3 last:pb-0 min-w-0">
                              <p className={cn(
                                'text-xs font-semibold flex items-center gap-1.5',
                                (isActive && !isDone)   && 'text-blue-600',
                                (isComplete || allDone) && 'text-emerald-600',
                                !isActive && !isComplete && !allDone && 'text-muted-foreground/40',
                              )}>
                                {stage.title}
                                {stage.optional && (
                                  <span className="text-[9px] font-normal opacity-60 border border-current/30 rounded px-1">async</span>
                                )}
                              </p>
                              <p className={cn(
                                'text-[10px] mt-0.5',
                                (isActive || isComplete || allDone) ? 'text-muted-foreground' : 'text-muted-foreground/30',
                              )}>
                                {stage.desc}
                              </p>
                            </div>
                          </li>
                        );
                      })}
                    </ol>

                    {/* Final success note */}
                    {item.status === 'done' && (
                      <p className="text-xs text-emerald-600 flex items-center gap-1.5 mt-3 pt-3 border-t border-border/40">
                        <CheckCircle2 className="h-3 w-3 shrink-0" />
                        BOM item created — open the BOM table to view and edit it
                      </p>
                    )}
                  </div>
                )}

                {/* Error detail */}
                {item.status === 'error' && item.error && (
                  <div className="px-4 pb-3 border-t border-border/50 pt-2">
                    <p className="text-xs text-red-600">{item.error}</p>
                  </div>
                )}
              </div>
            ))}
          </div>

        </div>
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
