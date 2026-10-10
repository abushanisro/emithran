'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useDropzone } from 'react-dropzone';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Command,
  CommandGroup,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  FileText,
  Package,
  AlertTriangle,
  CheckCircle,
  Info,
  XCircle,
  Loader2,
  HelpCircle,
  ChevronsUpDown,
  Plus,
  Check,
  X,
  DollarSign,
} from 'lucide-react';
import { toast } from 'sonner';
import { createBOMItem, updateBOMItem, analyzeForAutoFill, measureForAutoFill, type AutoFillResponse } from '@/lib/api/hooks/useBOMItems';
import { familyToProcessGroupLabel, processGroupOptionsFrom, processGroupToFamilyHint, processesForMaterialGroups } from '@/lib/features/process-group';
import { useProcessCalculatorMappings } from '@/lib/api/hooks/useProcessCalculatorMappings';
import type { DrawingAnalysisResult } from '@/lib/api/vave';
import { BOMItemType, ITEM_TYPE_LABELS } from '@/lib/types/bom.types';
import { apiClient } from '@/lib/api/client';
import { useQueryClient, useQuery, keepPreviousData } from '@tanstack/react-query';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────


interface RawMaterial {
  id?: string;
  materialName?: string;
  materialGrade?: string;
  material?: string;
  materialGroup?: string;
  materialType?: string;
  materialDescription?: string;
  description?: string;
  density?: number;
  densityKgM3?: number;
  unitCost?: number;
  cost?: number;
  currency?: string;
  ultimateTensileStrength?: number;
  ultimate_tensile_strength?: number;
  yieldTensileStrength?: number;
  yield_tensile_strength?: number;
  shearingStrength?: number;
  shearing_strength?: number;
  astmStandard?: string;
  astm_standard?: string;
  dinStandard?: string;
  din_standard?: string;
  enStandard?: string;
  en_standard?: string;
  jisStandard?: string;
  jis_standard?: string;
}

interface RawMaterialsResponse {
  items: RawMaterial[];
}


type EnhancedBOMError = {
  category: 'validation' | 'duplication' | 'hierarchy' | 'fileupload' | 'network' | 'permission' | 'business' | 'data';
  severity: 'low' | 'medium' | 'high' | 'critical';
  userMessage: string;
  technicalMessage?: string | undefined;
  suggestion: string;
  actionable: boolean;
  recoverable: boolean;
  helpUrl?: string | undefined;
  affectedFields?: string[] | undefined;
};

// ─── Multi-file upload types ──────────────────────────────────────────────────

interface PendingFile {
  id: string;
  file: File;
  status: 'pending' | 'analyzing' | 'ready' | 'error';
  result?: AutoFillResponse;
  error?: string;
  // Manual process override — the SAME real process_group label shown in the
  // Process field below (not a raw cad-engine family string); when set, it is
  // mapped through processGroupToFamilyHint and re-analysis is forced to
  // that family via cad-engine's family_hint instead of the real geometric
  // classifier chain. Undefined = auto-detected.
  familyOverride?: string | undefined;
}

// A chosen process group -> the cad-engine family_hint that runs its
// extractor: processGroupToFamilyHint (lib/features/process-group.ts),
// derived from the one shared family<->group table. A group with no CAD
// extractor (Assembly, Forging, ...) can still be picked as the item's
// Process; it sends no family_hint, so the real classifier chain runs.

// The inverse of processGroupToFamilyHint, for displaying what the CAD
// engine auto-detected (suggestions.familyClassification, always present
// once any family was detected) as its real process_group label — NOT the
// server's own suggestions.processType, which is gated on process_taxonomy's
// roadmap_status='production' (resolveDbDrivenProcessLabel,
// auto-fill.service.ts). Confirmed live: Machining's 43 real stations are
// seeded roadmap_status='not_modeled' (migration 691 -- a real, disclosed
// taxonomy-layer gap, separate from cost-cnc-engine.ts's own real, tested,
// live-wired CNC costing), so processType is null for every milled/turned/
// mill_turn part even though the CAD engine extracted it correctly --
// that null was leaving this dropdown looking unset/broken for the single
// most common family. Shared with the manufacturing-intelligence page's own
// "Process Group" display (lib/features/process-group.ts) so the identical
// classification never shows different text ("Milled" here vs "Machining"
// there) in two different places.
const familyToProcessLabel = familyToProcessGroupLabel;


// Resolves the Process field's value when opening an EXISTING item to edit.
// There is no persisted processType column at all (confirmed: absent from
// both CreateBOMItemDto and UpdateBOMItemDto) — the real, persisted field is
// familyClassification (bom_items.family_classification), which
// bom-items.service.ts auto-derives from the saved featureGraph's own
// classification.family on every create/update. Mapped through the same
// FAMILY_HINT_TO_PROCESS_GROUP as a fresh analysis, so a reopened item shows
// the same label it was created with, not a blank field.
function resolveStoredProcessLabel(item: { familyClassification?: string } | null | undefined): string {
  return familyToProcessLabel(item?.familyClassification) ?? '';
}

// Resolves what a dropdown should show as "currently selected" for a given
// pending file: the manual override if one was set, else resolveProcessLabel
// for its own result, else '' (shows the placeholder — no selectable
// "Auto-detect" item; once a file is analyzed this always resolves to a real
// process name, never a reset-to-auto state).
function resolveProcessDropdownValue(pf: PendingFile): string {
  // The process is chosen -- by the engineer, or from the material -- never
  // taken from the CAD engine's own family guess (see handleFileDrop).
  return pf.familyOverride ?? '';
}


// ─── Error Categorization ─────────────────────────────────────────────────────

function categorizeBOMError(error: unknown): EnhancedBOMError {
  const err = error as Record<string, unknown>;
  const errorMessage = (typeof err?.message === 'string' ? err.message : '').toLowerCase();
  const statusCode = (err?.status ?? err?.code) as number | undefined;

  if (errorMessage.includes('validation') || errorMessage.includes('required') || statusCode === 400) {
    return {
      category: 'validation',
      severity: 'high',
      userMessage: 'Invalid BOM Data',
      technicalMessage: err?.message as string | undefined,
      suggestion: 'Please review all required fields and ensure values are within acceptable ranges',
      actionable: true,
      recoverable: true,
      helpUrl: '/help/bom-validation',
      affectedFields: (err?.fields as string[]) ?? []
    };
  }

  if (errorMessage.includes('duplicate') || errorMessage.includes('unique') || statusCode === 409) {
    return {
      category: 'duplication',
      severity: 'medium',
      userMessage: 'Duplicate Item Detected',
      suggestion: 'Use a different part number or update the existing item instead',
      actionable: true,
      recoverable: true,
      helpUrl: '/help/part-numbering'
    };
  }

  if (errorMessage.includes('parent') || errorMessage.includes('hierarchy') || errorMessage.includes('circular')) {
    return {
      category: 'hierarchy',
      severity: 'high',
      userMessage: 'Invalid BOM Structure',
      suggestion: 'Check parent-child relationships and avoid circular dependencies',
      actionable: true,
      recoverable: true
    };
  }

  if (errorMessage.includes('file') || errorMessage.includes('upload') || errorMessage.includes('size') || errorMessage.includes('format')) {
    const severity = errorMessage.includes('size') || errorMessage.includes('format') ? 'medium' : 'low';
    return {
      category: 'fileupload',
      severity,
      userMessage: 'File Upload Issue',
      suggestion: 'Check file size (max 100MB) and format (PDF, DXF, DWG, STEP, STL, images)',
      actionable: true,
      recoverable: true
    };
  }

  if (errorMessage.includes('permission') || errorMessage.includes('forbidden') || statusCode === 403) {
    return {
      category: 'permission',
      severity: 'medium',
      userMessage: 'Access Denied',
      suggestion: 'Contact your administrator for BOM editing permissions',
      actionable: false,
      recoverable: false
    };
  }

  if (errorMessage.includes('network') || errorMessage.includes('timeout') || (statusCode !== undefined && statusCode >= 500)) {
    return {
      category: 'network',
      severity: 'critical',
      userMessage: 'Connection Problem',
      suggestion: 'Check your internet connection and try again',
      actionable: true,
      recoverable: true
    };
  }

  if (errorMessage.includes('business') || errorMessage.includes('rule') || errorMessage.includes('constraint')) {
    return {
      category: 'business',
      severity: 'medium',
      userMessage: 'Business Rule Violation',
      suggestion: 'Review manufacturing constraints and BOM policies',
      actionable: true,
      recoverable: true
    };
  }

  if (errorMessage.includes('not found') || statusCode === 404) {
    return {
      category: 'data',
      severity: 'low',
      userMessage: 'Data Not Found',
      suggestion: 'The item may have been deleted or moved. Please refresh and try again.',
      actionable: true,
      recoverable: false
    };
  }

  return {
    category: 'data',
    severity: 'medium',
    userMessage: 'Unexpected Error',
    technicalMessage: err?.message as string | undefined,
    suggestion: 'Please try again. If the problem persists, contact support.',
    actionable: true,
    recoverable: true
  };
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface BOMItemDialogProps {
  bomId: string;
  item?: any;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  parentItemId?: string | null;
  defaultItemType?: BOMItemType;
  getAutoParent?: (type: BOMItemType) => string | null;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Production runs per year, mirroring the backend BATCHES_PER_YEAR in
 * costing/shared/physics/costing-inputs.ts. This dialog only uses it to offer
 * the Batch Production field as a convenience view of the same number; the
 * batch size that costing actually uses is resolved server-side by
 * resolveCostingInputs, never from this field.
 *
 * Provenance: a stated planning policy (quarterly releases), not measured
 * manufacturing data and not sourced reference data. It is a scheduling
 * assumption, and it applies only when a real annual volume exists.
 */
const BATCHES_PER_YEAR = 4;


// Which upstream source filled a field, rendered as a small tag beside its
// label. Module scope on purpose: a component declared inside another gets a
// fresh identity every render, and React remounts rather than updates it.
const AutoBadgeFor = React.memo(function AutoBadgeFor({
  field,
  autoFilledFields,
  fieldLineage,
}: {
  field: string;
  autoFilledFields: Set<string>;
  fieldLineage: Record<string, { source: string }>;
}) {
  if (!autoFilledFields.has(field)) return null;
  const lineage = fieldLineage[field];
  if (!lineage) return null;
  if (lineage.source === 'derived') {
    return (
      <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 text-purple-400 border-purple-400/40 ml-1">
        DERIVED
      </Badge>
    );
  }
  if (lineage.source === 'drawing') {
    return (
      <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 text-blue-500 border-blue-400/40 ml-1">
        DRAWING
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 text-cyan-500 border-cyan-400/40 ml-1">
      CAD
    </Badge>
  );
});

export function BOMItemDialog({
  bomId,
  item,
  open,
  onOpenChange,
  onSuccess,
  parentItemId,
  defaultItemType,
  getAutoParent
}: BOMItemDialogProps) {
  const queryClient = useQueryClient();

  const [materialOpen, setMaterialOpen] = useState(false);
  const [materialSearch, setMaterialSearch] = useState('');
  const [debouncedMaterialSearch, setDebouncedMaterialSearch] = useState('');
  const [activeResult, setActiveResult] = useState<AutoFillResponse | null>(null);

  // Debounce material name search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedMaterialSearch(materialSearch), 500);
    return () => clearTimeout(timer);
  }, [materialSearch]);

  // Shared error handler for raw-materials queries
  const handleMaterialQueryError = async (
    error: unknown,
    endpoint: string,
    params: Record<string, unknown>,
  ): Promise<RawMaterialsResponse> => {
    const err = error as Record<string, unknown>;
    if (typeof err?.message === 'string' && err.message.includes('failed to parse logic tree') && params.search) {
      const fallbackParams = { ...params };
      delete fallbackParams.search;
      return (await apiClient.get(endpoint, { params: fallbackParams })) as RawMaterialsResponse;
    }
    if (typeof err?.message === 'string' &&
      (err.message.includes('Circuit breaker is OPEN') ||
        err.message.includes('does not exist') ||
        err.message.includes('column'))) {
      return { items: [] };
    }
    throw error;
  };

  const materialQueryRetry = (failureCount: number, error: unknown): boolean => {
    const err = error as Record<string, unknown>;
    if (typeof err?.message === 'string' &&
      (err.message.includes('Circuit breaker is OPEN') ||
        err.message.includes('does not exist') ||
        err.message.includes('column'))) {
      return false;
    }
    return failureCount < 2;
  };

  // Query A — unique material names, across the full raw_materials database.
  // No category filter: a prior category selector here (removed) once
  // defaulted an auto-classified injection-molded part to FERROUS_NON_FERROUS
  // and made every real plastic grade unsearchable no matter what was typed
  // — a confirmed live bug, 2026-09-10.
  const { data: rawMaterialsData, isLoading: isLoadingMaterials, isFetching: isFetchingMaterials } = useQuery<RawMaterialsResponse>({
    queryKey: ['raw-materials-names', debouncedMaterialSearch],
    queryFn: async (): Promise<RawMaterialsResponse> => {
      const endpoint = '/raw-materials/enhanced';
      const params: Record<string, unknown> = { limit: 1000 };
      if (debouncedMaterialSearch?.trim()) params.search = debouncedMaterialSearch.trim();
      try {
        return (await apiClient.get(endpoint, { params })) as RawMaterialsResponse;
      } catch (error: unknown) {
        return handleMaterialQueryError(error, endpoint, params);
      }
    },
    enabled: true,
    placeholderData: keepPreviousData,
    staleTime: 1000 * 60 * 5,
    retry: materialQueryRetry,
    retryDelay: (attemptIndex: number) => Math.min(1000 * 2 ** attemptIndex, 30000),
  });

  // Unique material NAME options (for the Material dropdown), in the SERVER's
  // own real relevance order (findAll/getEnhancedMaterials ranks exact ->
  // designation -> alias matches via orderByRelevance) — never re-sorted
  // alphabetically, which would throw that real ranking away.
  const materialNameOptions = useMemo((): string[] => {
    if (!rawMaterialsData?.items) return [];
    const seen = new Set<string>();
    return rawMaterialsData.items
      .map((m: RawMaterial) => (m.materialName ?? m.material ?? '').trim())
      .filter((name: string) => {
        if (!name || seen.has(name)) return false;
        seen.add(name);
        return true;
      });
  }, [rawMaterialsData]);

  // Process dropdown options — every real process_group heading from the
  // same live process_taxonomy/process_calculator_mappings data the Process
  // Catalog page itself reads (reused via this existing hook, which already
  // auto-paginates past the backend's 1000-row page cap), never a hardcoded
  // list. Not filtered to 'production'/active rows: the user wants the full
  // catalog of primary manufacturing domains here, staged ones included.
  //
  // Three groups are deliberately excluded, not because they are inactive
  // (several included groups are 100% inactive too, e.g. Die Casting, Sand
  // Casting) but because they are cross-cutting secondary/post-processing
  // steps common to every route regardless of which primary process was
  // picked here, not a primary process choice themselves — they are applied
  // separately (the real reference-data pipeline behind /secondary-processes).
  const { data: processMappingsData } = useProcessCalculatorMappings();
  const processGroupOptions = useMemo(
    () => processGroupOptionsFrom(processMappingsData?.mappings),
    [processMappingsData],
  );

  // The server's result set for the (debounced) search term IS the match
  // set — the server already does real alias- and spelling-variant-aware
  // matching (material-search-spelling.ts: "aluminum"/"aluminium" etc, see
  // buildMaterialSearchOrClause). A SECOND, plain-substring re-filter here
  // against the raw keystroke text used to silently discard every one of
  // those real matches the moment the live text diverged from a dumb ILIKE
  // check (e.g. "ALUMINIUM" vs the DB's real "Aluminum"-spelled rows) —
  // live-reproduced 2026-10-01, confirmed via a direct call to
  // /raw-materials/enhanced?search=ALUMINIUM, which already returns the real
  // rows; the UI was the only thing throwing them away. Industry practice
  // for a re-query (server-driven) typeahead is explicit on this: once each
  // keystroke re-queries the server, the response IS the result set and all
  // filtering happens server-side — never re-filtered client-side on top.
  const materialOptionMatches = materialNameOptions;
  // True while the visible list may not reflect the latest keystroke yet
  // (debounce still pending, or the debounced query is in flight) — gates
  // the "No matches" / "Use as custom" messaging so neither ever fires
  // against a stale or incomplete result.
  const isMaterialSearchPending =
    materialSearch.trim() !== debouncedMaterialSearch.trim() || isFetchingMaterials;

  // Virtualized rendering (windowing): only the rows actually scrolled into
  // view are ever mounted, so the list can be arbitrarily long (the full
  // raw_materials table, hundreds+ of rows) without the cost that made this
  // field lag and drop keystrokes before -- rendering up to a thousand
  // mounted DOM rows on every keystroke with Command's own filtering off
  // (shouldFilter={false}; the real search is the debounced server query
  // above). Fixed row height keeps the math exact and simple.
  const MATERIAL_ROW_HEIGHT_PX = 36;
  const MATERIAL_LIST_HEIGHT_PX = 240;
  const MATERIAL_ROW_OVERSCAN = 6;
  const [materialListScrollTop, setMaterialListScrollTop] = useState(0);
  // A narrower search can leave the old scroll offset pointing past the new,
  // shorter list -- reset to the top whenever the match set changes.
  useEffect(() => { setMaterialListScrollTop(0); }, [materialOptionMatches]);
  const materialVisibleRange = useMemo(() => {
    const start = Math.max(0, Math.floor(materialListScrollTop / MATERIAL_ROW_HEIGHT_PX) - MATERIAL_ROW_OVERSCAN);
    const count = Math.ceil(MATERIAL_LIST_HEIGHT_PX / MATERIAL_ROW_HEIGHT_PX) + MATERIAL_ROW_OVERSCAN * 2;
    const end = Math.min(materialOptionMatches.length, start + count);
    return { start, end };
  }, [materialListScrollTop, materialOptionMatches.length]);

  const [loading, setLoading] = useState(false);
  const [autoParentId, setAutoParentId] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<{ file2d?: number; file3d?: number }>({});
  const [showHelp, setShowHelp] = useState<Record<string, boolean>>({});
  // ── Multi-file / auto-fill state ──────────────────────────────────────────
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [activeFileId, setActiveFileId] = useState<string | null>(null);
  const [autoFilledFields, setAutoFilledFields] = useState<Set<string>>(new Set());
  const [isBatchCreating, setIsBatchCreating] = useState(false);
  const lastAnalyzedHashRef = useRef<string | null>(null);
  const drawing2dAnalysisRef = useRef<Promise<void> | null>(null);
  const [isAnalyzing2d, setIsAnalyzing2d] = useState(false);
  const itemRef = useRef(item);
  type FieldLineage = { source: 'cad' | 'drawing' | 'derived'; inputs?: string[] };
  const [fieldLineage, setFieldLineage] = useState<Record<string, FieldLineage>>({});
  const [, setFieldConfidences] = useState<Record<string, number>>({});
  const [formData, setFormData] = useState({
    name: '',
    partNumber: '',
    description: '',
    itemType: defaultItemType || ('' as BOMItemType),
    quantity: 1,
    annualVolume: null as number | null,
    unit: 'pcs',
    material: '',
    materialGrade: '',
    makeBuy: 'make' as 'make' | 'buy',
    unitCost: '',
    bomLevel: '',
    volume: 0,
    weight: 0,
    maxLength: 0,
    maxWidth: 0,
    maxHeight: 0,
    surfaceArea: 0,
    sheetThicknessMm: 0,
    bendCount: 0,
    holeCount: 0,
    cutLengthMm: 0,
    pierceCount: 0,
    flatPatternAreaMm2: 0,
    processType: '',
    materialSource: '',
    materialConfidence: 0,
    // Drawing intelligence — persisted from 2D drawing analysis
    coating: '',
    heatTreatment: '',
    surfaceFinishRa: 0,
    surfaceFinishConfidence: 0,
    complexity: '',
    tightestToleranceMm: 0,
    toleranceConfidence: 0,
    drawingIntelligence: null as import('@/lib/api/vave').DrawingAnalysisResult | null,
    file2d: null as File | null,
    file3d: null as File | null,
  });

  const formDataRef = useRef(formData);
  formDataRef.current = formData; // keep ref in sync every render so async handlers see latest state

  // Who set Process: the engineer ('user') or the chosen material ('material').
  // A material only ever fills Process the engineer has not set themselves.
  const [processSource, setProcessSource] = useState<'user' | 'material' | null>(null);
  // Processes the chosen material belongs to when it is more than one: shown
  // so the engineer picks (a sheet / bar grade serves Machining, Sheet Metal, ...).
  const [materialProcessChoices, setMaterialProcessChoices] = useState<string[]>([]);
  // process_material_groups (migration 879): which processes each material group serves.
  const { data: processMaterialLinks } = useQuery<Array<{ processGroup: string; materialGroup: string }>>({
    queryKey: ['process-material-groups'],
    queryFn: () => apiClient.get('/raw-materials/process-material-groups'),
    staleTime: 1000 * 60 * 30,
  });

  useEffect(() => { itemRef.current = item; }, [item]);

  const calculateCompletionPercentage = () => {
    const requiredFields = ['name', 'partNumber', 'quantity', 'annualVolume', 'itemType'];
    const optionalFields = ['description', 'material', 'weight'];
    let completed = 0;
    let total = requiredFields.length + optionalFields.length;

    requiredFields.forEach(field => {
      if (formData[field as keyof typeof formData] && String(formData[field as keyof typeof formData]).trim()) {
        completed += 2;
      }
      total += 1;
    });
    optionalFields.forEach(field => {
      if (formData[field as keyof typeof formData] && String(formData[field as keyof typeof formData]).trim()) {
        completed += 1;
      }
    });
    return Math.round((completed / total) * 100);
  };

  const validationStatus = useMemo(() => {
    const errors: Record<string, string> = {};

    if (!formData.name.trim()) {
      errors.name = 'Item name is required';
    } else if (formData.name.length < 3) {
      errors.name = 'Name must be at least 3 characters';
    } else if (formData.name.length > 100) {
      errors.name = 'Name must not exceed 100 characters';
    }

    if (!formData.partNumber.trim()) {
      errors.partNumber = 'Part number is required';
    } else if (formData.partNumber.length < 2) {
      errors.partNumber = 'Part number must be at least 2 characters';
    } else if (formData.partNumber.length > 50) {
      errors.partNumber = 'Part number must not exceed 50 characters';
    }

    if (formData.quantity <= 0) {
      errors.quantity = 'Quantity must be greater than 0';
    } else if (formData.quantity > 10000) {
      errors.quantity = 'Quantity seems unusually high. Please verify.';
    }

    if (formData.annualVolume == null) {
      errors.annualVolume = 'Annual volume is required — it sets batch size and route economics';
    } else if (formData.annualVolume <= 0) {
      errors.annualVolume = 'Annual volume must be greater than 0';
    } else if (formData.annualVolume > 10000000) {
      errors.annualVolume = 'Annual volume seems extremely high. Please verify.';
    }

    if (formData.weight && formData.weight < 0) {
      errors.weight = 'Weight cannot be negative';
    } else if (formData.weight && formData.weight > 10000) {
      errors.weight = 'Weight seems extremely high for a component';
    }

    if (formData.maxLength && formData.maxLength < 0) errors.maxLength = 'Length cannot be negative';
    if (formData.maxWidth && formData.maxWidth < 0) errors.maxWidth = 'Width cannot be negative';
    if (formData.maxHeight && formData.maxHeight < 0) errors.maxHeight = 'Height cannot be negative';
    if (formData.surfaceArea && formData.surfaceArea < 0) errors.surfaceArea = 'Surface area cannot be negative';

    const unitCostNum = parseFloat(formData.unitCost) || 0;
    if (formData.makeBuy === 'buy' && (!formData.unitCost || unitCostNum <= 0)) {
      errors.unitCost = 'Unit cost is required for purchased items';
    } else if (formData.makeBuy === 'buy' && unitCostNum > 1000000) {
      errors.unitCost = 'Unit cost seems extremely high. Please verify.';
    }

    if (formData.file2d && formData.file2d.size > 100 * 1024 * 1024) {
      errors.file2d = 'File size must be less than 100MB';
    }

    if (formData.file3d && formData.file3d.size > 25 * 1024 * 1024) {
      errors.file3d = 'File size must be less than 25MB';
    }

    return {
      errors,
      isValid: Object.keys(errors).length === 0,
      completionPercentage: calculateCompletionPercentage()
    };
  }, [formData]);

  // Read straight off the memo, NOT mirrored into state.
  //
  // This used to be a useState fed by an effect on [validationStatus.errors].
  // validationStatus is a useMemo returning a fresh object literal, so
  // `.errors` had a new identity on every keystroke, the effect's reference
  // comparison always saw a change, and it called setValidationErrors with a
  // value that was already derivable -- committing a SECOND full render of
  // this ~2000-line dialog for every character typed in any field.
  //
  // Nothing else ever wrote it, so it was pure duplication of state that
  // already exists. Declared here (rather than replacing all its call sites)
  // so the ~12 reads below stay exactly as they were.
  const validationErrors = validationStatus.errors;


  // ── Auto-fill helpers ─────────────────────────────────────────────────────

  const populateFormFromResult = useCallback((r: AutoFillResponse) => {
    // Weight validation: compare CAD weight against existing BOM weight
    const cadWeight = r.geometry.weight;
    const existingWeight = itemRef.current?.weight ?? 0;
    if (existingWeight > 0 && cadWeight > 0) {
      const deviation = Math.abs(cadWeight - existingWeight) / existingWeight;
      if (deviation > 0.25) {
        toast.warning('Weight mismatch detected', {
          description: `CAD reports ${cadWeight.toFixed(3)} kg, BOM has ${existingWeight.toFixed(3)} kg (${Math.round(deviation * 100)}% difference). Verify material assignment.`,
          duration: 8000,
        });
      }
    }

    const filled = new Set<string>();
    setFormData(prev => {
      const patch: Partial<typeof prev> = {};
      // Name and part number always come from filename — safe regardless of CAD state
      if (!prev.name) { patch.name = r.suggestions.name; filled.add('name'); }
      if (!prev.partNumber) { patch.partNumber = r.suggestions.partNumber; filled.add('partNumber'); }
      // Geometry fields. A result only exists when the CAD engine analysed the
      // file: the backend answers 503/422 otherwise and nothing is filled.
      if (!prev.volume) { patch.volume = r.geometry.volume; filled.add('volume'); }
      // Only a real, positive weight. The backend sends 0 for "not known",
      // because weight needs a density and density needs a material the
      // engineer has not chosen yet.
      if (!prev.weight && r.geometry.weight > 0) { patch.weight = r.geometry.weight; filled.add('weight'); }
      if (!prev.surfaceArea) { patch.surfaceArea = r.geometry.surfaceArea; filled.add('surfaceArea'); }
      if (!prev.maxLength) { patch.maxLength = r.geometry.boundingBox.length; filled.add('maxLength'); }
      if (!prev.maxWidth) { patch.maxWidth = r.geometry.boundingBox.width; filled.add('maxWidth'); }
      if (!prev.maxHeight) { patch.maxHeight = r.geometry.boundingBox.height; filled.add('maxHeight'); }
      // Material grade is NOT auto-filled, and is no longer suggested at all.
      //
      // The backend used to run suggestMaterial(), which never read the CAD file:
      // it queried raw_materials for anything ferrous, took the first 10 by
      // density, and returned the MEDIAN row. That is where "Generic CuZn39Pb3"
      // — a brass — came from on 1.5mm sheet-steel parts whose own drawing title
      // block reads SECC at 0.92 confidence. Not an extraction, a guess.
      //
      // It is gone at the source (auto-fill.service.ts step 3), so there is no
      // grade to fill and no badge to show. The engineer picks the material,
      // which is also what makes Weight meaningful: weight = volume x density,
      // and density is a property of the material, not of the solid.
      // Make/buy and item type are the engineer's decisions: nothing in the
      // CAD file states them, so they are never filled from it. (They used
      // to come from a volume-threshold rule: "assembly" above 10,000 cm3.)
      // Process is NOT filled from the analysis: the analysis runs only once a
      // process is chosen (by the engineer, or from the material) and is
      // forced to it, so the CAD engine's own family guess never decides it.
      if (!prev.holeCount && r.geometry.holeCount > 0) {
        patch.holeCount = r.geometry.holeCount;
        filled.add('holeCount');
      }
      if (!prev.bendCount && r.geometry.bendCount > 0) {
        patch.bendCount = r.geometry.bendCount;
        filled.add('bendCount');
      }
      if (!prev.cutLengthMm && r.geometry.cutLengthMm > 0) {
        patch.cutLengthMm = r.geometry.cutLengthMm;
        filled.add('cutLengthMm');
      }
      if (!prev.sheetThicknessMm && r.geometry.sheetThicknessMm > 0) {
        patch.sheetThicknessMm = r.geometry.sheetThicknessMm;
        filled.add('sheetThicknessMm');
      }
      if (!prev.pierceCount && r.geometry.pierceCount > 0) {
        patch.pierceCount = r.geometry.pierceCount;
        filled.add('pierceCount');
      }
      if (!prev.flatPatternAreaMm2 && r.geometry.flatPatternAreaMm2 > 0) {
        patch.flatPatternAreaMm2 = r.geometry.flatPatternAreaMm2;
        filled.add('flatPatternAreaMm2');
      }
      return { ...prev, ...patch };
    });
    // Function form ensures these run after the setFormData updater has populated `filled`
    setFieldLineage(prev => {
      const next = { ...prev };
      filled.forEach(f => { next[f] = { source: 'cad' }; });
      return next;
    });
    // Only the process type carries a real confidence: the CAD engine's own
    // family-classification confidence. Geometry is measured, not estimated,
    // so it gets no score (it used to get a fixed 0.9).
    setFieldConfidences(prev => {
      const next = { ...prev };
      return next;
    });
    setAutoFilledFields(filled);
    setActiveResult(r);
  }, []);

  const updatePendingFileStatus = useCallback((id: string, status: PendingFile['status'], error?: string) => {
    setPendingFiles(prev => prev.map(pf =>
      pf.id === id ? { ...pf, status, ...(error !== undefined ? { error } : {}) } : pf
    ));
  }, []);

  const updatePendingFileResult = useCallback((id: string, result: AutoFillResponse) => {
    setPendingFiles(prev => prev.map(pf => pf.id === id ? { ...pf, status: 'ready' as const, result } : pf));
  }, []);

  const analyzeFile = useCallback(async (item: PendingFile, isFirst: boolean) => {
    updatePendingFileStatus(item.id, 'analyzing');
    try {
      // familyOverride is a process_group label (what the dropdowns show) --
      // map it to the raw family string cad-engine's family_hint actually
      // honors. No mapping (a staged-only group like Sand Casting, or no
      // override at all) sends no hint, so the real classifier chain runs.
      const familyHint = processGroupToFamilyHint(item.familyOverride);
      const result = await analyzeForAutoFill(item.file, familyHint);
      updatePendingFileResult(item.id, result);
      if (isFirst) {
        setActiveFileId(item.id);
        populateFormFromResult(result);
      }
    } catch (e: any) {
      const reason: string = e?.message ?? 'Analysis failed';
      updatePendingFileStatus(item.id, 'error', reason);
      // Show the real reason the backend reported -- a valid file can fail for
      // reasons that have nothing to do with its format.
      toast.error(`Could not analyze ${item.file.name}`, {
        description: reason,
        duration: 10000,
      });
    }
  }, [updatePendingFileStatus, updatePendingFileResult, populateFormFromResult]);

  // Process dropdown changed (from either its per-file control here, or the
  // main Process field below — both call this) — re-analyze this file forced
  // to the chosen process_group's family (or back to auto-detection) via
  // cad-engine's family_hint. Used both when the import didn't classify the
  // part at all and when the engineer disagrees with what it detected. Kept
  // in sync with the main Process field so the two can never silently
  // diverge (one saying "Die Casting", the other actually still extracting
  // as whatever was auto-detected).
  const handleFamilyOverrideChange = useCallback((pf: PendingFile, value: string) => {
    // A request for this exact file is already in flight — ignore a second
    // trigger (e.g. a double-fire from a fast double-click, or the main
    // Process field and this file's own dropdown both reacting to the same
    // selection) rather than stacking another /analyze-for-autofill call on
    // top of one still running. Confirmed live: without this guard, a tight
    // retry loop exhausted the CAD engine's own 10/min rate limit.
    if (pf.status === 'analyzing') return;
    // No-op if nothing actually changed (re-selecting the same value) — same
    // reasoning, one fewer avoidable CAD engine call.
    if (value === resolveProcessDropdownValue(pf)) return;
    // No "Auto-detect" item exists any more -- every selectable value is a
    // real process_group name.
    const label = value;
    const nextItem: PendingFile = { ...pf, familyOverride: label };
    setPendingFiles(prev => prev.map(p => (p.id === pf.id ? nextItem : p)));
    if (pf.id === activeFileId) {
      setFormData(prevForm => ({ ...prevForm, processType: label ?? '' }));
      setAutoFilledFields(prev => { const s = new Set(prev); s.delete('processType'); return s; });
    }
    void analyzeFile(nextItem, pf.id === activeFileId);
  }, [analyzeFile, activeFileId]);

  // One path for setting Process, whoever sets it: the active model (if any)
  // is analysed for that process; otherwise the choice is just recorded.
  // One Process for the dialog: every uploaded model is analysed for it.
  const selectProcess = useCallback((value: string, source: 'user' | 'material') => {
    setProcessSource(source);
    setFormData(prev => ({ ...prev, processType: value }));
    setAutoFilledFields(prev => { const s = new Set(prev); s.delete('processType'); return s; });
    for (const pf of pendingFiles) {
      if (!/\.(dxf|dwg)$/i.test(pf.file.name)) handleFamilyOverrideChange(pf, value);
    }
  }, [pendingFiles, handleFamilyOverrideChange]);

  // The material groups each material name belongs to, from the same search
  // result the Material dropdown lists (a name can sit in several groups).
  const materialGroupsByName = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const m of rawMaterialsData?.items ?? []) {
      const name = (m.materialName ?? m.material ?? '').trim();
      if (!name || !m.materialGroup) continue;
      (map.get(name) ?? map.set(name, new Set()).get(name)!).add(m.materialGroup);
    }
    return map;
  }, [rawMaterialsData]);

  // A chosen material decides Process when its groups serve exactly one
  // process (a die-casting alloy -> Die Casting); several -> the engineer
  // picks among them. Never overrides a Process the engineer set.
  const applyMaterialProcess = useCallback((name: string) => {
    const candidates = processesForMaterialGroups([...(materialGroupsByName.get(name) ?? [])], processMaterialLinks ?? [], processGroupOptions);
    setMaterialProcessChoices(candidates.length > 1 ? candidates : []);
    if (candidates.length !== 1 || processSource === 'user') return;
    if (formDataRef.current.processType === candidates[0]) return;
    selectProcess(candidates[0]!, 'material');
  }, [materialGroupsByName, processMaterialLinks, processGroupOptions, processSource, selectProcess]);

  const handleFileDrop = useCallback(async (acceptedFiles: File[]) => {
    if (!acceptedFiles.length) return;
    const isDxfFile = (f: File) => /\.(dxf|dwg)$/i.test(f.name);
    const dxfFiles = acceptedFiles.filter(isDxfFile);
    const modelFiles = acceptedFiles.filter(f => !isDxfFile(f));

    // DXF/DWG: add to pendingFiles as ready (no analysis), upload as file2d at submit
    const dxfItems: PendingFile[] = dxfFiles.map(f => ({
      id: crypto.randomUUID(),
      file: f,
      status: 'ready' as const,
    }));

    const isFirstBatch = pendingFiles.length === 0;
    const modelItems: PendingFile[] = modelFiles.map(f => ({
      id: crypto.randomUUID(),
      file: f,
      status: 'pending' as const,
    }));

    setPendingFiles(prev => [...prev, ...dxfItems, ...modelItems]);

    if (modelFiles.length > 0) {
      if (isFirstBatch && modelFiles[0]) {
        setFormData(prev => ({ ...prev, file3d: modelFiles[0] ?? null }));
        setActiveFileId(modelItems[0]!.id);
      }
      // A model is analysed only for a known process: features differ by
      // process (die casting cores and draft vs machining setups), and an
      // unhinted analysis lets the CAD engine guess the family (Machining for
      // any solid that is not sheet metal or plastic). With a process already
      // chosen the files are analysed for it now; otherwise they wait until
      // the engineer picks the process or a material that implies one.
      // Measure the first model now: Name, Part Number and the physical
      // properties do not depend on the process. (Weight follows from
      // volume x the chosen material's density.)
      if (isFirstBatch && modelFiles[0]) {
        const first = modelFiles[0];
        void measureForAutoFill(first).then((m) => {
          const filled = new Set<string>();
          setFormData(prev => {
            const patch: Partial<typeof prev> = {};
            if (!prev.name) { patch.name = m.suggestions.name; filled.add('name'); }
            if (!prev.partNumber) { patch.partNumber = m.suggestions.partNumber; filled.add('partNumber'); }
            if (!prev.volume && m.geometry.volume > 0) { patch.volume = m.geometry.volume; filled.add('volume'); }
            if (!prev.surfaceArea && m.geometry.surfaceArea > 0) { patch.surfaceArea = m.geometry.surfaceArea; filled.add('surfaceArea'); }
            if (!prev.maxLength && m.geometry.boundingBox.length > 0) { patch.maxLength = m.geometry.boundingBox.length; filled.add('maxLength'); }
            if (!prev.maxWidth && m.geometry.boundingBox.width > 0) { patch.maxWidth = m.geometry.boundingBox.width; filled.add('maxWidth'); }
            if (!prev.maxHeight && m.geometry.boundingBox.height > 0) { patch.maxHeight = m.geometry.boundingBox.height; filled.add('maxHeight'); }
            return { ...prev, ...patch };
          });
          setFieldLineage(prev => { const next = { ...prev }; filled.forEach(f => { next[f] = { source: 'cad' }; }); return next; });
          setAutoFilledFields(prev => new Set([...prev, ...filled]));
        }).catch((e: any) => {
          toast.error(`Could not measure ${first.name}`, { description: e?.message ?? 'Measurement failed', duration: 10000 });
        });
      }
      const chosen = formDataRef.current.processType;
      if (chosen) {
        const hinted = modelItems.map((item) => ({ ...item, familyOverride: chosen }));
        setPendingFiles(prev => prev.map(pf => hinted.find(h => h.id === pf.id) ?? pf));
        await Promise.allSettled(hinted.map((item, i) => analyzeFile(item, isFirstBatch && i === 0)));
      }
    }
  }, [pendingFiles.length, analyzeFile]);

  const removePendingFile = useCallback((id: string) => {
    setPendingFiles(prev => {
      const next = prev.filter(pf => pf.id !== id);
      if (activeFileId === id) {
        const nextReady = next.find(pf => pf.status === 'ready');
        if (nextReady?.result) {
          setActiveFileId(nextReady.id);
          populateFormFromResult(nextReady.result);
        } else {
          setActiveFileId(null);
          setActiveResult(null);
          setAutoFilledFields(new Set());
        }
      }
      return next;
    });
  }, [activeFileId, populateFormFromResult]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: handleFileDrop,
    accept: {
      // STEP/STP are analysed by the CAD engine (the only 3D formats it reads);
      // DXF/DWG are stored as the 2D drawing, not analysed.
      'application/octet-stream': ['.step', '.stp', '.dxf', '.dwg'],
    },
    maxSize: 100 * 1024 * 1024,
    multiple: true,
    noClick: false,
  });

  useEffect(() => {
    if (!item && getAutoParent) {
      setAutoParentId(getAutoParent(formData.itemType));
    }

    let bomLevel = '';
    switch (formData.itemType) {
      case BOMItemType.ASSEMBLY: bomLevel = 'L0'; break;
      case BOMItemType.SUB_ASSEMBLY: bomLevel = 'L1'; break;
      case BOMItemType.CHILD_PART: bomLevel = 'L2'; break;
      default: bomLevel = '';
    }

    if (formData.bomLevel !== bomLevel) {
      setFormData(prev => ({ ...prev, bomLevel }));
    }
  }, [formData.itemType, getAutoParent, item, formData.bomLevel]);

  useEffect(() => {
    if (item) {
      setFormData({
        name: item.name || '',
        partNumber: item.partNumber || '',
        description: item.description || '',
        itemType: item.itemType || BOMItemType.ASSEMBLY,
        quantity: item.quantity || 1,
        annualVolume: item.annualVolume ?? null,
        unit: item.unit || 'pcs',
        material: item.material || '',
        materialGrade: item.materialGrade || '',
        makeBuy: item.makeBuy || 'make',
        unitCost: item.unitCost ? item.unitCost.toString() : '',
        bomLevel: item.bomLevel || 'L0',
        volume: item.volume || 0,
        weight: item.weight || 0,
        maxLength: item.maxLength || 0,
        maxWidth: item.maxWidth || 0,
        maxHeight: item.maxHeight || 0,
        surfaceArea: item.surfaceArea || 0,
        sheetThicknessMm: (item as any).sheetThicknessMm || 0,
        bendCount: (item as any).bendCount || 0,
        holeCount: (item as any).holeCount || 0,
        cutLengthMm: (item as any).cutLengthMm || 0,
        pierceCount: (item as any).pierceCount || 0,
        flatPatternAreaMm2: (item as any).flatPatternAreaMm2 || 0,
        processType: (item.scenarioOverrides?.['processGroup'] as string | undefined) || resolveStoredProcessLabel(item),
        materialSource: (item as any).materialSource || '',
        materialConfidence: (item as any).materialConfidence || 0,
        coating: (item as any).coating || '',
        heatTreatment: (item as any).heatTreatment || '',
        surfaceFinishRa: (item as any).surfaceFinishRa || 0,
        surfaceFinishConfidence: (item as any).surfaceFinishConfidence || 0,
        complexity: (item as any).complexity || '',
        tightestToleranceMm: (item as any).tightestToleranceMm || 0,
        toleranceConfidence: (item as any).toleranceConfidence || 0,
        drawingIntelligence: (item as any).drawingIntelligence || null,
        file2d: null,
        file3d: null,
      });
    } else {
      setFormData({
        name: '',
        partNumber: '',
        description: '',
        itemType: defaultItemType || ('' as BOMItemType),
        quantity: 1,
        annualVolume: null,
        unit: 'pcs',
        material: '',
        materialGrade: '',
        makeBuy: 'make',
        unitCost: '',
        bomLevel: '',
        volume: 0,
        weight: 0,
        maxLength: 0,
        maxWidth: 0,
        maxHeight: 0,
        surfaceArea: 0,
        sheetThicknessMm: 0,
        bendCount: 0,
        holeCount: 0,
        cutLengthMm: 0,
        pierceCount: 0,
        flatPatternAreaMm2: 0,
        processType: '',
        materialSource: '',
        materialConfidence: 0,
        coating: '',
        heatTreatment: '',
        surfaceFinishRa: 0,
        surfaceFinishConfidence: 0,
        complexity: '',
        tightestToleranceMm: 0,
        toleranceConfidence: 0,
        drawingIntelligence: null,
        file2d: null,
        file3d: null,
      });
    }
    // Reset multi-file state whenever dialog opens fresh
    setProcessSource(null);
    setMaterialProcessChoices([]);
    setPendingFiles([]);
    setActiveFileId(null);
    setAutoFilledFields(new Set());
    setActiveResult(null);
    lastAnalyzedHashRef.current = null;
    setFieldLineage({});
    setFieldConfidences({});
  }, [item, open, defaultItemType]);

  // Whenever a 2D drawing is uploaded (PDF/PNG/JPG/TIFF/BMP/WEBP), extract material + dimensions + sheet metal properties
  useEffect(() => {
    const file = formData.file2d;
    if (!file) return;
    const fileKey = `${file.name}-${file.size}-${file.lastModified}`;
    if (fileKey === lastAnalyzedHashRef.current) return;
    lastAnalyzedHashRef.current = fileKey;

    const ext = file.name.toLowerCase();
    const is2dSupported =
      ext.endsWith('.png') || ext.endsWith('.jpg') || ext.endsWith('.jpeg') ||
      ext.endsWith('.pdf') ||
      ext.endsWith('.tiff') || ext.endsWith('.tif') ||
      ext.endsWith('.bmp') || ext.endsWith('.webp');
    if (!is2dSupported) return;

    const mediaType =
      ext.endsWith('.pdf')                            ? 'application/pdf' :
      ext.endsWith('.jpg') || ext.endsWith('.jpeg')   ? 'image/jpeg' :
      ext.endsWith('.tiff') || ext.endsWith('.tif')   ? 'image/tiff' :
      ext.endsWith('.bmp')                            ? 'image/bmp' :
      ext.endsWith('.webp')                           ? 'image/webp' :
      'image/png';

    const extract = async () => {
      setIsAnalyzing2d(true);
      try {
        const imageBase64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => {
            const base64Part = (reader.result as string).split(',')[1];
            if (base64Part === undefined) {
              reject(new Error('Failed to read file as base64 data URL'));
              return;
            }
            resolve(base64Part);
          };
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        const res = await fetch('/api/vave/drawing-analysis', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageBase64, mediaType, partNumber: formData.partNumber }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: 'Drawing analysis failed' }));
          // 422 = known limitation (image upload, scanned PDF) — surface as warning, not error
          if (res.status === 415 || res.status === 422) {
            toast.warning('Drawing analysis skipped', { description: body.detail ?? body.error });
            return;
          }
          throw new Error(body.detail ?? body.error ?? `Drawing analysis failed (${res.status})`);
        }
        const result: DrawingAnalysisResult = await res.json();

        const filled = new Set<string>();

        setFormData(prev => {
          const patch: Partial<typeof prev> = {};

          // Material — drawing is authoritative; always overrides CAD material.
          // Placeholder strings from the extractor are not valid — never store them.
          const mat = result.material ?? '';
          if (mat && !/^(unknown|not\s*specified|none|n\/?a)$/i.test(mat.trim())) {
            patch.material = mat;
            patch.materialSource = 'drawing';
            patch.materialConfidence = result.material_confidence ?? 0.5;
            filled.add('material');
          }

          // Envelope dimensions — supplement only; never overwrite CAD geometry
          const d = result.dimensions_mm ?? { L: 0, W: 0, H: 0 };
          if (!prev.maxLength  && d.L > 0) { patch.maxLength  = d.L; filled.add('maxLength');  }
          if (!prev.maxWidth   && d.W > 0) { patch.maxWidth   = d.W; filled.add('maxWidth');   }
          if (!prev.maxHeight  && d.H > 0) { patch.maxHeight  = d.H; filled.add('maxHeight');  }

          // CAD geometry wins over drawing OCR for quantitative geometric fields —
          // CAD engine measures directly from 3D model; drawing values are often rounded
          // or incomplete. Only fill from drawing when CAD has no data (0 / null).
          if ((result.sheet_thickness_mm ?? 0) > 0 && !prev.sheetThicknessMm) {
            patch.sheetThicknessMm = result.sheet_thickness_mm;
            filled.add('sheetThicknessMm');
          }
          if ((result.bend_count ?? 0) > 0 && !prev.bendCount) {
            patch.bendCount = result.bend_count;
            filled.add('bendCount');
          }

          // Drawing intelligence fields — persisted as promoted columns + full JSONB cache
          if (result.coating && result.coating !== 'None') {
            patch.coating = result.coating;
            filled.add('coating');
          }
          if (result.heat_treatment && result.heat_treatment !== 'None') {
            patch.heatTreatment = result.heat_treatment;
            filled.add('heatTreatment');
          }
          if ((result.surface_finish_ra ?? 0) > 0) {
            patch.surfaceFinishRa = result.surface_finish_ra;
            patch.surfaceFinishConfidence = result.surface_finish_confidence ?? 0;
            filled.add('surfaceFinishRa');
          }
          if (result.complexity) {
            patch.complexity = result.complexity;
            filled.add('complexity');
          }
          if ((result.tightest_tolerance_mm ?? 0) > 0) {
            patch.tightestToleranceMm = result.tightest_tolerance_mm;
            patch.toleranceConfidence = result.tolerance_confidence ?? 0;
            filled.add('tightestToleranceMm');
          }
          // Full JSON cache — threads, GD&T, tolerances, revision, notes
          patch.drawingIntelligence = result;
          filled.add('drawingIntelligence');

          return { ...prev, ...patch };
        });

        // Function forms execute after the setFormData updater has populated `filled`
        setAutoFilledFields(prev => {
          const s = new Set(prev);
          filled.forEach(f => s.add(f));
          return s;
        });
        setFieldLineage(prev => {
          const next = { ...prev };
          filled.forEach(f => { next[f] = { source: 'drawing' }; });
          return next;
        });
        setFieldConfidences(prev => {
          const next = { ...prev };
          if (filled.has('material'))           next['material']           = result.material_confidence ?? 0.5;
          if (filled.has('sheetThicknessMm'))   next['sheetThicknessMm']   = result.sheet_thickness_confidence ?? 0.5;
          if (filled.has('maxLength'))          next['maxLength']          = 0.6;
          if (filled.has('maxWidth'))           next['maxWidth']           = 0.6;
          if (filled.has('maxHeight'))          next['maxHeight']          = 0.6;
          if (filled.has('bendCount'))          next['bendCount']          = 0.7;
          if (filled.has('surfaceFinishRa'))    next['surfaceFinishRa']    = result.surface_finish_confidence ?? 0.5;
          if (filled.has('tightestToleranceMm')) next['tightestToleranceMm'] = result.tolerance_confidence ?? 0.5;
          if (filled.has('coating'))            next['coating']            = result.drawing_intelligence_confidence ?? 0.7;
          return next;
        });
        if (result.material_confidence != null && result.material_confidence < 0.6
            && result.material && result.material !== 'Unknown') {
          toast.warning('Low-confidence material extraction', {
            description: `"${result.material}" extracted from drawing with ${Math.round(result.material_confidence * 100)}% confidence. Verify before saving.`,
            duration: 6000,
          });
        }
        if (filled.size > 0) {
          toast.success(`Auto-filled ${filled.size} field${filled.size > 1 ? 's' : ''} from 2D drawing`);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        console.error('Drawing analysis error:', err);
        toast.error('Drawing analysis failed', {
          description: msg,
          duration: 6000,
        });
      } finally {
        setIsAnalyzing2d(false);
        drawing2dAnalysisRef.current = null;
      }
    };

    const promise = extract();
    drawing2dAnalysisRef.current = promise;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.file2d]);

  // Live weight calculation: whenever volume, materialGrade, or material changes, look up density
  // and recompute weight = (volume_mm3 / 1e6) * density_g_cm3
  // Falls back to formData.material for density lookup when no grade is set (e.g. generic plastics)
  useEffect(() => {
    const densityKey = formData.materialGrade || formData.material;
    if (!formData.volume || !densityKey) return;
    // Only recalculate if weight hasn't been manually edited (i.e. it's still auto-filled or zero)
    if (formData.weight && !autoFilledFields.has('weight')) return;

    const controller = new AbortController();
    const recalculate = async () => {
      try {
        // apiClient already unwraps the backend's {success, data, metadata}
        // envelope, and the backend's global TransformInterceptor rewrites
        // every response key to camelCase — so the real shape here is
        // densityGCm3, never density_g_cm3. Reading the snake_case name
        // silently read `undefined` forever and never computed a weight.
        const result = await apiClient.get<{ densityGCm3: number | null }>(
          `/bom-items/material-density?grade=${encodeURIComponent(densityKey)}`,
        );
        // Reject implausible densities — real engineering materials are > 0.5 g/cm³
        if (!result?.densityGCm3 || result.densityGCm3 < 0.5) return;
        if (controller.signal.aborted) return;
        const computed = parseFloat(((formData.volume / 1e6) * result.densityGCm3).toFixed(4));
        setFormData(prev => ({ ...prev, weight: computed }));
        setAutoFilledFields(prev => { const s = new Set(prev); s.add('weight'); return s; });
        setFieldLineage(prev => ({
          ...prev,
          weight: { source: 'derived', inputs: ['volume', formData.materialGrade ? 'materialGrade' : 'material'] },
        }));
        const storedWeight = itemRef.current?.weight ?? 0;
        if (storedWeight > 0 && Math.abs(computed - storedWeight) / storedWeight > 0.25) {
          toast.warning('Derived weight mismatch', {
            description: `Calculated weight (${computed.toFixed(3)} kg) differs from BOM record (${storedWeight.toFixed(3)} kg) by ${Math.round(Math.abs(computed - storedWeight) / storedWeight * 100)}%. Check material density or BOM entry.`,
            duration: 8000,
          });
        }
      } catch {
        // Network error — silently ignore
      }
    };

    recalculate();
    return () => controller.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData.volume, formData.materialGrade, formData.material]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validationStatus.isValid) {
      toast.error('Please fix validation errors before saving', {
        description: 'Check highlighted fields and try again',
        duration: 5000
      });
      return;
    }

    // Wait for any in-flight drawing analysis to complete, then read fresh state from ref
    if (drawing2dAnalysisRef.current) {
      await drawing2dAnalysisRef.current;
    }
    const latestFormData = formDataRef.current;

    setLoading(true);

    try {
      const finalParentId = parentItemId !== undefined ? parentItemId : autoParentId;

      const payload = {
        bomId,
        name: formData.name,
        partNumber: formData.partNumber,
        description: formData.description || undefined,
        itemType: formData.itemType,
        parentItemId: finalParentId || undefined,
        quantity: formData.quantity,
        annualVolume: formData.annualVolume ?? undefined,
        unit: formData.unit,
        material: formData.material || undefined,
        materialGrade: formData.materialGrade || undefined,
        bomLevel: formData.bomLevel,
        makeBuy: formData.makeBuy,
        unitCost: formData.makeBuy === 'buy' ? parseFloat(formData.unitCost) || 0 : undefined,
        weight: formData.weight || undefined,
        maxLength: formData.maxLength || undefined,
        maxWidth: formData.maxWidth || undefined,
        maxHeight: formData.maxHeight || undefined,
        surfaceArea: formData.surfaceArea || undefined,
        volume: formData.volume || undefined,
        materialSource: formData.materialSource || undefined,
        materialConfidence: formData.materialConfidence || undefined,
        sheetThicknessMm:   formData.sheetThicknessMm   || undefined,
        bendCount:          formData.bendCount           || undefined,
        holeCount:          formData.holeCount           || undefined,
        cutLengthMm:        formData.cutLengthMm         || undefined,
        pierceCount:        formData.pierceCount         || undefined,
        flatPatternAreaMm2: formData.flatPatternAreaMm2  || undefined,
        featureGraph:       activeResult?.featureGraph   ?? undefined,
        // Drawing intelligence — use latestFormData (ref) so race condition with async Gemini call is safe
        coating:              latestFormData.coating              || undefined,
        heatTreatment:        latestFormData.heatTreatment        || undefined,
        surfaceFinishRa:      latestFormData.surfaceFinishRa      || undefined,
        surfaceFinishConfidence: latestFormData.surfaceFinishConfidence || undefined,
        complexity:           latestFormData.complexity           || undefined,
        tightestToleranceMm:  latestFormData.tightestToleranceMm  || undefined,
        toleranceConfidence:  latestFormData.toleranceConfidence  || undefined,
        drawingIntelligence:  latestFormData.drawingIntelligence  ?? undefined,
      };

      let itemId: string;

      if (item) {
        await updateBOMItem(item.id, payload);
        itemId = item.id;
        toast.success(`"${formData.name}" updated successfully`, {
          description: 'BOM item has been updated with your changes',
          duration: 4000
        });
      } else {
        const newItem = await createBOMItem(payload);
        itemId = newItem.id;
        toast.success(`🎉 "${formData.name}" added to BOM`, {
          description: 'New item is now part of your Bill of Materials',
          duration: 4000
        });
      }

      // The Process the user picked is the item's process group from here on
      // (Cost Guide reads it back). There is no processType column, so it is
      // stored in the existing scenario_overrides bag; null clears it.
      await apiClient.patch(`/bom-items/${itemId}/scenario-overrides`, {
        processGroup: formData.processType || null,
      });

      const dxfPending = pendingFiles.find(pf => /\.(dxf|dwg)$/i.test(pf.file.name));
      if (formData.file2d || formData.file3d || dxfPending) {
        const formDataUpload = new FormData();
        const fileNames: string[] = [];

        if (dxfPending) {
          formDataUpload.append('file2d', dxfPending.file);
          fileNames.push(dxfPending.file.name);
        } else if (formData.file2d) {
          formDataUpload.append('file2d', formData.file2d);
          fileNames.push(formData.file2d.name);
        }
        if (formData.file3d) {
          formDataUpload.append('file3d', formData.file3d);
          fileNames.push(formData.file3d.name);
        }

        try {
          setUploadProgress({ file2d: 0, file3d: 0 });
          await apiClient.uploadFiles(`/bom-items/${itemId}/upload-files`, formDataUpload);
          setUploadProgress({ file2d: 100, file3d: 100 });
          toast.success('Files uploaded successfully', {
            description: `${fileNames.join(', ')} attached to ${formData.name}`,
            duration: 4000
          });
        } catch (uploadError: unknown) {
          const errorInfo = categorizeBOMError(uploadError);
          const baseMessage = `Item saved but file upload ${errorInfo.recoverable ? 'failed' : 'was blocked'}`;

          toast.error(baseMessage, {
            description: errorInfo.suggestion,
            duration: errorInfo.severity === 'critical' ? 10000 : 7000,
            action: errorInfo.recoverable ? {
              label: 'Retry Upload',
              onClick: async () => {
                try {
                  await apiClient.uploadFiles(`/bom-items/${itemId}/upload-files`, formDataUpload);
                  toast.success('Files uploaded successfully on retry');
                } catch {
                  toast.error('Upload failed again. Please try manually later.');
                }
              }
            } : undefined
          });

          setUploadProgress({});
        }
      }

      await queryClient.invalidateQueries({ queryKey: ['bom-items', 'list', bomId] });
      await queryClient.invalidateQueries({ queryKey: ['bom-items', 'detail', itemId] });
      onOpenChange(false);
      onSuccess?.();
    } catch (error: unknown) {
      const errorInfo = categorizeBOMError(error);
      const toastOptions: Parameters<typeof toast.error>[1] & { action?: { label: string; onClick: () => void } } = {
        description: errorInfo.suggestion,
        duration: errorInfo.severity === 'critical' ? 10000 : 7000
      };

      if (errorInfo.actionable && errorInfo.recoverable) {
        switch (errorInfo.category) {
          case 'validation':
            toastOptions.action = {
              label: 'Show Help',
              onClick: () => {
                if (errorInfo.helpUrl) {
                  window.open(errorInfo.helpUrl, '_blank');
                } else {
                  setShowHelp(prev => ({ ...prev, validation: true }));
                }
              }
            };
            break;
          case 'duplication':
            toastOptions.action = {
              label: 'Generate New Part#',
              onClick: () => {
                const timestamp = new Date().toISOString().slice(2, 10).replace(/-/g, '');
                const randomSuffix = Math.random().toString(36).substring(2, 5).toUpperCase();
                setFormData(prev => ({
                  ...prev,
                  partNumber: `${prev.partNumber || 'PT'}-${timestamp}-${randomSuffix}`
                }));
                toast.info('New part number generated. Please review and adjust as needed.');
              }
            };
            break;
          case 'network':
            toastOptions.action = {
              label: 'Retry Save',
              onClick: () => handleSubmit(e)
            };
            break;
        }
      }

      toast.error(errorInfo.userMessage, toastOptions);
    } finally {
      setLoading(false);
      setUploadProgress({});
    }
  };

  const toggleHelp = (field: string) => {
    setShowHelp(prev => ({ ...prev, [field]: !prev[field] }));
  };

  // ── Batch create ──────────────────────────────────────────────────────────

  const handleBatchCreate = async () => {
    const readyFiles = pendingFiles.filter(pf => pf.status === 'ready' && pf.result);
    if (!readyFiles.length) return;
    setIsBatchCreating(true);

    const finalParentId = parentItemId !== undefined ? parentItemId : autoParentId;
    let successCount = 0;

    for (const pf of readyFiles) {
      try {
        populateFormFromResult(pf.result!);
        const r = pf.result!;
        const payload = {
          bomId,
          name: r.suggestions.name,
          partNumber: r.suggestions.partNumber,
          // The Type and Make/Buy the engineer set in this dialog apply to every file.
          itemType: formData.itemType,
          parentItemId: finalParentId || undefined,
          quantity: 1,
          // No annualVolume. A bulk import has nobody to ask, and 1000 was not
          // an answer — it was the schema default echoed back, then used to
          // derive batch size and to take the low-volume branches of route
          // scoring. Imported parts arrive with the volume unresolved and the
          // Cost Guide says so.
          unit: 'pcs',
          // Deliberately absent — see the single-file path above. The CAD
          // file's embedded material is a placeholder, not a specification,
          // and must not arrive as the item's costing grade.
          makeBuy: formData.makeBuy,
          weight: r.geometry.weight || undefined,
          maxLength: r.geometry.boundingBox.length || undefined,
          maxWidth: r.geometry.boundingBox.width || undefined,
          maxHeight: r.geometry.boundingBox.height || undefined,
          surfaceArea: r.geometry.surfaceArea || undefined,
        };
        const newItem = await createBOMItem(payload);
        const fileProcess = resolveProcessDropdownValue(pf);
        if (fileProcess) {
          await apiClient.patch(`/bom-items/${newItem.id}/scenario-overrides`, { processGroup: fileProcess });
        }

        const uploadForm = new FormData();
        uploadForm.append('file3d', pf.file);
        try {
          await apiClient.uploadFiles(`/bom-items/${newItem.id}/upload-files`, uploadForm);
        } catch (_) { /* file upload failure is non-fatal */ }

        successCount++;
        toast.success(`Created: ${r.suggestions.name}`);
      } catch (err: any) {
        toast.error(`Failed to create item from ${pf.file.name}`, {
          description: err?.message ?? 'Unknown error',
          duration: 5000,
        });
      }
    }

    await queryClient.invalidateQueries({ queryKey: ['bom-items', 'list', bomId] });
    setIsBatchCreating(false);
    if (successCount > 0) {
      onSuccess?.();
      onOpenChange(false);
    }
  };

  // ── Auto badge ──────────────────────────────────────────────────────────────
  // AutoBadgeFor is module-scope (see the bottom of this file). It used to be
  // declared here, inside the component body, which gave it a new function
  // identity on every render -- React then treats it as a DIFFERENT component
  // type and unmounts/remounts every badge instead of updating it, on every
  // keystroke. This binds the two lineage maps once per render instead.
  const AutoBadge = useCallback(
    ({ field }: { field: string }) => (
      <AutoBadgeFor field={field} autoFilledFields={autoFilledFields} fieldLineage={fieldLineage} />
    ),
    [autoFilledFields, fieldLineage],
  );

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[780px] w-[95vw] h-[90vh] flex flex-col overflow-hidden p-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b shrink-0">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <DialogTitle className="flex items-center gap-2">
                  <Package className="h-5 w-5" />
                  {item ? 'Edit BOM Item' : 'Create BOM Item'}
                </DialogTitle>
                <DialogDescription className="mt-1">
                  {item ? 'Update item details and specifications' : 'Add a new item to the Bill of Materials'}
                </DialogDescription>
              </div>

              {!item && (
                <div className="text-right">
                  <div className="text-sm font-medium text-muted-foreground">Completion</div>
                  <div className="flex items-center gap-2 mt-1">
                    <Progress value={validationStatus.completionPercentage} className="w-16 h-2" />
                    <span className="text-xs text-muted-foreground">{validationStatus.completionPercentage}%</span>
                  </div>
                </div>
              )}
            </div>

            {Object.keys(validationErrors).length > 0 && (
              <Alert variant="destructive" className="py-2">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle className="text-sm">Please fix validation errors</AlertTitle>
                <AlertDescription className="text-xs mt-1">
                  {Object.keys(validationErrors).length} field{Object.keys(validationErrors).length !== 1 ? 's' : ''} need attention before saving
                </AlertDescription>
              </Alert>
            )}
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="grid gap-5">
            {/* 3D Models — first so geometry auto-fills the form below */}
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-2">
                  <Package className="h-4 w-4" />
                  3D Model (STEP) · 2D drawing (DXF, DWG)
                  {pendingFiles.length > 0 && (
                    <Badge variant="secondary" className="text-xs ml-1">
                      {pendingFiles.length} file{pendingFiles.length !== 1 ? 's' : ''}
                    </Badge>
                  )}
                </Label>
                <span className="text-[11px] text-muted-foreground">
                  Upload to auto-fill BOM fields
                </span>
              </div>
              <div
                {...getRootProps()}
                className={cn(
                  'border-2 border-dashed rounded-lg p-4 transition-colors cursor-pointer',
                  isDragActive
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/60 hover:bg-muted/30',
                )}
              >
                <input {...getInputProps()} />
                {pendingFiles.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 text-muted-foreground py-2">
                    <Package className="h-7 w-7 opacity-50" />
                    <p className="text-sm font-medium">
                      {isDragActive ? 'Drop files here…' : 'Drop STEP (.step / .stp) or DXF / DWG files, or click to browse'}
                    </p>
                    <p className="text-xs">Multiple files supported · 100 MB max each · STEP is analysed by the CAD engine and fills the form · DXF/DWG are stored as the drawing only (not analysed)</p>
                  </div>
                ) : (
                  <div className="space-y-1" onClick={(e) => e.stopPropagation()}>
                    {pendingFiles.map((pf) => (
                      <div
                        key={pf.id}
                        onClick={() => {
                          setActiveFileId(pf.id);
                          if (pf.result) {
                            setAutoFilledFields(new Set());
                            populateFormFromResult(pf.result);
                          }
                        }}
                        className={cn(
                          'flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer transition-colors select-none',
                          pf.id === activeFileId
                            ? 'bg-primary/10 border border-primary/30'
                            : 'hover:bg-muted',
                        )}
                      >
                        {pf.status === 'analyzing' && <Loader2 className="h-3 w-3 animate-spin text-blue-500 shrink-0" />}
                        {pf.status === 'ready'     && <CheckCircle className="h-3 w-3 text-green-500 shrink-0" />}
                        {pf.status === 'error'     && <XCircle className="h-3 w-3 text-red-500 shrink-0" />}
                        {pf.status === 'pending'   && <div className="h-3 w-3 rounded-full bg-muted-foreground/30 shrink-0" />}
                        <span className="text-sm truncate flex-1 min-w-0">{pf.file.name}</span>
                        <span className="text-xs text-muted-foreground shrink-0">
                          {(pf.file.size / 1024 / 1024).toFixed(1)} MB
                        </span>
                        {/\.(dxf|dwg)$/i.test(pf.file.name) && (
                          <Badge variant="outline" className="text-xs shrink-0">DXF Drawing</Badge>
                        )}
                        {pf.status === 'error' && (
                          <span className="text-xs text-red-500 shrink-0 max-w-[100px] truncate" title={pf.error}>
                            {pf.error}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); removePendingFile(pf.id); }}
                          className="ml-1 shrink-0 text-muted-foreground hover:text-foreground"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                    <p className="text-xs text-muted-foreground pt-1 px-1">
                      Click a file to load its properties · Drop more files to add
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Name + Part Number — side by side */}
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="name" className="flex items-center">Name * <AutoBadge field="name" /></Label>
                <Input
                  id="name"
                  placeholder="e.g., Cylinder Head Assembly"
                  value={formData.name}
                  onChange={(e) => {
                    setFormData({ ...formData, name: e.target.value });
                    setAutoFilledFields(prev => { const s = new Set(prev); s.delete('name'); return s; });
                  }}
                  className={validationErrors.name ? 'border-red-500 focus:border-red-500' : ''}
                  required
                />
                {validationErrors.name && (
                  <div className="flex items-center gap-1 text-xs text-red-600">
                    <XCircle className="h-3 w-3" />
                    <span>{validationErrors.name}</span>
                  </div>
                )}
              </div>

              <div className="grid gap-2">
                <Label htmlFor="partNumber" className="flex items-center">Part Number * <AutoBadge field="partNumber" /></Label>
                <Input
                  id="partNumber"
                  placeholder="e.g., CH-2024-001"
                  value={formData.partNumber}
                  onChange={(e) => {
                    setFormData({ ...formData, partNumber: e.target.value });
                    setAutoFilledFields(prev => { const s = new Set(prev); s.delete('partNumber'); return s; });
                  }}
                  className={validationErrors.partNumber ? 'border-red-500 focus:border-red-500' : ''}
                  required
                />
                {validationErrors.partNumber && (
                  <div className="flex items-center gap-1 text-xs text-red-600">
                    <XCircle className="h-3 w-3" />
                    <span>{validationErrors.partNumber}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Process + Material — side by side, Process first */}
            <div className="grid grid-cols-2 gap-4">
            {/* Process — auto-filled from the 3D model's CAD-detected family
                when the import classified it; always editable so the
                engineer can correct a wrong detection or choose manually
                when no 3D model was uploaded or the import didn't classify
                the part at all. The SAME options, selection, and sync as
                the active file's own per-file dropdown above — changing
                either one re-analyzes the active file with the matching
                family_hint (processGroupToFamilyHint) so this label and
                the actual CAD extraction can never silently disagree. */}
            <div className="grid gap-2">
              <Label htmlFor="processType" className="flex items-center">Process <AutoBadge field="processType" /></Label>
              <Select
                // Editing an existing item shows its real stored process
                // name (populated into formData.processType by the item-load
                // effect); no "Auto-detect" item exists any more — an empty
                // value just shows the placeholder.
                value={formData.processType || ''}
                onValueChange={(value) => selectProcess(value, 'user')}
                disabled={pendingFiles.find(pf => pf.id === activeFileId)?.status === 'analyzing'}
              >
                <SelectTrigger id="processType"><SelectValue placeholder="Select process…" /></SelectTrigger>
                <SelectContent>
                  {processGroupOptions.map((g) => (
                    <SelectItem key={g} value={g}>{g}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!formData.processType && materialProcessChoices.length > 1 && (
                <p className="text-xs text-muted-foreground">
                  {formData.material} is used by {materialProcessChoices.join(', ')}: choose the process.
                </p>
              )}
              {!formData.processType && pendingFiles.some(pf => pf.status === 'pending' && !/\.(dxf|dwg)$/i.test(pf.file.name)) && (
                <p className="text-xs text-muted-foreground">
                  The 3D model is analysed for the process: choose a material (it sets the process when it implies one) or the process.
                </p>
              )}
              {processSource === 'material' && formData.processType && (
                <p className="text-xs text-muted-foreground">Set from the material ({formData.material}).</p>
              )}
            </div>

            {/* Material */}
            <div className="grid gap-2">
              <Label htmlFor="material" className="flex items-center">Material <AutoBadge field="material" /></Label>
                <Popover open={materialOpen} onOpenChange={setMaterialOpen}>
                  <PopoverTrigger asChild>
                    <div className="relative">
                      <Input
                        id="material"
                        value={formData.material || ''}
                        onChange={(e) => {
                          const value = e.target.value;
                          setFormData({ ...formData, material: value, materialGrade: '' });
                          setMaterialSearch(value);
                          if (!materialOpen) setMaterialOpen(true);
                        }}
                        onFocus={() => { setMaterialOpen(true); setMaterialSearch(formData.material || ''); }}
                        onClick={(e) => { e.stopPropagation(); setMaterialOpen(true); }}
                        placeholder="Type or select material..."
                        className="pr-10"
                      />
                      <span className="absolute right-0 top-0 h-full px-3 flex items-center pointer-events-none">
                        <ChevronsUpDown className="h-4 w-4 opacity-50" />
                      </span>
                    </div>
                  </PopoverTrigger>
                  <PopoverContent
                    className="w-[var(--radix-popover-trigger-width)] p-0 bg-popover border-border shadow-lg"
                    align="start"
                    onOpenAutoFocus={(e) => e.preventDefault()}
                    onCloseAutoFocus={(e) => e.preventDefault()}
                  >
                    <Command shouldFilter={false}>
                      <CommandList
                        className="max-h-[280px] overflow-y-auto"
                        onWheel={(e) => e.stopPropagation()}
                        onScroll={(e) => setMaterialListScrollTop(e.currentTarget.scrollTop)}
                      >
                        <CommandGroup>
                          {/* Custom value row — withheld while the server search for the
                              latest keystroke is still pending, so this never flashes
                              against a result set that hasn't caught up yet. */}
                          {materialSearch && !isMaterialSearchPending && !materialOptionMatches.some(n => n.toLowerCase() === materialSearch.toLowerCase()) && (
                            <div
                              onClick={() => {
                                setFormData({ ...formData, material: materialSearch, materialGrade: '' });
                                setMaterialOpen(false);
                              }}
                              className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm text-primary hover:bg-secondary border-b border-border"
                            >
                              <Plus className="h-3.5 w-3.5 shrink-0" />
                              <span>Use <span className="font-medium">&quot;{materialSearch}&quot;</span> as custom material</span>
                            </div>
                          )}
                          {/* DB material names — virtualized: the wrapper reserves the
                              full scroll height for every real match, but only the rows
                              in (or near) view are actually mounted. */}
                          {materialOptionMatches.length > 0 && (
                            <div
                              style={{ position: 'relative', height: materialOptionMatches.length * MATERIAL_ROW_HEIGHT_PX }}
                            >
                              {materialOptionMatches.slice(materialVisibleRange.start, materialVisibleRange.end).map((name, i) => {
                                const index = materialVisibleRange.start + i;
                                return (
                                  <div
                                    key={name}
                                    onClick={() => {
                                      const picked = name === formData.material ? '' : name;
                                      // A raw_materials row is a grade: it is the part's
                                      // Material Grade, which costing, machining need and
                                      // the item page all read. A typed custom value stays
                                      // material only (not a verified grade).
                                      setFormData({
                                        ...formData, material: picked, materialGrade: picked,
                                        ...(picked ? { materialSource: 'manual' } : {}),
                                      });
                                      setMaterialOpen(false);
                                      if (picked) applyMaterialProcess(picked);
                                      else setMaterialProcessChoices([]);
                                    }}
                                    style={{ position: 'absolute', top: index * MATERIAL_ROW_HEIGHT_PX, left: 0, right: 0, height: MATERIAL_ROW_HEIGHT_PX }}
                                    className={`flex cursor-pointer items-center px-3 text-sm ${
                                      formData.material === name
                                        ? 'bg-primary text-primary-foreground font-medium'
                                        : 'text-popover-foreground hover:bg-secondary'
                                    }`}
                                  >
                                    <Check className={`mr-2 h-4 w-4 shrink-0 ${formData.material === name ? 'opacity-100' : 'opacity-0'}`} />
                                    <span className="font-medium truncate">{name}</span>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          {!isMaterialSearchPending && materialOptionMatches.length === 0 && materialSearch && (
                            <div className="px-3 py-4 text-sm text-muted-foreground text-center">
                              No matches in database — custom value will be saved.
                            </div>
                          )}
                        </CommandGroup>
                        {(isLoadingMaterials || isMaterialSearchPending) && (
                          <div className="flex items-center justify-center gap-2 py-2 border-t border-border text-xs text-muted-foreground">
                            <Loader2 className="h-3 w-3 animate-spin" />Searching…
                          </div>
                        )}
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
            </div>
            </div>

            {/* Description */}
            <div className="grid gap-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                placeholder="Detailed description of the part..."
                rows={2}
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              />
            </div>

            {/* 2D Drawing + Make/Buy — side by side */}
            <div className="grid grid-cols-2 gap-4 border-t pt-4">
            <div className="grid gap-2">
              <Label className="flex items-center gap-2">
                <FileText className="h-4 w-4" />
                2D Drawing (PDF, PNG, JPG)
              </Label>
              <input
                id="file2d"
                type="file"
                accept=".pdf,.png,.jpg,.jpeg"
                className="hidden"
                onChange={(e) => setFormData({ ...formData, file2d: e.target.files?.[0] || null })}
              />
              <label
                htmlFor="file2d"
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-dashed border-border bg-muted/30 hover:bg-muted/60 cursor-pointer text-xs text-muted-foreground transition-colors w-fit"
              >
                <FileText className="h-3.5 w-3.5" />
                {formData.file2d ? formData.file2d.name : 'Choose file…'}
              </label>
              {isAnalyzing2d ? (
                <div className="flex items-center gap-2 text-xs text-blue-600">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span>Analysing drawing…</span>
                </div>
              ) : formData.file2d ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <CheckCircle className="h-3 w-3 text-green-500" />
                  <span>{(formData.file2d.size / 1024 / 1024).toFixed(1)} MB</span>
                  {formData.drawingIntelligence && (
                    <span className="text-green-600 font-medium">· Drawing intelligence ready</span>
                  )}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Upload technical drawings, blueprints, or dimensional sketches</p>
              )}
            </div>

            {/* Make or Buy */}
            <div className="grid gap-3">
              <Label>Make or Buy Decision</Label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="makeBuy"
                    value="make"
                    checked={formData.makeBuy === 'make'}
                    onChange={(e) => setFormData({ ...formData, makeBuy: e.target.value as 'make' | 'buy' })}
                    className="h-4 w-4 text-primary"
                  />
                  <span className="text-sm">Manufacturing (Make)</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="makeBuy"
                    value="buy"
                    checked={formData.makeBuy === 'buy'}
                    onChange={(e) => setFormData({ ...formData, makeBuy: e.target.value as 'make' | 'buy' })}
                    className="h-4 w-4 text-primary"
                  />
                  <span className="text-sm">Purchasing (Buy)</span>
                </label>
              </div>
              <p className="text-xs text-muted-foreground">
                {formData.makeBuy === 'make' ? 'Part will be manufactured in-house' : 'Part will be purchased from supplier'}
              </p>

              {formData.makeBuy === 'buy' && (
                <div className="grid gap-2 mt-2 p-4 border rounded-lg bg-muted/30">
                  <Label htmlFor="unitCost" className="flex items-center gap-2">
                    Unit Cost (Purchasing)
                    <span className="text-xs text-muted-foreground font-normal">($)</span>
                  </Label>
                  <Input
                    id="unitCost"
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="Enter supplier quoted price"
                    value={formData.unitCost}
                    onChange={(e) => setFormData({ ...formData, unitCost: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">
                    Supplier quoted price per unit in Indian Rupees (INR)
                  </p>
                </div>
              )}
            </div>
            </div>{/* end 2D Drawing + Make/Buy grid */}

            {/* Quantity & Annual Volume */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="grid gap-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="quantity">Quantity *</Label>
                  <Button type="button" variant="ghost" size="sm" className="h-auto p-0 text-muted-foreground hover:text-foreground" onClick={() => toggleHelp('quantity')}>
                    <HelpCircle className="h-3 w-3" />
                  </Button>
                </div>
                <Input
                  id="quantity"
                  type="number"
                  min="1"
                  value={formData.quantity || ''}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => setFormData({ ...formData, quantity: parseInt(e.target.value) || 0 })}
                  className={validationErrors.quantity ? 'border-red-500 focus:border-red-500' : ''}
                  required
                />
                {validationErrors.quantity && (
                  <div className="flex items-center gap-1 text-xs text-red-600">
                    <XCircle className="h-3 w-3" /><span>{validationErrors.quantity}</span>
                  </div>
                )}
                {showHelp.quantity && (
                  <Alert className="mt-2">
                    <Info className="h-4 w-4" />
                    <AlertTitle className="text-sm">Quantity Guidelines</AlertTitle>
                    <AlertDescription className="text-xs mt-1">
                      <ul className="list-disc list-inside space-y-1">
                        <li>Number of this item needed in the parent assembly</li>
                        <li>Should be the quantity per assembly, not total production</li>
                        <li>For example: If an engine needs 4 pistons, enter &quot;4&quot;</li>
                        <li>Must be a positive integer greater than 0</li>
                      </ul>
                    </AlertDescription>
                  </Alert>
                )}
              </div>

              <div className="grid gap-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="annualVolume">Annual Volume *</Label>
                  <Button type="button" variant="ghost" size="sm" className="h-auto p-0 text-muted-foreground hover:text-foreground" onClick={() => toggleHelp('annualVolume')}>
                    <HelpCircle className="h-3 w-3" />
                  </Button>
                </div>
                <Input
                  id="annualVolume"
                  type="number"
                  min="1"
                  value={formData.annualVolume ?? ''}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => setFormData({ ...formData, annualVolume: e.target.value === '' ? null : (parseInt(e.target.value) || null) })}
                  className={validationErrors.annualVolume ? 'border-red-500 focus:border-red-500' : ''}
                  required
                />
                {validationErrors.annualVolume && (
                  <div className="flex items-center gap-1 text-xs text-red-600">
                    <XCircle className="h-3 w-3" /><span>{validationErrors.annualVolume}</span>
                  </div>
                )}
                {showHelp.annualVolume && (
                  <Alert className="mt-2">
                    <Info className="h-4 w-4" />
                    <AlertTitle className="text-sm">Annual Volume Guidelines</AlertTitle>
                    <AlertDescription className="text-xs mt-1">
                      <ul className="list-disc list-inside space-y-1">
                        <li>Expected number of units needed per year</li>
                        <li>Used for cost calculations and supplier negotiations</li>
                        <li>Consider production forecasts and demand planning</li>
                        <li>Include safety stock and buffer requirements</li>
                      </ul>
                    </AlertDescription>
                  </Alert>
                )}
              </div>

              {/* Batch Production — always annualVolume / 4; editing updates annualVolume */}
              <div className="grid gap-2">
                <Label>Batch Production</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.annualVolume == null ? '' : parseFloat((formData.annualVolume / BATCHES_PER_YEAR).toFixed(2))}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => {
                    const batch = parseFloat(e.target.value) || 0;
                    setFormData({ ...formData, annualVolume: batch > 0 ? Math.round(batch * BATCHES_PER_YEAR) : null });
                  }}
                />
                <p className="text-xs text-muted-foreground">Quarterly batch size</p>
              </div>
            </div>

            {/* Physical Properties */}
            <div className="border-t pt-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-medium">Physical Properties (Optional)</h4>
                  {(formData.volume > 0 || formData.weight > 0 || formData.surfaceArea > 0 || formData.maxLength > 0) && (
                    <span className="text-xs text-blue-600 bg-blue-50 dark:bg-blue-950/20 px-2 py-1 rounded">Auto-extracted</span>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                {[
                  { id: 'volume',      label: 'Volume (mm³)',      decimals: 2 },
                  { id: 'weight',      label: 'Weight (kg)',        decimals: 4 },
                  { id: 'surfaceArea', label: 'Surface Area (mm²)', decimals: 2 },
                  { id: 'maxLength',   label: 'Max Length (mm)',    decimals: 2 },
                  { id: 'maxWidth',    label: 'Max Width (mm)',     decimals: 2 },
                  { id: 'maxHeight',   label: 'Max Height (mm)',    decimals: 2 },
                ].map(({ id, label, decimals }) => (
                  <div key={id} className="grid gap-2">
                    <Label htmlFor={id} className="flex items-center">
                      {label}
                      <AutoBadge field={id} />
                    </Label>
                    <Input
                      id={id}
                      type="number"
                      step={decimals === 4 ? '0.0001' : '0.01'}
                      min="0"
                      value={
                        (() => {
                          const v = formData[id as keyof typeof formData] as number;
                          return v ? parseFloat(v.toFixed(decimals)) : '';
                        })()
                      }
                      onChange={(e) => {
                        setFormData({ ...formData, [id]: parseFloat(parseFloat(e.target.value).toFixed(decimals)) || 0 });
                        setAutoFilledFields(prev => { const s = new Set(prev); s.delete(id); return s; });
                      }}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* UOM & Item Type */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="unit">UOM</Label>
                <Select value={formData.unit} onValueChange={(value) => setFormData({ ...formData, unit: value })}>
                  <SelectTrigger id="unit"><SelectValue placeholder="Select unit" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pcs">Pieces</SelectItem>
                    <SelectItem value="kg">Kilograms</SelectItem>
                    <SelectItem value="lbs">Pounds</SelectItem>
                    <SelectItem value="m">Meters</SelectItem>
                    <SelectItem value="ft">Feet</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="itemType">Type *</Label>
                  {formData.bomLevel && (
                    <Badge variant="secondary" className="text-xs">BOM Level: {formData.bomLevel}</Badge>
                  )}
                </div>
                <Select value={formData.itemType} onValueChange={(value) => setFormData({ ...formData, itemType: value as BOMItemType })}>
                  <SelectTrigger id="itemType"><SelectValue placeholder="Select type" /></SelectTrigger>
                  <SelectContent>
                    {([BOMItemType.CHILD_PART, BOMItemType.SUB_ASSEMBLY, BOMItemType.ASSEMBLY] as BOMItemType[]).map((type) => (
                      <SelectItem key={type} value={type}>{ITEM_TYPE_LABELS[type]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="space-y-1">
                  {!item && autoParentId && formData.itemType !== BOMItemType.ASSEMBLY && (
                    <p className="text-xs text-muted-foreground">
                      Will be added under:{' '}
                      {formData.itemType === BOMItemType.SUB_ASSEMBLY ? 'Latest Assembly' :
                        formData.itemType === BOMItemType.CHILD_PART ? 'Latest Sub-Assembly' : ''}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">BOM Level is automatically assigned based on item type</p>
                </div>
              </div>
            </div>
          </div>
          </div>

          <DialogFooter className="gap-2 px-6 py-4 border-t shrink-0 bg-background">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={loading || isBatchCreating}>
              Cancel
            </Button>

            {/* Batch create when multiple analyzed files are queued */}
            {!item && pendingFiles.filter(pf => pf.status === 'ready').length > 1 && (
              <Button
                type="button"
                variant="default"
                onClick={handleBatchCreate}
                disabled={isBatchCreating || loading}
                className="min-w-36"
              >
                {isBatchCreating ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Creating…</>
                ) : (
                  <><DollarSign className="mr-2 h-4 w-4" />Create {pendingFiles.filter(pf => pf.status === 'ready').length} BOM Items</>
                )}
              </Button>
            )}

            <Button type="submit" disabled={loading || isBatchCreating || !validationStatus.isValid} className="min-w-24">
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {item ? 'Updating...' : 'Creating...'}
                  {(uploadProgress.file2d !== undefined || uploadProgress.file3d !== undefined) && (
                    <span className="ml-2 text-xs opacity-75">
                      {uploadProgress.file2d ?? uploadProgress.file3d ?? 0}%
                    </span>
                  )}
                </>
              ) : item ? (
                <><CheckCircle className="mr-2 h-4 w-4" />Update Item</>
              ) : (
                <><Plus className="mr-2 h-4 w-4" />Create Item</>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}