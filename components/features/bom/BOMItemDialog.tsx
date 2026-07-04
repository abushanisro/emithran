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
  Cpu,
  DollarSign,
} from 'lucide-react';
import { toast } from 'sonner';
import { createBOMItem, updateBOMItem, analyzeForAutoFill, type AutoFillResponse } from '@/lib/api/hooks/useBOMItems';
import type { DrawingAnalysisResult } from '@/lib/api/vave';
import { BOMItemType, ITEM_TYPE_LABELS } from '@/lib/types/bom.types';
import { apiClient } from '@/lib/api/client';
import { useQueryClient, useQuery, keepPreviousData } from '@tanstack/react-query';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

type MaterialCategory = 'PLASTIC_RUBBER' | 'FERROUS_NON_FERROUS' | '';

interface RawMaterial {
  id?: string;
  materialName?: string;
  materialGrade?: string;
  material?: string;
  materialGroup?: string;
  categoryName?: string;
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

interface MaterialOption {
  grade: string;
  material: string | undefined;
  materialGroup: string | undefined;
  materialType: string | undefined;
  materialDescription: string | undefined;
  density: number | undefined;
  cost: number | undefined;
  currency: string | undefined;
  ultimateTensileStrength: number | undefined;
  yieldTensileStrength: number | undefined;
  shearingStrength: number | undefined;
  astmStandard: string | undefined;
  dinStandard: string | undefined;
  enStandard: string | undefined;
  jisStandard: string | undefined;
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

  const [materialGradeOpen, setMaterialGradeOpen] = useState(false);
  const [materialGradeSearch, setMaterialGradeSearch] = useState('');
  const [debouncedMaterialGradeSearch, setDebouncedMaterialGradeSearch] = useState('');
  const [selectedMaterialCategory, setSelectedMaterialCategory] = useState<MaterialCategory>('');
  const [activeResult, setActiveResult] = useState<AutoFillResponse | null>(null);

  // Debounce search input
  useEffect(() => {
    if (!materialGradeOpen) return;
    const timer = setTimeout(() => {
      setDebouncedMaterialGradeSearch(materialGradeSearch);
    }, 500);
    return () => clearTimeout(timer);
  }, [materialGradeSearch, materialGradeOpen]);

  // Fetch raw materials
  const { data: rawMaterialsData, isLoading: isLoadingMaterials } = useQuery<RawMaterialsResponse>({
    queryKey: ['raw-materials', selectedMaterialCategory, debouncedMaterialGradeSearch, activeResult?.suggestions.familyClassification],
    queryFn: async (): Promise<RawMaterialsResponse> => {
      if (!selectedMaterialCategory) return { items: [] };

      const endpoint = '/raw-materials/enhanced';
      const params: Record<string, unknown> = {
        limit: 1000,
        category: selectedMaterialCategory === 'PLASTIC_RUBBER' ? 'PLASTIC' : 'FERROUS',
      };

      if (activeResult?.suggestions.familyClassification) {
        params.partFamily = activeResult.suggestions.familyClassification;
      }

      if (debouncedMaterialGradeSearch?.trim()) {
        const sanitizedSearch = debouncedMaterialGradeSearch
          .replace(/[,()%]/g, ' ')
          .trim()
          .split(/\s+/)
          .filter((word: string) => word.length > 2)
          .join(' ');
        if (sanitizedSearch.length > 0) {
          params.search = sanitizedSearch;
        }
      }

      try {
        const response = await apiClient.get(endpoint, { params }) as RawMaterialsResponse;


        return response;
      } catch (error: unknown) {
        const err = error as Record<string, unknown>;
        if (typeof err?.message === 'string' && err.message.includes('failed to parse logic tree') && params.search) {
          delete params.search;
          return (await apiClient.get(endpoint, { params })) as RawMaterialsResponse;
        }

        if (typeof err?.message === 'string' && err.message.includes('Circuit breaker is OPEN')) {
          return { items: [] };
        }

        if (
          typeof err?.message === 'string' &&
          (err.message.includes('does not exist') || err.message.includes('column'))
        ) {
          return { items: [] };
        }

        throw error;
      }
    },
    enabled: !!selectedMaterialCategory,
    placeholderData: keepPreviousData,
    staleTime: 1000 * 60 * 5,
    retry: (failureCount: number, error: unknown) => {
      const err = error as Record<string, unknown>;
      if (
        typeof err?.message === 'string' &&
        (err.message.includes('Circuit breaker is OPEN') ||
          err.message.includes('does not exist') ||
          err.message.includes('column'))
      ) {
        return false;
      }
      return failureCount < 2;
    },
    retryDelay: (attemptIndex: number) => Math.min(1000 * 2 ** attemptIndex, 30000),
  });

  // Derive material options
  const materialOptions = useMemo((): MaterialOption[] => {
    if (!rawMaterialsData?.items || !selectedMaterialCategory) return [];

    const gradesWithMaterials: MaterialOption[] = rawMaterialsData.items
      .map((material: RawMaterial): MaterialOption | null => {
        const specificGrade = material.materialName?.trim() || material.material?.trim();
        if (!specificGrade || specificGrade.length === 0) return null;

        return {
          grade: specificGrade,
          material: material.materialName ?? material.material,
          materialGroup: material.materialGroup ?? material.categoryName,
          materialType: material.materialType,
          materialDescription: material.materialDescription ?? material.description,
          density: material.density ?? material.densityKgM3,
          cost: material.unitCost ?? material.cost,
          currency: material.currency,
          ultimateTensileStrength: material.ultimateTensileStrength ?? material.ultimate_tensile_strength,
          yieldTensileStrength: material.yieldTensileStrength ?? material.yield_tensile_strength,
          shearingStrength: material.shearingStrength ?? material.shearing_strength,
          astmStandard: material.astmStandard ?? material.astm_standard,
          dinStandard: material.dinStandard ?? material.din_standard,
          enStandard: material.enStandard ?? material.en_standard,
          jisStandard: material.jisStandard ?? material.jis_standard
        };
      })
      .filter((item: MaterialOption | null): item is MaterialOption => item !== null);

    const seen = new Set<string>();
    return gradesWithMaterials
      .filter((item: MaterialOption) => {
        if (seen.has(item.grade)) return false;
        seen.add(item.grade);
        return true;
      })
      .sort((a: MaterialOption, b: MaterialOption) => a.grade.localeCompare(b.grade));
  }, [rawMaterialsData, selectedMaterialCategory]);

  const [loading, setLoading] = useState(false);
  const [autoParentId, setAutoParentId] = useState<string | null>(null);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
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
  const [fieldConfidences, setFieldConfidences] = useState<Record<string, number>>({});
  const [formData, setFormData] = useState({
    name: '',
    partNumber: '',
    description: '',
    itemType: defaultItemType || ('' as BOMItemType),
    quantity: 1,
    annualVolume: 1000,
    unit: 'pcs',
    material: '',
    materialCategory: '' as MaterialCategory,
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

  useEffect(() => { itemRef.current = item; }, [item]);

  const calculateCompletionPercentage = () => {
    const requiredFields = ['name', 'partNumber', 'quantity', 'annualVolume', 'itemType'];
    const optionalFields = ['description', 'materialGrade', 'weight'];
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

    if (formData.annualVolume <= 0) {
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

  // Sync material category
  useEffect(() => {
    if (formData.materialCategory !== selectedMaterialCategory) {
      setSelectedMaterialCategory(formData.materialCategory);
    }
  }, [formData.materialCategory]);

  useEffect(() => {
    if (formData.materialGrade && selectedMaterialCategory !== formData.materialCategory) {
      setFormData(prev => ({ ...prev, materialGrade: '' }));
    }
  }, [selectedMaterialCategory]);

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
    const geometryAvailable = r.cadEngineAvailable;
    setFormData(prev => {
      const patch: Partial<typeof prev> = {};
      // Name and part number always come from filename — safe regardless of CAD state
      if (!prev.name) { patch.name = r.suggestions.name; filled.add('name'); }
      if (!prev.partNumber) { patch.partNumber = r.suggestions.partNumber; filled.add('partNumber'); }
      // Geometry fields: only fill when CAD engine was online and returned real data
      if (geometryAvailable && !prev.volume) { patch.volume = r.geometry.volume; filled.add('volume'); }
      if (geometryAvailable && !prev.weight) { patch.weight = r.geometry.weight; filled.add('weight'); }
      if (geometryAvailable && !prev.surfaceArea) { patch.surfaceArea = r.geometry.surfaceArea; filled.add('surfaceArea'); }
      if (geometryAvailable && !prev.maxLength) { patch.maxLength = r.geometry.boundingBox.length; filled.add('maxLength'); }
      if (geometryAvailable && !prev.maxWidth) { patch.maxWidth = r.geometry.boundingBox.width; filled.add('maxWidth'); }
      if (geometryAvailable && !prev.maxHeight) { patch.maxHeight = r.geometry.boundingBox.height; filled.add('maxHeight'); }
      // Material: process classification is unreliable without geometry — skip when CAD offline
      if (geometryAvailable && !prev.materialCategory && r.suggestions.materialCategory) {
        patch.materialCategory = r.suggestions.materialCategory as MaterialCategory;
        filled.add('materialCategory');
        setSelectedMaterialCategory(r.suggestions.materialCategory as MaterialCategory);
      }
      if (geometryAvailable && !prev.materialGrade && r.suggestions.materialGrade) {
        patch.materialGrade = r.suggestions.materialGrade;
        patch.materialSource = 'cad';
        patch.materialConfidence = 0.6;
        filled.add('materialGrade');
      }
      // makeBuy and itemType are safe defaults — fill always
      if (!prev.makeBuy || prev.makeBuy === 'make') {
        patch.makeBuy = r.suggestions.makeBuy;
        filled.add('makeBuy');
      }
      if (r.suggestions.itemType) {
        patch.itemType = r.suggestions.itemType as BOMItemType;
        filled.add('itemType');
      }
      // Process type and sheet metal features require real geometry
      if (geometryAvailable && !prev.processType && r.suggestions.processType) {
        patch.processType = r.suggestions.processType;
        filled.add('processType');
      }
      if (geometryAvailable && !prev.holeCount && r.geometry.holeCount > 0) {
        patch.holeCount = r.geometry.holeCount;
        filled.add('holeCount');
      }
      if (geometryAvailable && !prev.bendCount && r.geometry.bendCount > 0) {
        patch.bendCount = r.geometry.bendCount;
        filled.add('bendCount');
      }
      if (geometryAvailable && !prev.cutLengthMm && r.geometry.cutLengthMm > 0) {
        patch.cutLengthMm = r.geometry.cutLengthMm;
        filled.add('cutLengthMm');
      }
      if (geometryAvailable && !prev.sheetThicknessMm && r.geometry.sheetThicknessMm > 0) {
        patch.sheetThicknessMm = r.geometry.sheetThicknessMm;
        filled.add('sheetThicknessMm');
      }
      if (geometryAvailable && !prev.pierceCount && r.geometry.pierceCount > 0) {
        patch.pierceCount = r.geometry.pierceCount;
        filled.add('pierceCount');
      }
      if (geometryAvailable && !prev.flatPatternAreaMm2 && r.geometry.flatPatternAreaMm2 > 0) {
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
    setFieldConfidences(prev => {
      const next = { ...prev };
      const geoFields = ['volume','weight','surfaceArea','maxLength','maxWidth','maxHeight','holeCount','bendCount','cutLengthMm','sheetThicknessMm','pierceCount','flatPatternAreaMm2'];
      filled.forEach(f => {
        if (geoFields.includes(f)) next[f] = r.confidence.geometry;
        else if (f === 'materialCategory' || f === 'materialGrade') next[f] = r.confidence.material;
        else if (f === 'processType') next[f] = r.confidence.process;
        else next[f] = r.confidence.overall;
      });
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
      const result = await analyzeForAutoFill(item.file);
      updatePendingFileResult(item.id, result);
      if (isFirst) {
        setActiveFileId(item.id);
        populateFormFromResult(result);
      }
    } catch (e: any) {
      updatePendingFileStatus(item.id, 'error', e?.message ?? 'Analysis failed');
      toast.error(`Could not analyze ${item.file.name}`, {
        description: 'Check that the file is a valid STEP / STL / IGES and try again.',
        duration: 5000,
      });
    }
  }, [updatePendingFileStatus, updatePendingFileResult, populateFormFromResult]);

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
        setFormData(prev => ({ ...prev, file3d: modelFiles[0] }));
      }
      await Promise.allSettled(
        modelItems.map((item, i) => analyzeFile(item, isFirstBatch && i === 0))
      );
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
    accept: { 'application/octet-stream': ['.step', '.stp', '.stl', '.iges', '.igs', '.obj', '.dxf', '.dwg'] },
    maxSize: 100 * 1024 * 1024,
    multiple: true,
    noClick: false,
  });

  useEffect(() => {
    setValidationErrors(validationStatus.errors);
  }, [validationStatus.errors]);

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
      let materialCategory: MaterialCategory = '';
      if (item.materialGrade || item.material) {
        const materialInfo = (item.materialGrade || item.material || '').toLowerCase();
        const isPlastic = materialInfo.includes('plastic') || materialInfo.includes('polymer') ||
          materialInfo.includes('rubber') || materialInfo.includes('elastomer');
        materialCategory = isPlastic ? 'PLASTIC_RUBBER' : 'FERROUS_NON_FERROUS';
      }

      setFormData({
        name: item.name || '',
        partNumber: item.partNumber || '',
        description: item.description || '',
        itemType: item.itemType || BOMItemType.ASSEMBLY,
        quantity: item.quantity || 1,
        annualVolume: item.annualVolume || 1000,
        unit: item.unit || 'pcs',
        material: item.material || '',
        materialCategory,
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
        processType: (item as any).processType || '',
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
      setSelectedMaterialCategory(materialCategory);
    } else {
      setFormData({
        name: '',
        partNumber: '',
        description: '',
        itemType: defaultItemType || ('' as BOMItemType),
        quantity: 1,
        annualVolume: 1000,
        unit: 'pcs',
        material: '',
        materialCategory: '',
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
      setSelectedMaterialCategory('');
    }
    // Reset multi-file state whenever dialog opens fresh
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
          reader.onload = () => resolve((reader.result as string).split(',')[1]);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        const res = await fetch('/api/vave/drawing-analysis', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageBase64, mediaType, partNumber: formData.partNumber }),
        });
        if (!res.ok) throw new Error(`Drawing analysis failed (${res.status}): ${await res.text()}`);
        const result: DrawingAnalysisResult = await res.json();

        const filled = new Set<string>();

        setFormData(prev => {
          const patch: Partial<typeof prev> = {};

          // Material — drawing is authoritative; always overrides CAD material.
          // Placeholder strings from the extractor are not grades — never store them.
          const mat = result.material ?? '';
          if (mat && !/^(unknown|not\s*specified|none|n\/?a)$/i.test(mat.trim())) {
            patch.materialGrade = mat;
            patch.materialSource = 'drawing';
            patch.materialConfidence = result.material_confidence ?? 0.5;
            filled.add('materialGrade');
            const isPlastic = /plastic|rubber|polymer|nylon|pvc|abs|pp|pe|pa|pom|peek|ptfe/i.test(mat);
            patch.materialCategory = isPlastic ? 'PLASTIC_RUBBER' : 'FERROUS_NON_FERROUS';
            filled.add('materialCategory');
            setSelectedMaterialCategory(isPlastic ? 'PLASTIC_RUBBER' : 'FERROUS_NON_FERROUS');
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
          if ((result.hole_count ?? 0) > 0 && !prev.holeCount) {
            patch.holeCount = (result as any).hole_count;
            filled.add('holeCount');
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
          if (filled.has('materialGrade'))      next['materialGrade']      = result.material_confidence ?? 0.5;
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

  // Live weight calculation: whenever volume or materialGrade changes, look up density
  // and recompute weight = (volume_mm3 / 1e6) * density_g_cm3
  useEffect(() => {
    if (!formData.volume || !formData.materialGrade) return;
    // Only recalculate if weight hasn't been manually edited (i.e. it's still auto-filled or zero)
    if (formData.weight && !autoFilledFields.has('weight')) return;

    const controller = new AbortController();
    const recalculate = async () => {
      try {
        const result = await apiClient.get<{ density_g_cm3: number | null }>(
          `/bom-items/material-density?grade=${encodeURIComponent(formData.materialGrade)}`,
        );
        // Reject implausible densities — real engineering materials are > 0.5 g/cm³
        if (!result?.density_g_cm3 || result.density_g_cm3 < 0.5) return;
        if (controller.signal.aborted) return;
        const computed = parseFloat(((formData.volume / 1e6) * result.density_g_cm3).toFixed(4));
        setFormData(prev => ({ ...prev, weight: computed }));
        setAutoFilledFields(prev => { const s = new Set(prev); s.add('weight'); return s; });
        setFieldLineage(prev => ({
          ...prev,
          weight: { source: 'derived', inputs: ['volume', 'materialGrade'] },
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
  }, [formData.volume, formData.materialGrade]);

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
        annualVolume: formData.annualVolume,
        unit: formData.unit,
        material: formData.material || undefined,
        materialCategory: formData.materialCategory || undefined,
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
          itemType: (r.suggestions.itemType as BOMItemType) || BOMItemType.CHILD_PART,
          parentItemId: finalParentId || undefined,
          quantity: 1,
          annualVolume: 1000,
          unit: 'pcs',
          materialCategory: r.suggestions.materialCategory || undefined,
          materialGrade: r.suggestions.materialGrade || undefined,
          makeBuy: r.suggestions.makeBuy || 'make',
          weight: r.geometry.weight || undefined,
          maxLength: r.geometry.boundingBox.length || undefined,
          maxWidth: r.geometry.boundingBox.width || undefined,
          maxHeight: r.geometry.boundingBox.height || undefined,
          surfaceArea: r.geometry.surfaceArea || undefined,
        };
        const newItem = await createBOMItem(payload);

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

  const AutoBadge = ({ field }: { field: string }) => {
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
  };

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
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

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4">
            {/* 3D Models — first so geometry auto-fills the form below */}
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-2">
                  <Package className="h-4 w-4" />
                  3D Models / CAD (STEP, STL, IGES, OBJ, DXF, DWG)
                  {pendingFiles.length > 0 && (
                    <Badge variant="secondary" className="text-xs ml-1">
                      {pendingFiles.length} file{pendingFiles.length !== 1 ? 's' : ''}
                    </Badge>
                  )}
                </Label>
                <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <Cpu className="h-3 w-3 text-cyan-500" />
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
                      {isDragActive ? 'Drop files here…' : 'Drop STEP / STL / IGES / DXF / DWG files, or click to browse'}
                    </p>
                    <p className="text-xs">Multiple files supported · 100 MB max each · DXF/DWG saved as drawing · STEP/STL auto-fills form</p>
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
                        {/\.(dxf|dwg)$/i.test(pf.file.name) ? (
                          <Badge variant="outline" className="text-xs shrink-0">DXF Drawing</Badge>
                        ) : pf.result ? (
                          <>
                            <Badge variant="secondary" className="text-xs shrink-0">{pf.result.suggestions.processType}</Badge>
                            {pf.result.suggestions.materialGrade && (
                              <Badge variant="outline" className="text-xs shrink-0 max-w-[80px] truncate">
                                {pf.result.suggestions.materialGrade}
                              </Badge>
                            )}
                          </>
                        ) : null}
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
              {activeResult?.costs && activeResult.cadEngineAvailable && (
                <div className="rounded-md bg-muted/50 border p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <Cpu className="h-3 w-3 text-cyan-500" />
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Cost Preview · review before saving
                    </p>
                    <Badge variant="outline" className="text-[10px] px-1 py-0 text-cyan-500 border-cyan-500/40 ml-auto">
                      {Math.round((activeResult.confidence.overall ?? 0) * 100)}% confidence
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    {activeResult.costs.materialCostPerKg !== null && (
                      <>
                        <span className="text-muted-foreground">Material cost/kg</span>
                        <span className="font-mono">₹ {activeResult.costs.materialCostPerKg?.toFixed(2)}</span>
                      </>
                    )}
                    {activeResult.costs.mhrRate !== null && (
                      <>
                        <span className="text-muted-foreground">Machine hour rate</span>
                        <span className="font-mono">₹ {activeResult.costs.mhrRate?.toFixed(2)}/hr</span>
                      </>
                    )}
                    {activeResult.costs.lhrRate !== null && (
                      <>
                        <span className="text-muted-foreground">Labour hour rate</span>
                        <span className="font-mono">₹ {activeResult.costs.lhrRate?.toFixed(2)}/hr</span>
                      </>
                    )}
                    {activeResult.costs.estimatedUnitCost !== null && (
                      <>
                        <span className="text-muted-foreground font-medium">Est. unit cost</span>
                        <span className="font-mono font-semibold text-primary">
                          ₹ {activeResult.costs.estimatedUnitCost?.toFixed(2)}
                        </span>
                      </>
                    )}
                  </div>
                  {!activeResult.cadEngineAvailable && (
                    <p className="text-[10px] text-amber-600 dark:text-amber-400">
                      ⚠ CAD engine offline — geometry from bounding-box estimate
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Name */}
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

            {/* Part Number */}
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

            {/* Description */}
            <div className="grid gap-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                placeholder="Detailed description of the part..."
                rows={3}
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              />
            </div>

            {/* Material Category */}
            <div className="grid gap-2">
              <Label htmlFor="materialCategory" className="flex items-center">Material Category <AutoBadge field="materialCategory" /></Label>
              <Select
                value={formData.materialCategory}
                onValueChange={(value: MaterialCategory) => {
                  setFormData({ ...formData, materialCategory: value, materialGrade: '' });
                  setSelectedMaterialCategory(value);
                  setMaterialGradeSearch('');
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select material category..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PLASTIC_RUBBER">Plastic &amp; Rubber</SelectItem>
                  <SelectItem value="FERROUS_NON_FERROUS">Ferrous &amp; Non-Ferrous (Metals)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {formData.materialCategory === 'PLASTIC_RUBBER' &&
                  `Thermoplastic and rubber-based materials including polymers, elastomers, and composites (${rawMaterialsData?.items?.length ?? 0} available)`
                }
                {formData.materialCategory === 'FERROUS_NON_FERROUS' &&
                  `All metallic materials including iron-based materials (steel, cast iron) and non-iron metals (aluminum, copper, titanium) (${rawMaterialsData?.items?.length ?? 0} available)`
                }
                {!formData.materialCategory && 'Choose the type of material to see relevant grades from your database'}
              </p>
            </div>

            {/* Material Grade */}
            {formData.materialCategory && (
              <div className="grid gap-2">
                <Label htmlFor="materialGrade">Material Grade</Label>
                <Popover open={materialGradeOpen} onOpenChange={setMaterialGradeOpen}>
                  <PopoverTrigger asChild>
                    <div className="relative">
                      <Input
                        id="materialGrade"
                        value={formData.materialGrade || ''}
                        onChange={(e) => {
                          const value = e.target.value;
                          setFormData({ ...formData, materialGrade: value });
                          setMaterialGradeSearch(value);
                          if (!materialGradeOpen) setMaterialGradeOpen(true);
                        }}
                        onFocus={() => {
                          setMaterialGradeOpen(true);
                          setMaterialGradeSearch(formData.materialGrade || '');
                        }}
                        onClick={(e) => { e.stopPropagation(); setMaterialGradeOpen(true); }}
                        placeholder={`Type or select ${formData.materialCategory === 'PLASTIC_RUBBER' ? 'plastic/rubber' : 'metal'} grade...`}
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
                      <CommandList className="max-h-[280px] overflow-y-auto" onWheel={(e) => e.stopPropagation()}>
                        <CommandGroup>
                          {/* Custom value row — shown when typed text has no exact DB match */}
                          {materialGradeSearch && !materialOptions.some(o => o.grade.toLowerCase() === materialGradeSearch.toLowerCase()) && (
                            <div
                              onClick={() => {
                                setFormData({ ...formData, materialGrade: materialGradeSearch });
                                setMaterialGradeOpen(false);
                              }}
                              className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm text-primary hover:bg-secondary border-b border-border"
                            >
                              <Plus className="h-3.5 w-3.5 shrink-0" />
                              <span>Use <span className="font-medium">&quot;{materialGradeSearch}&quot;</span> as custom grade</span>
                            </div>
                          )}

                          {/* DB results */}
                          {materialOptions.map((gradeInfo: MaterialOption) => (
                            <div
                              key={gradeInfo.grade}
                              onClick={() => {
                                setFormData({
                                  ...formData,
                                  materialGrade: gradeInfo.grade === formData.materialGrade ? '' : gradeInfo.grade
                                });
                                setMaterialGradeOpen(false);
                              }}
                              className={`flex cursor-pointer items-center justify-between px-3 py-2 text-sm
                                ${formData.materialGrade === gradeInfo.grade
                                  ? 'bg-primary text-primary-foreground font-medium'
                                  : 'text-popover-foreground hover:bg-secondary'
                                }`}
                            >
                              <div className="flex items-center">
                                <Check className={`mr-2 h-4 w-4 shrink-0 ${formData.materialGrade === gradeInfo.grade ? 'opacity-100' : 'opacity-0'}`} />
                                <div>
                                  <span className="font-medium">{gradeInfo.grade}</span>
                                  {gradeInfo.materialDescription && (
                                    <div className="text-xs text-muted-foreground">{gradeInfo.materialDescription}</div>
                                  )}
                                  {gradeInfo.astmStandard && (
                                    <div className="text-xs text-muted-foreground/70">ASTM: {gradeInfo.astmStandard}</div>
                                  )}
                                </div>
                              </div>
                              <div className="text-xs text-muted-foreground text-right shrink-0 ml-2">
                                {gradeInfo.density && `${gradeInfo.density} g/cm³`}
                                {gradeInfo.cost && <div>₹{gradeInfo.cost.toFixed(2)}</div>}
                                {gradeInfo.ultimateTensileStrength && (
                                  <div>UTS: {gradeInfo.ultimateTensileStrength} MPa</div>
                                )}
                              </div>
                            </div>
                          ))}

                          {/* Empty states */}
                          {!isLoadingMaterials && materialOptions.length === 0 && materialGradeSearch && (
                            <div className="px-3 py-4 text-sm text-muted-foreground text-center">
                              No matches in database — custom value will be saved.
                            </div>
                          )}
                          {!isLoadingMaterials && materialOptions.length === 0 && !materialGradeSearch && (
                            <div className="px-3 py-4 text-sm text-muted-foreground text-center space-y-1">
                              <p>No materials found in this category.</p>
                              <button
                                onClick={() => queryClient.invalidateQueries({ queryKey: ['raw-materials'] })}
                                className="text-primary hover:underline text-xs"
                              >
                                Retry
                              </button>
                            </div>
                          )}
                        </CommandGroup>

                        {/* Non-blocking loading indicator */}
                        {isLoadingMaterials && (
                          <div className="flex items-center justify-center gap-2 py-2 border-t border-border text-xs text-muted-foreground">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            Searching…
                          </div>
                        )}
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
            )}

            {/* 2D Drawing */}
            <div className="grid gap-2 border-t pt-4">
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
                  <span>Analyzing drawing with Gemini…</span>
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
            <div className="grid gap-3 border-t pt-4">
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
                    <span className="text-xs text-muted-foreground font-normal">(₹)</span>
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
                  value={formData.annualVolume || ''}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => setFormData({ ...formData, annualVolume: parseInt(e.target.value) || 0 })}
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
                  value={parseFloat((formData.annualVolume / 4).toFixed(2)) || ''}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => {
                    const batch = parseFloat(e.target.value) || 0;
                    setFormData({ ...formData, annualVolume: Math.round(batch * 4) });
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

          <DialogFooter className="gap-2">
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