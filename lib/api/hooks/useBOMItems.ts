import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { SandGatingLayout } from '@/lib/casting/gating-layout';
import type { CalculatorRun } from '@/lib/costing/sand-calculations';
import { apiClient, ApiError } from '../client';
import { useAuthEnabledWith } from './useAuthEnabled';
import { toast } from 'sonner';
import { runProtectedJob } from '@/lib/auth/session-idle/protected-jobs';
import type { FeatureGraph, DFMScoresResponse, OccurrenceScore } from '@/lib/types/manufacturing';
import type { SourceRef } from '@/lib/calculators/input-source';
import type { MachiningAllowanceSummary } from './useMachiningAllowance';

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

// The backend's global TransformInterceptor rewrites every response key to
// camelCase (and apiClient already unwraps the {success, data, metadata}
// envelope) — this must match the REAL wire shape, never the controller's
// own snake_case return-type annotation, which is pre-transform.
export interface MaterialDensityResult {
  densityGCm3: number | null;
  materialName: string | null;
  materialGrade: string | null;
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
  materialGrade?: string | undefined;
  // Provenance of materialGrade — 'manual' means the engineer explicitly
  // confirmed it via the Material Grade picker (see bom-items.service.ts's
  // grade-precedence comment for why this matters: it's what lets a
  // deliberate selection outrank a generic/unconfirmed drawing extraction).
  // Loosely typed as string (matching the backend DTO, bom-items.dto.ts) —
  // not narrowed to the literal union, since an existing caller
  // (BOMItemDialog.tsx) already forwards a generic string here.
  materialSource?: string | undefined;
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
  queryClient.invalidateQueries({ queryKey: ['bom-items', data.id, 'plastic-dfm'] });
  queryClient.invalidateQueries({ queryKey: ['bom-items', data.id, 'part-summary'] });
}

// A re-analysis replaces the item's geometry (feature graph, flat-pattern outline), so on top of what any item update
// invalidates it refreshes what is computed from the geometry alone: the true nest and the machining need.
export function invalidateBOMItemReanalysisQueries(queryClient: QueryClient, data: BOMItem): void {
  invalidateBOMItemUpdateQueries(queryClient, data);
  queryClient.invalidateQueries({ queryKey: ['bom-items', data.id, 'true-nest'] });
  queryClient.invalidateQueries({ queryKey: ['bom-items', data.id, 'machining-need'] });
}

/** Re-runs the CAD analysis on the item's stored 3D file (POST /bom-items/:id/reanalyze), then refreshes it and its costs. */
export function useReanalyzeBOMItem(itemId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    // The engine can take minutes on a large STEP file; the backend allows the same.
    mutationFn: () => apiClient.post<BOMItem>(`/bom-items/${itemId}/reanalyze`, undefined, { timeout: 180_000 }),
    onSuccess: (data) => {
      invalidateBOMItemReanalysisQueries(queryClient, data);
      toast.success('CAD analysis re-run');
    },
    onError: (error: unknown) => {
      toast.error(error instanceof ApiError ? error.getUserMessage() : 'Could not re-run the CAD analysis');
    },
  });
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
  materialGrade: string;
  materialId: string | null;
  density: number | null;
  /** The CAD family's process_taxonomy group (e.g. "Machining"), or null. */
  processType: string | null;
  /** Real catalog machine for machining parts (e.g. "3 Axis Mill"), else null. */
  suggestedMachine: string | null;
  familyClassification: string | null;
  familyConfidence: number | null;
}

export interface AutoFillResponse {
  fileName: string;
  geometry: AutoFillGeometry;
  suggestions: AutoFillSuggestions;
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
/** What a dropped model gives before its process is known (backend measure-for-autofill). */
export interface MeasureResponse {
  suggestions: { name: string; partNumber: string };
  geometry: { volume: number; surfaceArea: number; boundingBox: { length: number; width: number; height: number } };
}

/** Measure a 3D model (volume, surface area, bounding box) with no process: no classification, no features. */
export async function measureForAutoFill(file: File): Promise<MeasureResponse> {
  const form = new FormData();
  form.append('file', file);
  return apiClient.uploadFiles<MeasureResponse>('/bom-items/measure-for-autofill', form);
}

export async function analyzeForAutoFill(file: File, familyHint?: string): Promise<AutoFillResponse> {
  // familyHint is part of the dedup key: the same file re-analyzed under a
  // different manual process override (Create BOM Item's process dropdown)
  // must not return the stale in-flight/previous promise for the unhinted
  // (or differently-hinted) request.
  const key = `${file.name}:${file.size}:${familyHint ?? ''}`;
  const existing = _analyzeInFlight.get(key);
  if (existing) return existing;

  const form = new FormData();
  form.append('file', file);
  if (familyHint) form.append('familyHint', familyHint);
  // Protected from the inactivity sign-out (up to 15 extra minutes): the
  // result only reaches the form through this polling loop.
  const promise = runProtectedJob('cad-autofill', async () => {
    const { jobId } = await apiClient.uploadFiles<{ jobId: string }>('/bom-items/autofill-analysis-jobs', form);
    if (!jobId) throw new Error('No job started for auto-fill analysis');

    const deadline = Date.now() + ANALYZE_MAX_WAIT_MS;
    while (Date.now() < deadline) {
      const status = await apiClient.get<{ status: 'processing' | 'ready' | 'error'; result?: AutoFillResponse; error?: string }>(
        `/bom-items/autofill-analysis-jobs/${jobId}`,
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
  }).finally(() => _analyzeInFlight.delete(key));

  _analyzeInFlight.set(key, promise);
  return promise;
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

export type PartSummaryCostCategoryKey = 'material' | 'labor' | 'overhead' | 'setup' | 'investment' | 'other';
/** The part's summary (backend costing/shared/part-summary.ts): a projection of the applied cost table. Amounts are USD; a null is a value the model does not hold, with its reason in notModelled. */
export interface PartSummary {
  currency: 'USD';
  basis: 'applied' | 'none';
  component: { roughMassKg: number | null; finishMassKg: number | null; lengthMm: number | null; widthMm: number | null; heightMm: number | null; surfaceAreaMm2: number | null; volumeMm3: number | null };
  production: {
    digitalFactory: { primary: string | null; secondary: string | null; toolshop: string | null };
    annualVolume: number | null; batchSize: number | null; productionLifeYears: number | null; lifetimeVolume: number | null;
  };
  material: { catalog: string | null; name: string | null; stock: string | null; composition: string | null; utilizationPct: number | null; unitCostUsdPerKg: number | null };
  costByCategory: Array<{ key: PartSummaryCostCategoryKey; label: string; usd: number; pct: number | null }>;
  costByProcess: Array<{ process: string; usd: number; pct: number | null }>;
  costs: {
    piecePartCostUsd: number | null; fullyBurdenedCostUsd: number | null; totalCapitalInvestmentsUsd: number | null;
    targetCostUsd: number | null; varianceToTargetCostPct: number | null; targetMassKg: number | null; varianceToTargetMassPct: number | null;
  };
  notModelled: Partial<Record<'secondaryFactory' | 'toolshop' | 'stock' | 'fullyBurdenedCost' | 'targetCost' | 'targetMass', string>>;
  uncosted: string[];
}

/** The Part Summary tab's data. Refetched on each visit (staleTime 0): what Apply wrote is what it shows. */
export function usePartSummary(bomItemId: string | undefined) {
  return useQuery({
    queryKey: ['bom-items', bomItemId, 'part-summary'],
    queryFn: async () => apiClient.get<PartSummary>(`/bom-items/${bomItemId}/part-summary`),
    enabled: useAuthEnabledWith(!!bomItemId),
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
}

export type PlasticDfmSeverity = 'Critical' | 'Major' | 'Minor';
export interface PlasticDfmFinding {
  rule: string;
  title: string;
  severity: PlasticDfmSeverity;
  measured: number;
  threshold: number;
  comparison: '<' | '>';
  unit: string | null;
  note: string | null;
  count: number;
  featureIds: string[];
  faces: number[];
  label: string;
}
export interface PlasticDfmView {
  status: 'ok' | 'no_analysis' | 'unavailable';
  result: {
    rulesetVersion: string;
    process: string;
    materialType: string | null;
    findings: PlasticDfmFinding[];
    passed: string[];
    notEvaluated: Array<{ rule: string; reason: string }>;
    notes: string[];
  } | null;
  reasons: string[];
}

/** The design-for-molding checks of a plastic part against the staged rule data, for its current material (evaluated when asked, so a material change is reflected). */
export function usePlasticDfm(bomItemId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['bom-items', bomItemId, 'plastic-dfm'],
    queryFn: async () => apiClient.get<PlasticDfmView>(`/bom-items/${bomItemId}/plastic-dfm`),
    enabled: useAuthEnabledWith(!!bomItemId && enabled),
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
}

export type MachiningDfmSeverity = 'critical' | 'major' | 'minor';
export interface MachiningDfmFinding {
  rule: string;
  severity: MachiningDfmSeverity;
  label: string;
  limit: string;
  source: string;
  recommendation: string;
  featureIds: string[];
  occurrences: { featureId: string; occurrenceIndex: number }[];
  faces: number[];
}
export interface MachiningDfmCheck {
  rule: string;
  name: string;
  limit: string;
  source: string;
  status: 'passed' | 'failed' | 'not_evaluated';
  detail: string;
}
export interface MachiningDfmView {
  status: 'ok' | 'no_analysis';
  result: { findings: MachiningDfmFinding[]; checks: MachiningDfmCheck[] } | null;
  reasons: string[];
}

/** The design-for-machining checks of a machined part against the machining reference limits (evaluated when asked). */
export function useMachiningDfm(bomItemId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['bom-items', bomItemId, 'machining-dfm'],
    queryFn: async () => apiClient.get<MachiningDfmView>(`/bom-items/${bomItemId ?? ''}/machining-dfm`),
    enabled: useAuthEnabledWith(!!bomItemId && enabled),
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
  /** The machine's HR Rates process group (process_group, else commodity_code). */
  processGroup: string | null;
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
  /** Every capable machine in balanced-profile order, with its 0-1 component scores. */
  ranking?: MachineScoreBreakdown[];
  /** Machines of this class that failed the part's capability check. */
  rejected?: Array<{ machineId: string | null; machineName: string | null; reasons: string[] }>;
  profileWeights?: Record<'balanced' | 'cheapest' | 'fastest', { fit: number; util: number; cost: number; avail: number }>;
  decision?: {
    winnerId: string | null;
    runnerUpId: string | null;
    decidingFactor: 'fit' | 'util' | 'cost' | 'avail' | 'tie_rate' | 'only_capable' | 'override';
  };
}

export interface MachineScoreBreakdown {
  machineId: string | null;
  machineName: string | null;
  hourlyRate: number;
  fit: number;
  util: number;
  cost: number;
  avail: number;
  score: number;
}

/** One real GD&T callout this part carries — backend costing/shared/physics/gdt-callouts.ts. */
export interface GdtCallout {
  type: string;
  toleranceMm: number;
  datum: string;
  confidence: number | null;
  source: 'step_pmi' | 'drawing';
  /** Real, stable face id(s) (step_pmi source only) — empty when no 3D link exists. */
  faceIds: string[];
}

/**
 * Does the part's 2D drawing describe the SAME object as its 3D CAD model?
 * Backend costing/shared/physics/drawing-cad-consistency.ts — a data-integrity
 * check (did the right files get uploaded, did OCR misread a number), never a
 * manufacturing/DFM tolerance check.
 */
export type MismatchStatus = 'match' | 'mismatch' | 'drawing_only' | 'cad_only';
export type MismatchSeverity = 'critical' | 'warning' | 'info';

export interface FactMismatch {
  fact: string;
  label: string;
  drawingValue: string;
  cadValue: string;
  status: MismatchStatus;
  severity: MismatchSeverity;
  message: string;
  /** CAD features to highlight on click — only when the fact has real ones. */
  v2FeatureIds?: string[];
}

/** One CAD feature matched to the catalog operation(s) a process step performs on it. */
export interface CatalogOperation {
  /** One name when resolved; the candidates when undecided; empty when infeasible. */
  operations: string[];
  featureType: string;
  variant: string;
  diameterMm: number | null;
  count: number;
  featureIds: string[];
  status: 'resolved' | 'undecided' | 'infeasible';
  children: { operation: string; featureType: string; featureFaceIds?: number[][] }[];
  reason?: string;
  /**
   * Sand casting with a casting analysis: each feature's faces on the 3D model (face_map face_ids), in featureIds order. Its features are
   * the analysis's own, not feature_graph_v2 entries, so these faces, not featureIds, are what a click highlights.
   */
  featureFaceIds?: number[][];
}

export interface FeatureOp {
  name: string;        // e.g. "Spot Drill ×8", "Pocket Mill ×2", "Cut path 0.85m"
  timeSec: number;
  featureType: string; // 'spot_drill' | 'drill' | 'pocket_mill' | 'tapping' | 'laser_cut' | 'pierce' | 'bend'
  count: number;
  /** feature_graph_v2 ids of the exact features this entry machines (machining). */
  featureIds?: string[];
  /** Exact occurrences this entry machines (feature_graph_v2 entry id + occurrence index). */
  occurrenceRefs?: Array<{ featureId: string; occurrenceIndex: number }>;
  /** CAD faces (face_map ids) the entry acts on when no feature lists them (the faces meeting at the sharp edges deburred). */
  faceIds?: number[];
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
  /** The part's own value replaced this step: what the calculator would have used, and why it was changed. */
  override?: { original: number | null; reason: string };
  /** 'input' steps measured on CAD faces: which measurement (backend cad-evidence.ts). */
  evidence?: string;
  /** 'input' steps: where the value was read, structured (lib/calculators/input-source.ts), for the eye beside the input. */
  ref?: SourceRef;
  /** A line that ran one calculator per group: the group ("M2") and the calculator's own field name (fieldName carries the prefix). */
  group?: string;
  groupField?: string;
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
  requiredAction?: string;
}
export type PhysicsGap = LookupGap | UnsupportedOperationGap;

/** How much a calculator-resolved result should be trusted — see backend
 *  ConfidenceLevel's own doc comment (cost-breakdown.dto.ts) for the full
 *  definition of each tier. */
export type ConfidenceLevel = 'verified' | 'derived' | 'unsupported';

export interface ProcessLineCost {
  process: string;
  /** What the line charges beyond machine and crew time (energy, a consumable), USD per part, in its runCost and totalCost (backend ProcessLineCost). */
  otherCostPerPartUsd?: number;
  /** What otherCostPerPartUsd is, e.g. "energy 0.0029 USD per casting". */
  otherCostDetail?: string;
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
   * Which real source that setup time came from — 'calculator' a DB calculator
   * result for this part, 'machine' the selected machine's own
   * mhr_records.setup_time_hr, 'operation_lookup' a real sm_lookup_op_setup_time
   * row, 'none' no real setup data (setup not costed — never a constant).
   */
  setupTimeSource?: 'calculator' | 'machine' | 'operation_lookup' | 'none';
  /** Real per-machine operator headcount this line was costed with. */
  operators?: number | null;
  hourlyRate: number;
  /** 'mhr_database' = a real HR Rates machine; 'no_db_rate' = no machine (not costed);
   *  'tooling_amortization' / 'consumable_allowance' = real non-machine cost lines. */
  rateSource: 'mhr_database' | 'no_db_rate' | 'tooling_amortization' | 'consumable_allowance';
  machineClass: string;
  machineName: string | null;
  commodityCode: string | null;
  /** The selected machine's own labour hour rate (local currency/hr), charged separately from hourlyRate. */
  labourRate?: number | null;
  /** 'mhr_machine_specific' = that machine's own LHR; 'no_lhr_rate' = none on file. */
  labourRateSource?: 'mhr_machine_specific' | 'no_lhr_rate' | null;
  machineSelection?: MachineSelectionResult;
  /** Why this line runs on its machine (casting route engines): rule, criteria, every machine checked. */
  machineChoice?: MachineChoiceDto;
  /** Real mhr_records id / 'bm-mhr-<id>' benchmark id for this line's resolved
   *  resource, set directly on classes (currently just Inspection) priced via
   *  a flat single-resource resolver instead of machineSelection's candidate
   *  list — see backend resolveCmmSpecificRate/resolveGenericInspectionRate. */
  mhrId?: string | null;
  benchmarkMhrId?: string | null;
  featureBreakdown?: FeatureOp[];
  /** Casting: the catalog operation each feature receives (operation null = undetermined). */
  featureOperations?: Array<{
    operation: string | null;
    featureType: string;
    instances: Array<{ label: string; featureId: string | null; occurrenceIndex: number }>;
    reason: string;
  }>;
  /** Sheet metal: the reference-catalog operations this step performs on the
   *  part's own CAD features (backend catalog-operation-resolver.ts). */
  catalogOperations?: CatalogOperation[];
  /** The step acts on the whole part (a sand casting's melting, pouring, cooling, ...): the process tree highlights all of it. */
  actsOnWholePart?: boolean;
  /** GD&T callouts this line (Inspection) covers — see GdtCallout above. */
  gdtCallouts?: GdtCallout[];
  /** Full end-to-end audit trail (real inputs + provenance, then calculated
   *  fields + real DB formula string, in evaluation order) — present only for
   *  processes wired to a real DB calculator. Shown in the Cost tab's
   *  calculation trace and the calculator dialog. */
  calculationTrace?: CalculationTraceStep[];
  // Machining calculators: per input field, the lookup table + row(s) its value came from.
  lookupMatches?: Record<string, { table: string; row: Record<string, string | number> }>;
  /** Which real, registry-resolved calculator (and version) computed this
   *  line's cycle time, when resolved via the Manufacturing Physics
   *  Calculator pipeline. Absent for processes not yet migrated onto it. */
  calculatorId?: string;
  calculatorVersion?: number;
  /** The stored calculator's name: a part's own field values are set by it (calculator_field_overrides). Present where the engine applies them. */
  calculatorName?: string;
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

export type ValidationState = 'VALIDATED' | 'ASSUMED' | 'UNSUPPORTED';

export interface QuoteValidation {
  /** The weakest state among the formulas the quote used. */
  state: ValidationState;
  /** False when something a real quote needs is not computed (see `unsupported`). */
  complete: boolean;
  formulas: Array<{ id: string; version: number; name: string; state: ValidationState }>;
  assumptions: string[];
  unsupported: Array<{ id: string; name: string; stagedData: string }>;
}

export interface DriverImpact {
  driver: string;
  step: string;
  unit: string;
  baselineValue: number;
  variantValue: number;
  deltaPerPart: number;
  lines: Array<{ line: string; deltaPerPart: number }>;
}

/** An injection mold's tooling, as the tooling calculator costs it. */
export interface InjectionMoldToolingDto {
  moldClass: string;
  moldCostUsd: number;
  moldCostPerPartUsd: number;
  moldsRequired?: number;
  moldToolLifeShots?: number;
  annualVolume?: number;
  productionLifeYears?: number;
  calculationTrace?: CalculationTraceStep[];
  calculatorName?: string;
}

export interface CostSummaryDto {
  /** Molded parts: what each CAD cost driver is worth (the engine run again with only that driver moved one step), per part, in this summary's currency. */
  driverImpacts?: DriverImpact[];
  // Scenario readiness — false when no material is applied; frontend blocks cost display
  scenarioReady?: boolean;
  missingInputs?: string[];
  /** See CostStatus's own doc comment. Always present once scenarioReady. */
  costStatus?: CostStatus;
  /** Process names with an unresolved physicsGap, when costStatus is 'incomplete'. */
  incompleteProcesses?: string[];
  /** Part-level 2D-drawing-vs-3D-CAD fact agreement — see FactMismatch above. */
  drawingCadConsistency?: FactMismatch[];
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
  // Persistent eMithran-style manual overrides already applied to the figures
  // above ('mat_rate' | '<process>::rate' | '<process>::cycleMin') — read-only
  // hint for the "overridden" badge + reset control, not something to re-apply.
  costOverrides?: Record<string, number>;
  sustainability?: SustainabilitySummaryDto;
  blankSpec?: BlankSpecDto;
  /** Present only when family === 'plastic_molded' — see InjectionMoldingBreakdown. */
  injectionMolding?: InjectionMoldingBreakdown;
  /** Plastic molding: how far this quote can be trusted (backend QuoteValidationDto). Absent for other families and for a part that cannot be molded. */
  validation?: QuoteValidation;
  /** Present when a die-cast part reached the HPDC cavity step — see DieCastingBreakdown. */
  dieCasting?: DieCastingBreakdown;
  /** Sand casting: what the route decided (mirrors the backend's SandCastingBreakdown). */
  sandCasting?: { mouldingProcess: string; mouldingMachine: string; cavities: number; coresMade: number; coresLeftSolid: number; complete: boolean; measuredBy: 'casting analysis' | 'cad-engine'; gating: SandGatingLayout; flask: { lengthMm: number; widthMm: number; heightMm: number } };
  /** Sand casting: the machining allowance of each machined feature (display only, never costed). */
  machiningAllowance?: MachiningAllowanceSummary;
  /** The die-casting die amortised over its life (USD, separate from the piece cost). */
  dieTooling?: DieToolingDto;
  /** Injection molding: the mold, by its tooling calculator (backend ToolingCostDto, migration 1012); kept out of the piece cost. USD. */
  tooling?: InjectionMoldToolingDto;
  /** Heat / surface / other secondary operations, shared by every family. See SecondaryOperationsDto. */
  secondaryOperations?: SecondaryOperationsDto;
  /** Coreboxes for gravity die casting sand cores (USD, separate from the piece cost). */
  coreboxTooling?: { boxes: number; costUsd: number; perPartUsd: number | null; detail: string };
  /** Which die-casting process (HPDC / GDC) this summary prices, with the other for comparison. */
  dieCastingProcess?: DieCastingProcessChoiceDto;
  /** Calculators behind values that are not route lines (sand: metal per casting, material cost), keyed by calculator key. */
  calculatorRuns?: Record<string, CalculatorRun>;
}

/** Mirrors the backend's MachineChoiceDto (cost-breakdown.dto.ts). */
export interface MachineChoiceDto {
  rule: string;
  criteria: string[];
  chosen: string | null;
  capableCount: number;
  /** Every machine of the class checked against the criteria. */
  checkedCount: number;
  /** The chosen machine first, then the next cheapest capable ones (at most 3); when none is capable, up to 3 rejected with the criteria they failed. */
  candidates: Array<{ name: string; status: 'chosen' | 'capable' | 'rejected'; perPartCost: number | null; reasons: string[] }>;
}

/** Mirrors the backend's SecondaryOptionDto (cost-breakdown.dto.ts). */
export interface SecondaryOptionDto {
  process: string;
  status: 'costed' | 'not_applicable' | 'gap';
  costPerPart: number | null;
  reason: string;
  fromDrawing: boolean;
  selected: boolean;
  machineName: string | null;
  cycleTimeSec: number | null;
  /** Priced from a published figure or a stated rule, not reference data. */
  provisional?: boolean;
}

/** Mirrors the backend's SecondaryOperationsDto (cost-breakdown.dto.ts). */
export interface SecondaryOperationsDto {
  source: 'scenario' | 'drawing';
  heat: SecondaryOptionDto[];
  surface: SecondaryOptionDto[];
  other: SecondaryOptionDto[];
  dataWarnings: string[];
}

/** Mirrors the backend's DieCastingProcessChoiceDto (cost-breakdown.dto.ts). */
export interface DieCastingProcessChoiceDto {
  chosen: string;
  chosenBy: 'user' | 'auto' | 'none_feasible';
  /** What each option total compares: piece + die per part, or piece cost alone when a die is not amortised. */
  basis: 'piece_and_tooling' | 'piece_only';
  options: Array<{
    process: string;
    feasible: boolean | null;
    detail: string;
    pieceCost: number | null;
    toolingPerPart: number | null;
    total: number | null;
  }>;
}

/** Mirrors the backend's DieToolingDto (cost-breakdown.dto.ts). */
export interface DieToolingDto {
  ok: boolean;
  reason: string | null;
  dieSizeMm: [number, number, number] | null;
  pressForceKn: number | null;
  complexity: 'Simple' | 'Average' | 'Complex';
  featureCount: number;
  steelKg: number | null;
  steelUsd: number | null;
  designHr: number | null;
  machiningHr: number | null;
  assemblyHr: number | null;
  ejectorPins: number | null;
  ejectorPinsUsd: number | null;
  labourUsd: number | null;
  markupPct: number;
  dieCostUsd: number | null;
  shotsPerDie: number | null;
  diesRequired: number | null;
  totalToolingUsd: number | null;
  perPartUsd: number | null;
  trace: Array<{ label: string; value: string }>;
}

/** Mirrors the backend's DieCastingBreakdown (cost-breakdown.dto.ts). */
export interface DieCastingBreakdown {
  cavityCount: number;
  /** 'user': set in the Cost Guide; 'default': defaultNumCavities; 'large_part': one cavity above largePartThreshold; 'unverified': no layout / not checkable. */
  cavityConstrainedBy: 'user' | 'default' | 'large_part' | 'unverified';
  /** layoutNumCav cavity counts. */
  cavityLayouts: number[];
  defaultCavityCount: number;
  requiredClampKn: number | null;
  shotVolumeMm3: number | null;
  /** Metal per part (kg): charged = part x Yield Loss Factor; melted - part returns to the furnace. */
  metal: {
    partKg: number;
    chargedKg: number;
    yieldLossFactor: number | null;
    meltedKg: number | null;
    returnedKg: number | null;
  };
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
  /** 'user': set in the Cost Guide; 'default': reference defaultNumCavities; 'unverified': press / clamp / layout check failed. */
  cavityConstrainedBy: 'clamp' | 'shot_capacity' | 'economic' | 'default' | 'user' | 'unverified';
  /** Reference mold layouts (layoutNumCav) a cavity count may take. */
  cavityLayouts?: number[];
  /** Reference defaultNumCavities. */
  defaultCavityCount?: number | null;
  runnerSystemType: 'hot' | 'cold';
  runnerScrapKg: number;
  gateType: string;
  undercutCount: number | null;
  partingComplexity: number | null;
  cycleTimeSec: number;
  cavityCycleTimeSec: number;
  costConfidence: number;
  projectedAreaCm2?: number | null;
  /** Reference flow class of the material (clamp-force model). */
  flowClass?: 'easy' | 'medium' | 'hard' | null;
  cavityPressureMpa?: number | null;
  /** The clamp calculation written out, or why it could not be made. */
  clampTrace?: string | null;
  clampRequiredT?: number | null;
  clampMachineT?: number | null;
  clampUtilPct?: number | null;
  shotRequiredG?: number | null;
  shotMachineG?: number | null;
  shotUtilPct?: number | null;
}

export interface BlankSpecDto {
  form: 'sheet' | 'round_bar' | 'hex_bar' | 'rectangular_bar' | 'square_bar' | 'plate' | 'round_tube' | 'billet' | 'extrusion' | 'casting' | 'granules';
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
  // Sheet origin + the kerf / edge margin the cost engine nested with.
  sheetSource?: string;
  kerfMm?: number;
  edgeMarginMm?: number;
  // Stock sheets the Nest view ranks and recommends from.
  candidateSheets?: Array<{ widthMm: number; lengthMm: number; source: string }>;
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
  // Machining only -- set when a "Stock Form" override (round/hex/rectangular
  // bar) couldn't be honored with real stock_profiles data, so `form` above
  // fell back to billet instead. See backend blank-spec.dto.ts.
  stockFormOverrideNote?: string;
  // Machining only -- the inputs grossWeightKg was computed from
  // (stockVolumeMm3 / 1e9 x densityKgM3). densityKgM3 is absent when the
  // material grade hasn't resolved to a real density. See backend blank-spec.dto.ts.
  stockVolumeMm3?: number;
  densityKgM3?: number;
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
    // A retry would start a second full server computation behind the first.
    retry: false,
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
  /** Which of the part's blanks this nest is of (0-based) and how many there are: 1 for an ordinary part, one per solid body for a multi-body file. */
  blankIndex: number;
  blankCount: number;
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
  options?: { kerfMm?: number | undefined; edgeMarginMm?: number | undefined; enabled?: boolean | undefined; blank?: number | undefined },
) {
  const hasSheet = typeof sheetWidthMm === 'number' && sheetWidthMm > 0 && typeof sheetLengthMm === 'number' && sheetLengthMm > 0;
  return useQuery({
    queryKey: ['bom-items', itemId, 'true-nest', quantity, sheetWidthMm, sheetLengthMm, options?.kerfMm, options?.edgeMarginMm, options?.blank ?? 0],
    queryFn: () => {
      const params = new URLSearchParams({
        quantity: String(quantity),
        sheetWidthMm: String(sheetWidthMm),
        sheetLengthMm: String(sheetLengthMm),
      });
      if (options?.kerfMm !== undefined) params.set('kerfMm', String(options.kerfMm));
      if (options?.edgeMarginMm !== undefined) params.set('edgeMarginMm', String(options.edgeMarginMm));
      if (options?.blank) params.set('blank', String(options.blank));
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
  /** May Auto routing pick this route (backend isAutoRoutable). */
  autoRoutable?: boolean;
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
  /** Molding routes: what this route's own process can do with the part's recognised features. Informational; changes no cost. */
  featureRecognition?: RouteFeatureRecognition | null;
  /** Molding routes: whether this route's process can make the part. 'incompatible' bars the route from the recommendation and the badges; `warnings` are features not assessed yet (never an exclusion). */
  compatibility?: RouteCompatibility | null;
}

/** Mirrors backend RouteCompatibility (costing/plastic-molding/operation/route-compatibility.ts). */
export interface RouteCompatibility {
  status: 'compatible' | 'incompatible';
  incompatibilities: ProcessIncompatibility[];
  notAssessed: string[];
  warnings: string[];
}

/** A recognised feature the route's process cannot make (mirrors backend ProcessIncompatibility). */
export interface ProcessIncompatibility {
  featureType: string;
  variant: string;
  count: number;
  featureIds: string[];
  kind: 'not_in_process_vocabulary' | 'no_operation_can_make';
  reason: string;
}

/** Mirrors backend RouteFeatureRecognition (costing/plastic-molding/operation/route-feature-recognition.ts). */
export interface RouteFeatureRecognition {
  process: string;
  vocabulary: string[];
  recognised: { featureType: string; count: number }[];
  incompatibilities: ProcessIncompatibility[];
  notAssessed: string[];
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
  /** Set when every route is incompatible (no route is recommended and none is chosen in its place). Show it as is. */
  noCompatibleProcessMessage?: string | null;
  materialCost: number;
  materialGrade: string;
  grossWeightKg: number;
  materialCostPerKg: number;
  materialSource: "db" | "default";
  routes: RouteResultDto[];
  comparisonWarnings: string[];
  /** Molding: why the material itself cannot be molded or lacks reference data; said once for the whole comparison. */
  materialNote?: { kind: 'additive_feedstock' | 'not_molding_feedstock' | 'no_injection_data'; reason: string; missing: string[] } | null;
  /** Part-level 2D-drawing-vs-3D-CAD fact agreement — see FactMismatch above. */
  drawingCadConsistency?: FactMismatch[];
  currency: string;
  currencySymbol: string;
  toUsdRate?: number;
  usdToDisplayRate?: number;
}

/** The route-comparison cache key and URL, defined once (same reasoning as costSummaryQueryKey). */
export function routeComparisonQueryKey(
  itemId: string | undefined,
  batchSize: number | undefined,
  location: string,
) {
  return ['bom-items', itemId, 'route-comparison', batchSize, location] as const;
}

export function routeComparisonUrl(
  itemId: string,
  batchSize: number | undefined,
  location: string,
): string {
  return `/bom-items/${itemId}/route-comparison?${costingQuery(batchSize, location)}`;
}

/** `batchSize` semantics are identical to useCostSummary above. */
export function useRouteComparison(itemId: string | undefined, batchSize: number | undefined, location = 'USA') {
  return useQuery({
    queryKey: routeComparisonQueryKey(itemId, batchSize, location),
    queryFn: () =>
      // The server takes 46-157 s for this comparison under load. A shorter client
      // timeout fails the request while the server keeps computing it, and a retry
      // then starts a second full computation behind the first.
      apiClient.get<RouteComparisonDto>(
        routeComparisonUrl(itemId ?? '', batchSize, location),
        { timeout: 180000 },
      ),
    enabled: useAuthEnabledWith(!!itemId),
    staleTime: 1000 * 60 * 5,
    retry: false,
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

/** Apply the route the server itself recommends (mirrors AUTO_ROUTE_ID in apply-route.dto.ts). */
export const AUTO_ROUTE_ID = 'auto';

// ── Apply manufacturing route → create process cost records ──────────────────
// Posts the user-selected routeId to the backend, which re-runs the route
// comparison engine, validates feasibility, then writes process_cost_records.
// On success, invalidates process-costs so ManufacturingProcessSection refreshes.
export function useApplyRoute(bomItemId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { routeId: string; batchSize?: number; location?: string }) =>
      apiClient.post<{ created: number; operations: string[]; routeLabel: string; routeId: string }>(
        `/bom-items/${bomItemId}/route-applications`,
        payload,
        // Re-runs the whole route-comparison engine before writing records —
        // observed taking 12-157s in practice, well past the 15s dev-mode
        // default (lib/config.ts) and this endpoint has no dynamic-ID-safe
        // entry in endpointTimeouts (those are exact-string keys, which can't
        // match a URL containing this item's UUID) — override per-call instead.
        // Shorter than the server's time, the client reports a failure for an apply
        // that then completes, inviting a second click that applies it twice.
        { timeout: 180000 },
      ),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['process-costs'], exact: false });
      // Without these, the Cost tab kept rendering its stale cached
      // cost-summary/route-comparison after a successful apply — the new
      // process_cost_records were real, but nothing told the UI to refetch.
      queryClient.invalidateQueries({ queryKey: ['bom-items', bomItemId, 'cost-summary'] });
      // Marked stale, not refetched now: writing process records does not change what
      // the comparison computes (its inputs are location, batch and scenario), and
      // re-running it is a 46-157 s server computation on the Apply critical path.
      queryClient.invalidateQueries({ queryKey: ['bom-items', bomItemId, 'route-comparison'], refetchType: 'none' });
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
        `/bom-items/${bomItemId}/custom-route-applications`,
        payload,
        // Same route-comparison re-run as apply-route (46-157 s). A shorter client
        // timeout reports failure for a write still running and invites a second click.
        { timeout: 180000 },
      ),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['process-costs'], exact: false });
      // Same gap as useApplyRoute above — the Cost tab never refetched after
      // a successful custom-route apply without these.
      queryClient.invalidateQueries({ queryKey: ['bom-items', bomItemId, 'cost-summary'] });
      // Marked stale, not refetched now: writing process records does not change what
      // the comparison computes (its inputs are location, batch and scenario), and
      // re-running it is a 46-157 s server computation on the Apply critical path.
      queryClient.invalidateQueries({ queryKey: ['bom-items', bomItemId, 'route-comparison'], refetchType: 'none' });
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
  source: "step_pmi" | "drawing_intelligence" | "no_data";
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
