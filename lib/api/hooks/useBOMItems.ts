import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../client';
import { useAuthEnabledWith } from './useAuthEnabled';
import { toast } from 'sonner';
import type { FeatureGraph, DFMScoresResponse, OccurrenceScore } from '@/lib/types/manufacturing';

export type { OccurrenceScore };

export interface BOMItem {
  id: string;
  bomId: string;
  name: string;
  partNumber?: string;
  description?: string;
  itemType: 'assembly' | 'sub_assembly' | 'child_part';
  quantity: number;
  annualVolume: number;
  unit?: string;
  material?: string;
  materialGrade?: string;
  bomLevel?: string;
  materialId?: string;
  makeBuy?: 'make' | 'buy';
  unitCost?: number;
  parentItemId?: string;
  sortOrder: number;
  file3dPath?: string;
  file2dPath?: string;
  fileDxfPath?: string;
  createdAt: string;
  updatedAt: string;
  weight?: number;
  unitWeight?: number;
  maxLength?: number;
  length?: number;
  maxWidth?: number;
  width?: number;
  maxHeight?: number;
  height?: number;
  surfaceArea?: number;
  toleranceGrade?: string;
  surfaceFinish?: string;
  heatTreatment?: string;
  hardness?: string;
  leadTime?: string;
  revision?: string;
  qualityStandard?: string;
  inspectionLevel?: string;
  volume?: number;
  thumbnailUrl?: string;
  partName?: string;
  // Manufacturing feature graph (Phase 1: summary + process recommendations)
  featureGraph?: FeatureGraph;
  // Denormalised from featureGraph.classification for display + filtering
  familyClassification?: string;
  familyConfidence?: number;
  // Phase 1 sheet metal extracted fields
  sheetThicknessMm?: number;
  cutLengthMm?: number;
  bendCount?: number;
  holeCount?: number;
  pierceCount?: number;
  flatPatternAreaMm2?: number;
  // Drawing intelligence — persisted from 2D drawing analysis
  materialSource?: string;
  materialConfidence?: number;
  surfaceFinishRa?: number;
  surfaceFinishConfidence?: number;
  coating?: string;
  coatingConfidence?: number;
  complexity?: string;
  tightestToleranceMm?: number;
  toleranceConfidence?: number;
  drawingIntelligence?: import('@/lib/api/vave').DrawingAnalysisResult;
  validationConfig?: {
    solverType: 'fea_plastic_elastic' | 'fea_elastic_only' | 'geometric_unfolding';
    surfaceForFlattening: 'mid_surface' | 'larger_area' | 'smaller_area';
    fillHolesInBlanks: boolean;
  } | null;
}

export interface MaterialCandidate {
  material: string;
  materialGrade: string | null;
  confidence: number;
  densityKgM3: number | null;
  costPerKg: number | null;
  reasons: string[];
  scoreFactors: string[];
  processCompatibility: Array<{ process: string; suitability: string }>;
}

export function useMaterialIntelligence(itemId: string | undefined) {
  return useQuery({
    queryKey: ['material-intelligence', itemId],
    queryFn: () => apiClient.get<MaterialCandidate[]>(`/bom-items/${itemId}/material-intelligence`),
    enabled: useAuthEnabledWith(!!itemId),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}

export interface CreateBOMItemDto {
  bomId: string;
  name: string;
  partNumber: string;
  description?: string | undefined;
  itemType: 'assembly' | 'sub_assembly' | 'child_part';
  quantity: number;
  annualVolume: number;
  unit?: string | undefined;
  material?: string | undefined;
  materialCategory?: string | undefined;
  materialGrade?: string | undefined;
  makeBuy?: 'make' | 'buy' | undefined;
  unitCost?: number | undefined;
  parentItemId?: string | undefined;
  sortOrder?: number | undefined;
  weight?: number | undefined;
  maxLength?: number | undefined;
  maxWidth?: number | undefined;
  maxHeight?: number | undefined;
  surfaceArea?: number | undefined;
  volume?: number | undefined;
}

export interface UpdateBOMItemDto {
  name?: string | undefined;
  partNumber?: string | undefined;
  description?: string | undefined;
  itemType?: 'assembly' | 'sub_assembly' | 'child_part' | undefined;
  quantity?: number | undefined;
  annualVolume?: number | undefined;
  unit?: string | undefined;
  material?: string | undefined;
  materialCategory?: string | undefined;
  materialGrade?: string | undefined;
  bomLevel?: string | undefined;
  makeBuy?: 'make' | 'buy' | undefined;
  unitCost?: number | undefined;
  parentItemId?: string | undefined;
  sortOrder?: number | undefined;
  weight?: number | undefined;
  maxLength?: number | undefined;
  maxWidth?: number | undefined;
  maxHeight?: number | undefined;
  surfaceArea?: number | undefined;
  volume?: number | undefined;
  validationConfig?: {
    solverType: 'fea_plastic_elastic' | 'fea_elastic_only' | 'geometric_unfolding';
    surfaceForFlattening: 'mid_surface' | 'larger_area' | 'smaller_area';
    fillHolesInBlanks: boolean;
  } | null;
}

const bomItemKeys = {
  all: ['bom-items'] as const,
  lists: () => [...bomItemKeys.all, 'list'] as const,
  list: (bomId?: string) => [...bomItemKeys.lists(), bomId] as const,
  details: () => [...bomItemKeys.all, 'detail'] as const,
  detail: (id: string) => [...bomItemKeys.details(), id] as const,
  analysisVersion: () => [...bomItemKeys.all, 'analysis-version'] as const,
};

/**
 * Hook to fetch BOM items for a specific BOM
 */
export function useBOMItems(bomId?: string) {
  return useQuery({
    queryKey: bomItemKeys.list(bomId),
    queryFn: async () => {
      if (!bomId) return { items: [] };
      return apiClient.get<{ items: BOMItem[] }>(`/bom-items?bomId=${bomId}`);
    },
    enabled: useAuthEnabledWith(!!bomId),
    staleTime: 2 * 60 * 1000, // Fresh for 2 minutes - medium-changing data
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  });
}

/**
 * Hook to fetch a single BOM item
 */
export function useBOMItem(itemId?: string) {
  return useQuery({
    queryKey: bomItemKeys.detail(itemId!),
    queryFn: async () => {
      return apiClient.get<BOMItem>(`/bom-items/${itemId}`);
    },
    enabled: useAuthEnabledWith(!!itemId),
    staleTime: 1000 * 60 * 2,
  });
}

/**
 * Create a new BOM item
 */
export function useCreateBOMItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (dto: CreateBOMItemDto) => {
      return apiClient.post<BOMItem>('/bom-items', dto);
    },
    onSuccess: async (_data, variables) => {
      // Invalidate BOM item queries
      queryClient.invalidateQueries({ queryKey: bomItemKeys.list(variables.bomId) });
      
      // Trigger automatic cost calculation for the BOM
      try {
        await apiClient.post(`/bom/${variables.bomId}/recalculate-all-costs`);
        // Invalidate cost-related queries
        queryClient.invalidateQueries({ queryKey: ['bom-item-cost'] });
        queryClient.invalidateQueries({ queryKey: ['bom-cost-summary'] });
        queryClient.invalidateQueries({ queryKey: ['bom-cost-report'] });
      } catch (error) {
        // Cost recalculation failed but item was created successfully
        console.warn('Auto cost recalculation failed for new BOM item:', error);
      }
    },
    onError: (error: any) => {
      const status = error?.status || error?.response?.status;
      if (status === 400) {
        toast.error('Please check all BOM item details are filled out correctly.');
      } else if (status === 409) {
        toast.error('A BOM item with this part number already exists in this BOM.');
      } else if (status === 403) {
        toast.error('You do not have permission to add items to this BOM.');
      } else if (status === 422) {
        toast.error('Please ensure quantity and volume are valid numbers.');
      } else {
        toast.error('Unable to create BOM item. Please try again or contact support.');
      }
    },
  });
}

/**
 * Update an existing BOM item
 */
export function useUpdateBOMItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateBOMItemDto }) => {
      return apiClient.put<BOMItem>(`/bom-items/${id}`, data);
    },
    onSuccess: async (data) => {
      if (data) {
        // Invalidate BOM item queries
        queryClient.invalidateQueries({ queryKey: bomItemKeys.list(data.bomId) });
        queryClient.invalidateQueries({ queryKey: bomItemKeys.detail(data.id) });
        
        // Invalidate the Manufacturing Intelligence cost/route queries for this item
        queryClient.invalidateQueries({ queryKey: ['bom-items', data.id, 'cost-summary'] });
        queryClient.invalidateQueries({ queryKey: ['bom-items', data.id, 'route-comparison'] });
      }
    },
    onError: (error: any) => {
      const status = error?.status || error?.response?.status;
      if (status === 400) {
        toast.error('Please check that all BOM item information is valid.');
      } else if (status === 404) {
        toast.error('This BOM item no longer exists. It may have been deleted.');
      } else if (status === 409) {
        toast.error('Another user is editing this item. Please refresh and try again.');
      } else if (status === 403) {
        toast.error('You do not have permission to edit this BOM item.');
      } else if (status === 422) {
        toast.error('Please ensure quantity and volume are valid numbers.');
      } else {
        toast.error('Unable to update BOM item. Please try again or contact support.');
      }
    },
  });
}

/**
 * Delete a BOM item
 */
export function useDeleteBOMItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      await apiClient.delete(`/bom-items/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: bomItemKeys.lists() });
    },
    onError: (error: any) => {
      const status = error?.status || error?.response?.status;
      if (status === 404) {
        toast.error('This BOM item has already been deleted.');
      } else if (status === 409) {
        toast.error('Cannot delete BOM item because it has child components.');
      } else if (status === 403) {
        toast.error('You do not have permission to delete this BOM item.');
      } else {
        toast.error('Unable to delete BOM item. Please try again or contact support.');
      }
    },
  });
}

// ── Auto-fill types ───────────────────────────────────────────────────────────

export interface AutoFillGeometry {
  volume: number;
  surfaceArea: number;
  boundingBox: { length: number; width: number; height: number };
  holeCount: number;
  pocketCount: number;
  thinWallCount: number;
  weight: number;
  bendCount: number;
  cutLengthMm: number;
  sheetThicknessMm: number;
  pierceCount: number;
  flatPatternAreaMm2: number;
  holeDiameters: number[];
  bendRadii: number[];
}

export interface AutoFillSuggestions {
  name: string;
  partNumber: string;
  materialCategory: string;
  materialGrade: string;
  materialId: string | null;
  density: number | null;
  processType: string;
  familyClassification: string | null;
  familyConfidence: number | null;
  makeBuy: 'make' | 'buy';
  itemType: 'assembly' | 'sub_assembly' | 'child_part';
}

export interface AutoFillCosts {
  materialCostPerKg: number | null;
  mhrRate: number | null;
  lhrRate: number | null;
  estimatedCycleTimeMin: number;
  calculatorId: string | null;
  estimatedUnitCost: number | null;
}

export interface AutoFillResponse {
  fileName: string;
  geometry: AutoFillGeometry;
  suggestions: AutoFillSuggestions;
  costs: AutoFillCosts;
  confidence: { overall: number; geometry: number; material: number; process: number; cost: number };
  cadEngineAvailable: boolean;
  featureGraph?: FeatureGraph;
}

// ── Auto-fill standalone function ─────────────────────────────────────────────

export async function analyzeForAutoFill(file: File): Promise<AutoFillResponse> {
  const form = new FormData();
  form.append('file', file);
  const data = await apiClient.uploadFiles<AutoFillResponse>('/bom-items/analyze-for-autofill', form);
  if (!data) throw new Error('No response from auto-fill analysis');
  return data;
}

export function useAnalyzeForAutoFill() {
  return useMutation({
    mutationFn: (file: File) => analyzeForAutoFill(file),
  });
}

export function useAnalysisVersion() {
  return useQuery({
    queryKey: bomItemKeys.analysisVersion(),
    queryFn: async () => {
      const data = await apiClient.get<{ version: number; cad_engine_version: string }>('/bom-items/analysis-version');
      return data ?? { version: 4, cad_engine_version: 'unknown' };
    },
    staleTime: 5 * 60 * 1000, // version rarely changes; cache for 5 min
  });
}

export function useDFMScores(bomItemId?: string) {
  return useQuery({
    queryKey: ['bom-items', bomItemId, 'dfm-scores'],
    queryFn: async () => apiClient.get<DFMScoresResponse>(`/bom-items/${bomItemId}/dfm-scores`),
    enabled: useAuthEnabledWith(!!bomItemId),
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
}

// ── Cost Summary ──────────────────────────────────────────────────────────────

// ── Machine selection (physics-based capability engine) ──────────────────────

export type CapabilitySource = 'imported' | 'seed' | 'default_class';
export type AvailabilityStatus = 'available' | 'maintenance' | 'down' | 'retired' | 'commissioning';
export type SelectionProfile = 'balanced' | 'cheapest' | 'fastest';

export interface MachineCapability {
  maxXMm: number | null;
  maxYMm: number | null;
  maxZMm: number | null;
  maxDiameterMm: number | null;
  maxLengthMm: number | null;
  maxTonnage: number | null;
  maxThicknessMm: number | null;
  maxWorkpieceWeightKg: number | null;
  powerKw: number | null;
  maxThicknessMsMm: number | null;
  maxThicknessSsMm: number | null;
  maxThicknessAlMm: number | null;
  maxThicknessCuMm: number | null;
  cuttableMaterials: string[] | null;
}

export interface MachineCandidate {
  machineId: string | null;
  machineName: string | null;
  commodityCode: string | null;
  machineClass: string;
  hourlyRate: number;
  utilizationPct: number;
  scheduledLoadPct: number | null;
  availabilityStatus: AvailabilityStatus;
  nextAvailableAt: string | null;
  maintenanceWindowStart: string | null;
  maintenanceWindowEnd: string | null;
  capability: MachineCapability;
  capabilitySource: CapabilitySource;
  capabilityVersion: number | null;
}

export interface MachineRecommendation {
  candidate: MachineCandidate;
  score: number;
  reasons: string[];
}

export interface MachineSelectionResult {
  balanced: MachineRecommendation;
  cheapest: MachineRecommendation;
  fastest: MachineRecommendation;
  alternatives: MachineCandidate[];
  confidence: number;
  requirement: { kind: string } & Record<string, unknown>;
  allowOverride: true;
  overridden: boolean;
  availabilityWarning?: string;
}

export interface ProcessLineCost {
  process: string;
  setupCost: number;
  runCost: number;
  totalCost: number;
  cycleTimeMin: number;
  hourlyRate: number;
  rateSource: 'mhr_database' | 'default_rate' | 'tier_synthetic';
  machineClass: string;
  machineName: string | null;
  commodityCode: string | null;
  machineSelection?: MachineSelectionResult;
}

export interface ProcessCO2 {
  process: string;
  machineClass: string;
  energyKwh: number;
  co2Kg: number;
}

export interface CO2Contributor {
  label: string;
  co2Kg: number;
  pct: number;
}

export interface ScoreBreakdown {
  materialEfficiency: number;
  carbonIntensity: number;
  recyclability: number;
  processEnergy: number;
}

export interface SustainabilitySummaryDto {
  netWeightKg: number;
  scrapKg: number;
  wasteCostInr: number;
  materialUtilizationPct: number;
  materialCo2Kg: number;
  materialCo2PerKg: number;
  materialCo2Source: 'lookup' | 'default';
  processCo2Breakdown: ProcessCO2[];
  totalProcessEnergyKwh: number;
  totalProcessCo2Kg: number;
  totalCo2Kg: number;
  co2PerKgPart: number;
  co2Contributors: CO2Contributor[];
  recyclabilityPct: number;
  sustainabilityScore: number;
  scoreBreakdown: ScoreBreakdown;
  opportunities: string[];
  factorsSource: string;
}

export interface RouteResultSustainability {
  totalCo2Kg: number;
  totalProcessEnergyKwh: number;
  wasteCostInr: number;
  sustainabilityScore: number;
}

export interface CostSummaryDto {
  materialCost: number;
  materialGrade: string;
  grossWeightKg: number;
  materialCostPerKg: number;
  materialSource: 'db' | 'default';
  processLines: ProcessLineCost[];
  totalProcessCost: number;
  totalCost: number;
  cycleTimes: {
    laserMin: number;
    pressBrakeMin: number;
    tappingMin: number;
    deburrMin: number;
    totalMin: number;
  };
  batchSize: number;
  family: string;
  setupCount?: number;
  materialRemoval?: {
    billetWeightKg: number;
    finishedWeightKg: number;
    utilizationPct: number;
    chipScrapPct: number;
  };
  warnings: string[];
  ratesSource: string;
  currency?: string;
  currencySymbol?: string;
  toUsdRate?: number;
  // Persistent aPriori-style manual overrides already applied to the figures
  // above ('mat_rate' | '<process>::rate' | '<process>::cycleMin') — read-only
  // hint for the "overridden" badge + reset control, not something to re-apply.
  costOverrides?: Record<string, number>;
  sustainability?: SustainabilitySummaryDto;
}

export function useCostSummary(itemId: string | undefined, batchSize: number = 1, location = 'USA') {
  return useQuery({
    queryKey: ['bom-items', itemId, 'cost-summary', batchSize, location],
    queryFn: () =>
      apiClient.get<CostSummaryDto>(
        `/bom-items/${itemId}/cost-summary?batchSize=${batchSize}&location=${encodeURIComponent(location)}`,
      ),
    enabled: useAuthEnabledWith(!!itemId),
    staleTime: 1000 * 60 * 5,
  });
}

export type RouteId =
  | "sm-laser" | "sm-turret" | "sm-waterjet"
  | "cnc-3ax" | "cnc-4ax" | "cnc-5ax"
  | "cnc-lathe" | "cnc-lathe-lt" | "cnc-mill-turn"
  | "injection-molding"
  | "im-small-50t" | "im-standard-200t" | "im-large-500t";

export type CapabilityReasonCode =
  | "DIMENSIONS_UNAVAILABLE"
  | "NO_MACHINE_SELECTED"
  | "SPEC_NOT_ON_FILE"
  | "CLASS_THICKNESS_LIMIT"
  | "THICKNESS_EXCEEDED"
  | "BED_LENGTH_EXCEEDED"
  | "BED_WIDTH_EXCEEDED";

export interface RouteCapability {
  cuttingCapable: boolean;
  pressBrakeCapable: boolean;
  overallCapable: boolean;
  confidence: "high" | "medium" | "low";
  estimatedTonnage: number | null;
  reasonCodes: CapabilityReasonCode[];
  warnings: string[];
}

export interface RouteResultDto {
  routeId: RouteId;
  routeLabel: string;
  processLines: ProcessLineCost[];
  materialCost: number;
  abrasiveCost: number;
  totalProcessCost: number;
  totalCost: number;
  cycleTimes: {
    cuttingMin: number;
    pressBrakeMin: number;
    tappingMin: number;
    deburrMin: number;
    totalMin: number;
  };
  badges: { lowestCost: boolean; fastest: boolean; bestQuality: boolean };
  capability: RouteCapability;
  warnings: string[];
  ratesSource: string;
  sustainability?: RouteResultSustainability;
  setupCount?: number;
  machineCapabilityWarnings?: string[];
  routeComplexityScore?: number;
}

export interface RouteComparisonDto {
  bomItemId: string;
  batchSize: number;
  materialCost: number;
  materialGrade: string;
  grossWeightKg: number;
  materialCostPerKg: number;
  materialSource: "db" | "default";
  routes: RouteResultDto[];
  comparisonWarnings: string[];
  currency: string;
  currencySymbol: string;
}

export function useRouteComparison(itemId: string | undefined, batchSize: number = 1, location = 'USA') {
  return useQuery({
    queryKey: ["bom-items", itemId, "route-comparison", batchSize, location],
    queryFn: () =>
      apiClient.get<RouteComparisonDto>(
        `/bom-items/${itemId}/route-comparison?batchSize=${batchSize}&location=${encodeURIComponent(location)}`,
      ),
    enabled: useAuthEnabledWith(!!itemId),
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: false,
  });
}

// ── Machine override ──────────────────────────────────────────────────────────
// Force a specific machine for one process line; null mhrRecordId reverts to
// auto-selection. Overrides are scoped to the Digital Factory location — an
// India machine pick must not follow the item into a USA costing (the backend
// rejects cross-location machines). Invalidates cost summary + route comparison
// so costs recompute.

export function useMachineOverride(itemId: string | undefined, location: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ processKey, mhrRecordId }: { processKey: string; mhrRecordId: string | null }) =>
      apiClient.post<{ processKey: string; mhrRecordId: string | null; location: string }>(
        `/bom-items/${itemId}/machine-override`,
        { processKey, mhrRecordId, location },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bom-items', itemId, 'cost-summary'] });
      queryClient.invalidateQueries({ queryKey: ['bom-items', itemId, 'route-comparison'] });
    },
  });
}

// aPriori-style persistent cost-field override — replaces the click-to-edit
// material-rate / process-rate / cycle-time cells' local-only state with a
// saved value that survives a refresh and is visible to anyone else opening
// this BOM item. Scoped by Digital Factory location, same reason as machine
// overrides: an India rate override must not leak into a USA costing.
export function useCostOverride(itemId: string | undefined, location: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ fieldKey, value }: { fieldKey: string; value: number | null }) =>
      apiClient.post<{ fieldKey: string; value: number | null; location: string }>(
        `/bom-items/${itemId}/cost-override`,
        { fieldKey, value, location },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bom-items', itemId, 'cost-summary'] });
      queryClient.invalidateQueries({ queryKey: ['bom-items', itemId, 'route-comparison'] });
    },
  });
}

export type GdtSeverity = "low" | "medium" | "high";
export type InspectionMethod = "visual" | "caliper" | "height_gauge" | "cmm";

export interface GdtFeatureDto {
  type: string;
  toleranceMm: number;
  datum: string;
  confidence: number | null;
  severity: GdtSeverity;
  inspectionMethod: InspectionMethod;
  inspectionTimeMin: number;
  costImpactPercent: number;
  costImpactRange: string;
  reasonCodes: string[];
  manufacturingActions: string[];
}

export interface GdtAnalysisDto {
  bomItemId: string;
  source: "drawing_intelligence" | "no_data";
  features: GdtFeatureDto[];
  overallSeverity: GdtSeverity | null;
  maxCostImpactPercent: number;
  maxCostImpactRange: string;
  inspectionMethods: InspectionMethod[];
  recommendedInspectionMethod: InspectionMethod | null;
  totalInspectionTimeMin: number;
  analysisConfidence: number;
  generalTolerance: string | null;
}

export function useGdtAnalysis(itemId: string | undefined) {
  return useQuery({
    queryKey: ["bom-items", itemId, "gdt-analysis"],
    queryFn: () =>
      apiClient.get<GdtAnalysisDto>(`/bom-items/${itemId}/gdt-analysis`),
    enabled: useAuthEnabledWith(!!itemId),
    staleTime: 1000 * 60 * 10,
    refetchOnWindowFocus: false,
  });
}

// Standalone functions for non-hook usage
export async function createBOMItem(dto: CreateBOMItemDto): Promise<BOMItem> {
  const data = await apiClient.post<BOMItem>('/bom-items', dto);
  if (!data) throw new Error('Failed to create BOM item');
  return data;
}

export async function updateBOMItem(id: string, dto: UpdateBOMItemDto): Promise<BOMItem> {
  const data = await apiClient.put<BOMItem>(`/bom-items/${id}`, dto);
  if (!data) throw new Error('Failed to update BOM item');
  return data;
}

export async function deleteBOMItem(id: string): Promise<void> {
  await apiClient.delete(`/bom-items/${id}`);
}

export async function updateBOMItemsSortOrder(items: Array<{ id: string; sortOrder: number }>): Promise<void> {
  await apiClient.patch('/bom-items/reorder', { items });
}
