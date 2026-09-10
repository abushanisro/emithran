import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
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
  /** Parts per year, or `null` when genuinely not on file (see migration 705). */
  annualVolume: number | null;
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
  // Generic Cost Guide manual-override bag, keyed by scenario input name
  // (e.g. "sheetThicknessMm") — see backend's costing/scenario-overrides.ts.
  // A present key wins over the CAD-extracted value for that input in every
  // costing calculation; absent/cleared falls through to the real CAD value.
  scenarioOverrides?: Record<string, unknown>;
  /**
   * The costing inputs this item resolves to from its own persisted scenario,
   * echoed on the (fast) item fetch so the scenario panel does not have to wait
   * on the slow cost-summary call to know its own effective Batch Size and
   * Production Life.
   */
  resolvedCostingInputs?: ResolvedCostingInputs;
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

export interface MaterialDensityResult {
  density_g_cm3: number | null;
  material_name: string | null;
  material_grade: string | null;
}

// Real material_density_lookup / raw_materials density, keyed by the part's
// own material grade (or material name as a fallback) — same endpoint
// BOMItemDialog.tsx already calls ad-hoc (apiClient.get, no shared hook) to
// auto-fill weight from volume. Extracted as a reusable hook so read-only
// consumers (e.g. manufacturing-intelligence's mass estimate) get the same
// real, sourced density instead of a hardcoded material-agnostic default.
export function useMaterialDensity(grade: string | null | undefined) {
  return useQuery({
    queryKey: ['material-density', grade ?? null],
    queryFn: () => apiClient.get<MaterialDensityResult>(`/bom-items/material-density?grade=${encodeURIComponent(grade as string)}`),
    enabled: useAuthEnabledWith(!!grade?.trim()),
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });
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
  /** Optional: omit when nobody has stated the volume. Never send a stand-in. */
  annualVolume?: number | undefined;
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
// P0.5: DFM scores are material/thickness-bracketed (UNDERSIZED_HOLE, CRACK_RISK
// checks in dfm-scoring.service.ts), but a material-grade edit only ever
// invalidated cost-summary/route-comparison — dfm-scores has staleTime: 0 with
// no auto-refetch, so it silently kept showing the OLD material's DFM verdict
// after a successful grade change, in the same session, until remount.
// Extracted (not inlined) so the invalidation set — the entire behavior this
// bug is about — is directly testable without rendering the hook.
export function invalidateBOMItemUpdateQueries(queryClient: QueryClient, data: BOMItem): void {
  // Seed the detail cache from the response BEFORE invalidating, so anything
  // reading the item re-renders on the new values immediately instead of after
  // a refetch round trip. The PUT already returns the complete, freshly
  // resolved item -- including resolvedCostingInputs -- so this is the same
  // data the refetch would fetch, not an optimistic guess that could be wrong.
  //
  // Why it matters: the Cost Guide derives Batch Size from annual volume
  // server-side, so an Annual Volume edit could not visibly move Batch Size
  // until the item came back. The invalidate below still runs, so a stale or
  // partial payload self-corrects on the refetch.
  queryClient.setQueryData(bomItemKeys.detail(data.id), data);
  queryClient.invalidateQueries({ queryKey: bomItemKeys.list(data.bomId) });
  queryClient.invalidateQueries({ queryKey: bomItemKeys.detail(data.id) });
  queryClient.invalidateQueries({ queryKey: ['bom-items', data.id, 'cost-summary'] });
  queryClient.invalidateQueries({ queryKey: ['bom-items', data.id, 'route-comparison'] });
  queryClient.invalidateQueries({ queryKey: ['bom-items', data.id, 'dfm-scores'] });
}

export function useUpdateBOMItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateBOMItemDto }) => {
      return apiClient.put<BOMItem>(`/bom-items/${id}`, data);
    },
    onSuccess: async (data) => {
      if (data) invalidateBOMItemUpdateQueries(queryClient, data);
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
 * Merges a partial patch into a BOM item's Cost Guide manual-override bag
 * (bom_items.scenario_overrides). Pass `null` for a key to clear that
 * override and revert to the real CAD-extracted/auto-detected value.
 */
export function usePatchScenarioOverrides() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Record<string, unknown> }) => {
      return apiClient.patch<BOMItem>(`/bom-items/${id}/scenario-overrides`, patch);
    },
    onSuccess: (data) => {
      if (data) {
        queryClient.invalidateQueries({ queryKey: bomItemKeys.detail(data.id) });
        queryClient.invalidateQueries({ queryKey: ['bom-items', data.id, 'cost-summary'] });
        queryClient.invalidateQueries({ queryKey: ['bom-items', data.id, 'route-comparison'] });
      }
    },
    onError: () => {
      toast.error('Failed to save override. Please try again.');
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
  cadEngineError?: string;
  featureGraph?: FeatureGraph;
}

// ── Auto-fill standalone function ─────────────────────────────────────────────

// In-flight deduplication: same filename+size reuses the pending promise
const _analyzeInFlight = new Map<string, Promise<AutoFillResponse>>();

const ANALYZE_POLL_INTERVAL_MS = 3000;
const ANALYZE_MAX_WAIT_MS = 10 * 60 * 1000; // 10 min — matches the CAD engine's own timeout budget

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Starts a background analysis job and polls until it's ready. Large/complex
// STEP files can take minutes in the CAD engine — this avoids holding one long
// HTTP request open (fragile across proxies/timeouts) by returning the same
// Promise<AutoFillResponse> shape callers already expect, with polling hidden
// inside.
export async function analyzeForAutoFill(file: File): Promise<AutoFillResponse> {
  const key = `${file.name}:${file.size}`;
  const existing = _analyzeInFlight.get(key);
  if (existing) return existing;

  const form = new FormData();
  form.append('file', file);
  const promise = (async () => {
    const { jobId } = await apiClient.uploadFiles<{ jobId: string }>('/bom-items/analyze-for-autofill/start', form);
    if (!jobId) throw new Error('No job started for auto-fill analysis');

    const deadline = Date.now() + ANALYZE_MAX_WAIT_MS;
    while (Date.now() < deadline) {
      const status = await apiClient.get<{ status: 'processing' | 'ready' | 'error'; result?: AutoFillResponse; error?: string }>(
        `/bom-items/analyze-for-autofill/${jobId}`,
      );
      if (!status) throw new Error('No response from auto-fill analysis');
      if (status.status === 'ready') {
        if (!status.result) throw new Error('No response from auto-fill analysis');
        return status.result;
      }
      if (status.status === 'error') {
        throw new Error(status.error ?? 'Analysis failed');
      }
      await sleep(ANALYZE_POLL_INTERVAL_MS);
    }
    throw new Error('Analysis timed out');
  })().finally(() => _analyzeInFlight.delete(key));

  _analyzeInFlight.set(key, promise);
  return promise;
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

export interface CapabilityCheck {
  parameter: string;
  materialGrade: string | null;
  value: number;
  limit: number | null;
  unit: string;
  supported: boolean;
}

export interface MachineRecommendation {
  candidate: MachineCandidate;
  score: number;
  reasons: string[];
  capabilityCheck?: CapabilityCheck | null;
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

export interface FeatureOp {
  name: string;        // e.g. "Spot Drill ×8", "Pocket Mill ×2", "Cut path 0.85m"
  timeSec: number;
  featureType: string; // 'spot_drill' | 'drill' | 'pocket_mill' | 'tapping' | 'laser_cut' | 'pierce' | 'bend'
  count: number;
}

export interface CalculationTraceStep {
  fieldName: string;
  displayLabel: string;
  kind: 'input' | 'calculated';
  value: number | string | null;
  unit?: string | null;
  source?: string;
  formula?: string;
  /** 'lookup' when this step's value came from a real sm_lookup_* DB row;
   *  'physics' when it's a deterministic formula over already-known values. */
  stepType?: 'physics' | 'lookup';
}

export type LookupPolicyType = 'EXACT_MATCH' | 'INTERPOLATE' | 'RANGE' | 'FORMULA';

export interface LookupQueryParam {
  column: string;
  value: string | number;
  unit?: string;
}

export interface LookupTableRow {
  columns: Record<string, string | number>;
  matchedDimensions?: number;
  totalDimensions?: number;
}

export interface LookupResolution {
  table: string;
  policy: LookupPolicyType;
  queryParams: LookupQueryParam[];
  matchedRow: LookupTableRow | null;
  nearestRows: LookupTableRow[];
}

export interface ValidatedInput {
  fieldName: string;
  value: string | number;
  source: string;
}

/** Two distinct gap types, with different owners/triage. */
export interface LookupGap {
  gapType: 'missing_lookup';
  process: string;
  machineClass: string;
  inputValidation: ValidatedInput[];
  lookupResolution: LookupResolution;
  requiredAction: string;
  suggestedSources?: string[];
  priority: 'low' | 'medium' | 'high';
}
export interface UnsupportedOperationGap {
  gapType: 'unsupported_operation';
  process: string;
  machineClass: string;
  reason: string;
  requiredCapability?: string;
}
export type PhysicsGap = LookupGap | UnsupportedOperationGap;

/** How much a calculator-resolved result should be trusted — see backend
 *  ConfidenceLevel's own doc comment (cost-breakdown.dto.ts) for the full
 *  definition of each tier. */
export type ConfidenceLevel = 'verified' | 'derived' | 'unsupported';

export interface ProcessLineCost {
  process: string;
  /** Real process_calculator_mappings identity for this line, resolved server-side
   *  from the DB (never hardcoded) — absent on paths not yet wired to resolve it,
   *  in which case callers must derive a process group from machineClass rather
   *  than reusing `process` as both processRoute and operation. */
  processGroup?: string;
  processRoute?: string;
  operation?: string;
  setupCost: number;
  runCost: number;
  totalCost: number;
  cycleTimeMin: number;
  /** Real un-amortised setup minutes for one batch (backend resolveSetupMinutes). */
  setupTimeMin?: number;
  /**
   * Which real source that setup time came from — 'machine' is the selected
   * machine's own mhr_records.setup_time_hr, 'operation_lookup' a real
   * sm_lookup_op_setup_time row, 'class_default' the cited per-class constant.
   * Disclosed so the UI never shows a class default as a measured machine spec.
   */
  setupTimeSource?: 'machine' | 'operation_lookup' | 'class_default';
  /** Real per-machine operator headcount this line was costed with. */
  operators?: number | null;
  hourlyRate: number;
  rateSource: 'mhr_database' | 'default_rate' | 'no_db_rate' | 'tier_synthetic' | 'benchmark_override';
  machineClass: string;
  machineName: string | null;
  commodityCode: string | null;
  /** Labour hour rate from lhr_benchmark_rates (local currency/hr). Already baked into hourlyRate. */
  labourRate?: number | null;
  /** Which of resolveLHRRates' 4 passes resolved labourRate above — mirrors rateSource's provenance visibility, for the labor side. */
  labourRateSource?: 'lhr_database' | 'lhr_benchmark' | 'lhr_cross_location' | 'no_lhr_rate' | null;
  machineSelection?: MachineSelectionResult;
  /** Real mhr_records id / 'bm-mhr-<id>' benchmark id for this line's resolved
   *  resource, set directly on classes (currently just Inspection) priced via
   *  a flat single-resource resolver instead of machineSelection's candidate
   *  list — see backend resolveCmmSpecificRate/resolveGenericInspectionRate. */
  mhrId?: string | null;
  benchmarkMhrId?: string | null;
  featureBreakdown?: FeatureOp[];
  /** Full end-to-end audit trail (real inputs + provenance, then calculated
   *  fields + real DB formula string, in evaluation order) — present only for
   *  processes wired to a real DB calculator (Laser Cutting, Press Brake).
   *  Powers the "Download calculation" export. */
  calculationTrace?: CalculationTraceStep[];
  /** Which real, registry-resolved calculator (and version) computed this
   *  line's cycle time, when resolved via the Manufacturing Physics
   *  Calculator pipeline. Absent for processes not yet migrated onto it. */
  calculatorId?: string;
  calculatorVersion?: number;
  /** Present instead of a fabricated fallback number when the calculator
   *  couldn't resolve this line's cycle time — the line still appears (never
   *  silently omitted), but cycleTimeMin/totalCost reflect the gap (0/null). */
  physicsGap?: PhysicsGap;
  /** See ConfidenceLevel's own doc comment. Absent for processes not yet
   *  migrated onto the calculator pipeline. */
  confidence?: ConfidenceLevel;
  /** Separate axis from `confidence` — grades the SELECTED MACHINE's own
   *  capability data (real import vs seed/benchmark pattern-match vs generic
   *  MACHINE_CLASS_DEFAULTS floor), not the process parameters. A line can
   *  be `confidence: 'verified'` (real lookup row) while
   *  `capabilityConfidence: 'unsupported'` (the machine's own tonnage/power
   *  is a generic class default, not this machine's real rating). */
  capabilityConfidence?: ConfidenceLevel;
  /** Explanation for a saved process row's own machine, keyed by mhrId, for
   *  when that machine differs from the live balanced/cheapest/fastest picks
   *  in machineSelection above. */
  savedMachineExplanations?: Record<string, { reasons: string[]; capabilityCheck: CapabilityCheck | null }>;
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

/** 'incomplete' whenever any processLines entry carries a physicsGap — see
 *  backend CostStatus's own doc comment (cost-breakdown.dto.ts). totalCost
 *  still sums whatever resolved, for engineering inspection, but is a
 *  partial figure, not a real quote, when this is 'incomplete'. */
export type CostStatus = 'complete' | 'incomplete';

export interface CostSummaryDto {
  // Scenario readiness — false when no material is applied; frontend blocks cost display
  scenarioReady?: boolean;
  missingInputs?: string[];
  /** See CostStatus's own doc comment. Always present once scenarioReady. */
  costStatus?: CostStatus;
  /** Process names with an unresolved physicsGap, when costStatus is 'incomplete'. */
  incompleteProcesses?: string[];
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
  /** Every costing input this result was computed at, with provenance. */
  resolvedInputs: ResolvedCostingInputs;
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
  // amount_usd × usdToDisplayRate = amount in `currency` — for converting
  // fields read from OTHER, always-USD tables (raw material/packaging/
  // procured/tooling/process-cost records). NOT the same as toUsdRate above
  // (which already applies to this DTO's own embedded figures) — see the
  // backend cost-breakdown.dto.ts's doc comment for why the two differ.
  usdToDisplayRate?: number;
  // amount_inr × inrToDisplayRate = amount in `currency` — for converting
  // frontend constants/estimates denominated in INR regardless of factory
  // location (e.g. the Investment/NRE tab's fixture/programming/tooling/
  // inspection tables). Always derived from the live exchange_rates table
  // server-side — never a hardcoded per-country FX table on the frontend.
  inrToDisplayRate?: number;
  // Persistent eMithran-style manual overrides already applied to the figures
  // above ('mat_rate' | '<process>::rate' | '<process>::cycleMin') — read-only
  // hint for the "overridden" badge + reset control, not something to re-apply.
  costOverrides?: Record<string, number>;
  sustainability?: SustainabilitySummaryDto;
  blankSpec?: BlankSpecDto;
  /** Present only when family === 'plastic_molded' — see InjectionMoldingBreakdown. */
  injectionMolding?: InjectionMoldingBreakdown;
}

/**
 * Mirrors the backend's InjectionMoldingBreakdown (cost-breakdown.dto.ts).
 * The clamp/shot fields are the same real per-polymer-family formula
 * (resolveMaterialClampFactor, machine-selector-im.ts) evaluateIMCandidate
 * uses to score/accept machines during route comparison, now also computed
 * for this single active/applied quote's selected machine.
 */
export interface InjectionMoldingBreakdown {
  moldingSubtype: 'standard' | 'lsr' | 'insert' | 'overmold' | 'gas_assisted' | 'two_shot' | 'unscrewing';
  cavityCount: number;
  cavityConstrainedBy: 'clamp' | 'shot_capacity' | 'economic' | 'default';
  runnerSystemType: 'hot' | 'cold';
  runnerScrapKg: number;
  gateType: string;
  undercutCount: number | null;
  partingComplexity: number | null;
  cycleTimeSec: number;
  cavityCycleTimeSec: number;
  costConfidence: number;
  projectedAreaCm2?: number | null;
  materialClampFactor?: number | null;
  clampRequiredT?: number | null;
  clampMachineT?: number | null;
  clampUtilPct?: number | null;
  shotRequiredG?: number | null;
  shotMachineG?: number | null;
  shotUtilPct?: number | null;
}

export interface BlankSpecDto {
  form: 'sheet' | 'round_bar' | 'hex_bar' | 'rectangular_bar' | 'billet' | 'extrusion' | 'casting' | 'granules';
  sizeLabel: string;
  grossWeightKg: number;
  netWeightKg: number;
  utilizationPct: number;
  wasteKg: number;
  wasteCost: number;
  nestingDimensionSource?: 'cad_flat_pattern_bounding_rect' | 'folded_3d_bounding_box';
  nestingDimensionConfidence?: 'verified' | 'fallback';
  // Theoretical per-position nesting basis for grossWeightKg (the per-part
  // yield the costing engine actually prices material on).
  sheetWidthMm?: number;
  sheetLengthMm?: number;
  partsPerSheet?: number;
  // The FULL physical stock-sheet weight -- NOT the same as grossWeightKg
  // above (already per-part). See backend blank-spec.dto.ts's own doc
  // comment for why this is exposed separately (a UI showing grossWeightKg
  // under a "Sheet" label with no full-sheet figure to contrast it against
  // reads as a physically-impossible sheet weight).
  sheetWeightKg?: number;
  // Actual batch sheet consumption -- a distinct concept from grossWeightKg,
  // disclosure-only. See backend blank-spec.dto.ts for the full explanation.
  sheetsRequired?: number;
  plannedParts?: number;
  excessPositions?: number;
  actualBatchGrossMaterialKg?: number;
  // Which nesting engine decided sheetWidthMm/sheetLengthMm/partsPerSheet/
  // utilizationPct above -- 'true_shape' (real flat-pattern silhouette nest,
  // compared across every candidate standard sheet) or
  // 'rectangle_grid_fallback' (no real outline yet, or true-shape nesting
  // failed for every candidate -- nestingFallbackReason explains why).
  nestingMethod?: 'true_shape' | 'rectangle_grid_fallback';
  nestingFallbackReason?: string;
  // Present only once the "Sheet Metal - Gross Material Usage (Nesting)"
  // calculator's mapping is resolvable server-side -- absent (never
  // fabricated client-side) until that migration is applied.
  calculatorId?: string;
  calculatorVersion?: number;
  calculationTrace?: CalculationTraceStep[];
  confidence?: ConfidenceLevel;
}


/**
 * Query string for the costing endpoints. `batchSize` is omitted entirely when
 * not stated, so the server resolves it from the persisted scenario rather than
 * receiving a number this layer invented.
 */
function costingQuery(batchSize: number | undefined, location: string): string {
  const params = new URLSearchParams({ location });
  if (batchSize !== undefined) params.set('batchSize', String(batchSize));
  return params.toString();
}

/**
 * The cost-summary cache key and URL, defined once.
 *
 * Callers that reach for `queryClient` directly (prefetching after an Apply,
 * reading the live cache instead of a closure-captured result) previously built
 * both by hand. Four such copies existed; they had to be edited in lockstep with
 * this hook, and a copy that disagreed silently read or wrote a different cache
 * slot than the one the UI renders from.
 */
export function costSummaryQueryKey(
  itemId: string | undefined,
  batchSize: number | undefined,
  location: string,
) {
  return ['bom-items', itemId, 'cost-summary', batchSize, location] as const;
}

export function costSummaryUrl(
  itemId: string,
  batchSize: number | undefined,
  location: string,
): string {
  return `/bom-items/${itemId}/cost-summary?${costingQuery(batchSize, location)}`;
}

/**
 * `batchSize` is the batch to REQUEST, and `undefined` is a real value here: it
 * means "do not state one — price this against the batch size already persisted
 * on the item's scenario". The server then resolves request -> scenario override
 * -> its single canonical default and echoes the answer back in
 * `resolvedInputs`. Passing a number instead is an explicit override for this
 * one call.
 *
 * A default of 1 used to sit on this parameter. It was not reachable in
 * practice (every caller passed something) but it was a second place a costing
 * default lived, and the Cost Guide's own useState(250) was a third. There is
 * now exactly one, on the server.
 */
export function useCostSummary(itemId: string | undefined, batchSize: number | undefined, location = 'USA') {
  return useQuery({
    queryKey: costSummaryQueryKey(itemId, batchSize, location),
    queryFn: () =>
      // On a true-shape-nest cache miss, the backend evaluates EVERY viable
      // standard sheet size (up to 5) via real, synchronous cad-engine
      // calls before responding -- deliberately never returns an interim
      // rectangle-grid answer first (costing must be deterministic, see
      // bom-items.service.ts's resolveTrueShapeNestCosting). Observed
      // 14-40s even for the OLD single-candidate path, so this timeout
      // must cover the cumulative worst case across all candidates, not
      // just one. Once cached, subsequent requests return quickly.
      apiClient.get<CostSummaryDto>(
        costSummaryUrl(itemId ?? '', batchSize, location),
        { timeout: 180000 },
      ),
    enabled: useAuthEnabledWith(!!itemId),
    staleTime: 1000 * 60 * 5,
    // NOT refetchOnMount: 'always'.
    //
    // That was set so a rate edited out-of-band (HR Rates page, Calculators
    // admin, a migration) could not look permanently "still broken" in an
    // already-open tab. The cost it imposed was far larger than the problem it
    // solved: this is a documented 14-40s computation on a true-shape-nest cache
    // miss, and every remount paid it — so switching to the Cost tab, or back to
    // it, re-ran the whole quote and sat on "Calculating cost..." each time.
    //
    // staleTime above already refetches once the data is 5 minutes old, which
    // covers the out-of-band edit case on any normal navigation. For the case it
    // was really aimed at — a tab left open across an edit — the page has an
    // explicit "Recalculate Cost" action, and every mutation that can change
    // this result already invalidates the key by prefix
    // (invalidateBOMItemUpdateQueries). Forcing a full recompute on every mount
    // on top of all three was redundant.
    refetchOnMount: false,
  });
}

// Mirrors backend true-nest.dto.ts. This endpoint itself is still
// visualization-only (the Nest view's on-demand single-sheet placement) --
// but note that material COSTING now separately runs its own true-shape
// nest across every candidate sheet (bom-items.service.ts's
// resolveTrueShapeNestCosting), not the rectangle-grid engine, when a real
// flat-pattern outline exists. sheet-metal-nesting.engine.ts's
// computeNesting() is the disclosed fallback only (see BlankSpecDto's
// nestingMethod/nestingFallbackReason above), not always the cost basis.
export interface NestPlacementDto {
  xMm: number;
  yMm: number;
  rotationDeg: number;
}

export interface TrueNestResultDto {
  outlinePointsMm: number[][];
  holesMm: { cxMm: number; cyMm: number; diameterMm: number }[];
  outlineSource: 'wire_walk' | 'unavailable';
  sheetWidthMm: number;
  sheetLengthMm: number;
  partsPerSheet: number;
  placements: NestPlacementDto[];
  // Geometric nest utilization (true polygon area, not bounding-rect-
  // derived) from THIS heuristic BLF placement only -- not a globally
  // optimal packing, and a different nester could report a different
  // figure for the same part/sheet. Display as "True-shape nest
  // utilization" / "Geometric nest utilization", never "Real utilization".
  utilizationPct: number;
  sheetsRequired: number | null;
  capped: boolean;
}

// On-demand only (enabled defaults to requiring both sheet dims AND the
// caller's own `enabled` flag) -- this must never fire on page load or
// alongside useCostSummary; it's a real synchronous computation with no
// job-queue backing it (parts/sheet counts can run into the thousands for
// a small part on a large sheet, ~10-20s observed), so it's only worth
// calling once the user actually opens a Nest panel.
export function useTrueNest(
  itemId: string | undefined,
  quantity: number,
  sheetWidthMm: number | undefined,
  sheetLengthMm: number | undefined,
  options?: { kerfMm?: number | undefined; edgeMarginMm?: number | undefined; enabled?: boolean | undefined },
) {
  const hasSheet = typeof sheetWidthMm === 'number' && sheetWidthMm > 0 && typeof sheetLengthMm === 'number' && sheetLengthMm > 0;
  return useQuery({
    queryKey: ['bom-items', itemId, 'true-nest', quantity, sheetWidthMm, sheetLengthMm, options?.kerfMm, options?.edgeMarginMm],
    queryFn: () => {
      const params = new URLSearchParams({
        quantity: String(quantity),
        sheetWidthMm: String(sheetWidthMm),
        sheetLengthMm: String(sheetLengthMm),
      });
      if (options?.kerfMm !== undefined) params.set('kerfMm', String(options.kerfMm));
      if (options?.edgeMarginMm !== undefined) params.set('edgeMarginMm', String(options.edgeMarginMm));
      // Kept above cad-analysis.service.ts's own 90s /nest timeout so the
      // backend's specific diagnostic reason surfaces before this generic
      // client-side abort would.
      return apiClient.get<TrueNestResultDto>(`/bom-items/${itemId ?? ''}/true-nest?${params.toString()}`, { timeout: 95000 });
    },
    enabled: useAuthEnabledWith(!!itemId && hasSheet && (options?.enabled ?? true)),
    staleTime: 1000 * 60 * 5,
    retry: false, // a 404 here is a real "no outline available" gap, not a transient failure to retry
  });
}

// Mirrors backend route-comparison.dto.ts's RouteId — widened to `string` for
// the same reason: a newly-registered backend cutting engine's route id is
// valid here with no frontend edit needed. Real validation happens server-side.
export type RouteId = string;

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

export interface RouteDataGap {
  process: string;
  machineClass: string;
  reason: string;
}

/**
 * Real, per-part injection-molding clamp/shot sizing detail behind an IM
 * tonnage-tier route — mirrors backend route-comparison.dto.ts's
 * RouteInjectionMoldingDetail. Set only on the 3 real injection_molding
 * tonnage-tier routes (small/medium/large); Compression/Reaction Injection/
 * Structural Foam Molding routes leave this unset since clamp tonnage
 * doesn't apply to them the same way.
 */
export interface RouteInjectionMoldingDetail {
  clampRequiredT: number | null;
  clampMachineT: number | null;
  clampUtilPct: number | null;
  shotRequiredG: number | null;
  shotMachineG: number | null;
  shotUtilPct: number | null;
  cavityCount: number;
  gateType: string;
  machineDataSource: 'imported' | 'synthetic';
}

export interface RouteResultDto {
  routeId: RouteId;
  routeLabel: string;
  // 'cutting' routes (Laser/Turret/Waterjet/Shear/Plasma/OxyFuel/Router) are
  // mutually-exclusive alternatives for the same cut+bend+deburr+inspect
  // chain; 'forming' routes (Standard/Tandem/Progressive-Die Press, Roll
  // Bending) are complete, structurally different single-process
  // alternatives with no separate Press Brake/Deburr step. A picker that
  // lets the user choose ONE cutting method must filter to 'cutting'.
  processFamily: 'cutting' | 'forming';
  // Real, database-driven tooling-economics note — only set for the 2
  // forming classes with a sourced sm_reference_data annual-volume
  // threshold (progressive_die_press / tandem_press). null for every other
  // route, including when the part's own annual volume isn't set.
  toolingVolumeNote: string | null;
  processLines: ProcessLineCost[];
  materialCost: number;
  abrasiveCost: number;
  totalProcessCost: number;
  totalCost: number;
  isFeasible: boolean;       // false when the machine cannot physically produce this part — mirrors backend route-comparison.dto.ts
  /**
   * False when this route's process has no blank-generation operation in the
   * catalog taxonomy (today only 2/3/4 Roll Bending) — it is priced over a
   * smaller scope of work than the routes beside it, so it is never
   * recommended or badged, but stays visible and manually selectable. Unset on
   * CNC/injection-molding routes, which have no blanking concept: read
   * undefined as "no evidence against this route".
   */
  producesBlank?: boolean;
  /**
   * False when an operation on this route has no real costing data on file, so
   * its price is an artefact of absent data rather than an economic result.
   * Distinct from isFeasible (physical capability). Such a route stays visible
   * with its warnings, but is never badged or auto-selected as the optimum.
   */
  dataComplete: boolean;
  /** The specific missing-data reasons behind dataComplete: false. */
  dataGaps: RouteDataGap[];
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
  /** Real clamp-tonnage/shot-capacity sizing detail — set only on IM tonnage-tier routes. */
  injectionMolding?: RouteInjectionMoldingDetail;
}

/**
 * Where a resolved costing input actually came from. Mirrors the backend's
 * CostingInputSource (costing/shared/physics/costing-inputs.ts) — returned by
 * the API rather than inferred here, so a real persisted figure can be told
 * apart from a fallback without probing for sentinel values.
 */
export type CostingInputSource =
  | 'request'
  | 'scenario_override'
  | 'item_column'
  /** Computed from another real input on this item (batch size from annual volume). */
  | 'derived'
  | 'default'
  | 'absent';

/**
 * The costing inputs a response was actually computed at. This is the seed for
 * the UI's own scenario state: taking these instead of keeping a second copy
 * with its own default is what stops the screen and the engine disagreeing
 * about which batch size a number belongs to.
 */
export interface ResolvedCostingInputs {
  batchSize: number;
  location: string | null;
  /** null when no real annual volume is on file — never a fabricated figure. */
  annualVolume: number | null;
  productionLifeYears: number;
  /**
   * What this item's annual volume implies for batch size, whether or not it
   * won. Disclosure only — read it to explain why `batchSize` differs, never
   * as the value to price against, and never re-derive it here (the
   * batches-per-year policy lives only in the backend resolver).
   */
  derivedBatchSize: number | null;
  provenance: {
    batchSize: CostingInputSource;
    location: CostingInputSource;
    annualVolume: CostingInputSource;
    productionLifeYears: CostingInputSource;
  };
}

export interface RouteComparisonDto {
  bomItemId: string;
  batchSize: number;
  /** Every costing input this comparison was computed at, with provenance. */
  resolvedInputs: ResolvedCostingInputs;
  /**
   * The route the backend recommends: cheapest among candidates that are both
   * physically capable and fully costed. `null` when none qualifies — treat that
   * as "no recommendation", never as a reason to pick something.
   *
   * Automatic routing applies this. Manual routing ignores it.
   */
  recommendedRouteId: string | null;
  materialCost: number;
  materialGrade: string;
  grossWeightKg: number;
  materialCostPerKg: number;
  materialSource: "db" | "default";
  routes: RouteResultDto[];
  comparisonWarnings: string[];
  currency: string;
  currencySymbol: string;
  toUsdRate?: number;
  usdToDisplayRate?: number;
}

/** `batchSize` semantics are identical to useCostSummary above. */
export function useRouteComparison(itemId: string | undefined, batchSize: number | undefined, location = 'USA') {
  return useQuery({
    queryKey: ["bom-items", itemId, "route-comparison", batchSize, location],
    queryFn: () =>
      // Observed taking 8-18s in practice — same timeout fix as useCostSummary above.
      apiClient.get<RouteComparisonDto>(
        `/bom-items/${itemId}/route-comparison?${costingQuery(batchSize, location)}`,
        { timeout: 60000 },
      ),
    enabled: useAuthEnabledWith(!!itemId),
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: false,
    // Same reasoning as useCostSummary above: staleTime, prefix invalidation on
    // every relevant mutation, and the explicit Recalculate action already cover
    // out-of-band edits. This is an 8-18s call; remounting should not re-run it.
    refetchOnMount: false,
  });
}

export interface CandidateRouteDto {
  candidateId: string;
  blankSpec: BlankSpecDto;
  routeLabel: string;
  routeId: string | null;
  processLines: ProcessLineCost[];
  totalCost: number;
  materialCost: number;
  totalProcessCost: number;
  cycleTimes: { totalMin: number };
  isFeasible: boolean;
  feasibilityNotes: string[];
  isPrimary: boolean;
  badges: { lowestCost: boolean; fastest: boolean; lowestWaste: boolean };
}

export interface CandidateRouteComparisonDto {
  bomItemId: string;
  batchSize: number;
  location: string;
  currency?: string;
  currencySymbol?: string;
  candidates: CandidateRouteDto[];
}

/** `batchSize` semantics are identical to useCostSummary above. */
export function useCandidateRoutes(
  itemId: string | undefined,
  batchSize: number | undefined,
  location = 'USA',
) {
  return useQuery({
    queryKey: ['bom-items', itemId, 'candidate-routes', batchSize, location],
    queryFn: () =>
      apiClient.get<CandidateRouteComparisonDto>(
        `/bom-items/${itemId}/candidate-routes?${costingQuery(batchSize, location)}`,
      ),
    enabled: useAuthEnabledWith(!!itemId),
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: false,
  });
}

// ── Apply manufacturing route → create process cost records ──────────────────
// Posts the user-selected routeId to the backend, which re-runs the route
// comparison engine, validates feasibility, then writes process_cost_records.
// On success, invalidates process-costs so ManufacturingProcessSection refreshes.
export function useApplyRoute(bomItemId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { routeId: string; batchSize?: number; location?: string }) =>
      apiClient.post<{ created: number; operations: string[]; routeLabel: string; routeId: string }>(
        `/bom-items/${bomItemId}/apply-route`,
        payload,
        // Re-runs the whole route-comparison engine before writing records —
        // observed taking 12-42s in practice, well past the 15s dev-mode
        // default (lib/config.ts) and this endpoint has no dynamic-ID-safe
        // entry in endpointTimeouts (those are exact-string keys, which can't
        // match a URL containing this item's UUID) — override per-call instead.
        { timeout: 60000 },
      ),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['process-costs'], exact: false });
      // Without these, the Cost tab kept rendering its stale cached
      // cost-summary/route-comparison after a successful apply — the new
      // process_cost_records were real, but nothing told the UI to refetch.
      queryClient.invalidateQueries({ queryKey: ['bom-items', bomItemId, 'cost-summary'] });
      queryClient.invalidateQueries({ queryKey: ['bom-items', bomItemId, 'route-comparison'] });
      toast.success(`${data.created} operations filled from "${data.routeLabel}"`);
    },
    onError: (err: Error) => {
      toast.error(`Route apply failed: ${err.message}`);
    },
  });
}

// Dynamically-assembled Workflow Builder route (add/remove/reorder real,
// already-engine-computed operations, OR a real catalog operation with no
// geometric trigger on this part yet) — see bom-items.controller.ts's
// applyCustomRoute. A step with only `process` set must match a real,
// already-engine-computed line; a step with processGroup/processRoute/
// machineClass also set is validated against process_calculator_mappings and
// gets a real machine rate resolved from scratch, but an honest 0 cycle time
// (never fabricated) — surfaced back via needsManualCycleTime.
export interface ApplyCustomRouteStep {
  process: string;
  processGroup?: string;
  processRoute?: string;
  machineClass?: string;
}
export function useApplyCustomRoute(bomItemId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { baseCuttingRouteId: string; steps: ApplyCustomRouteStep[]; batchSize?: number; location?: string }) =>
      apiClient.post<{ created: number; operations: string[]; routeLabel: string; needsManualCycleTime: string[] }>(
        `/bom-items/${bomItemId}/apply-custom-route`,
        payload,
        { timeout: 60000 }, // same route-comparison re-run cost as apply-route
      ),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['process-costs'], exact: false });
      // Same gap as useApplyRoute above — the Cost tab never refetched after
      // a successful custom-route apply without these.
      queryClient.invalidateQueries({ queryKey: ['bom-items', bomItemId, 'cost-summary'] });
      queryClient.invalidateQueries({ queryKey: ['bom-items', bomItemId, 'route-comparison'] });
      toast.success(`${data.created} operations filled from "${data.routeLabel}"`);
      if (data.needsManualCycleTime.length) {
        toast.warning(`Set cycle time via Edit Process Cost for: ${data.needsManualCycleTime.join(', ')} — no real geometric trigger found, so cost is $0 until then.`);
      }
    },
    onError: (err: Error) => {
      toast.error(`Custom route apply failed: ${err.message}`);
    },
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

// eMithran-style persistent cost-field override — replaces the click-to-edit
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
