import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiClient } from '../client';
import { useAuthEnabledWith } from './useAuthEnabled';

// Required tolerances per feature instance (GET/PUT /bom-items/:id/feature-tolerances,
// PUT /bom-items/:id/tolerance-policy). Shapes mirror the backend
// costing/shared/tolerance/feature-tolerances.ts.

export type GtolCategory =
  | 'tolerance' | 'diamTolerance' | 'positionTolerance' | 'roughness' | 'roughnessRz' | 'bendAngleTolerance'
  | 'circularity' | 'concentricity' | 'cylindricity' | 'flatness' | 'parallelism' | 'perpendicularity'
  | 'profileOfSurface' | 'runout' | 'totalRunout' | 'straightness' | 'symmetry' | 'angularity';

export type TolerancePolicy =
  | { mode: 'assume_achieved' }
  | { mode: 'uniform'; values: Partial<Record<GtolCategory, number>> }
  | { mode: 'cad'; replaceBelow: { thresholdMm: number; withMm: number } | null }
  | { mode: 'auto_detect' };

export interface FeatureInstance {
  key: string | null;
  featureId: string | null;
  occurrenceIndex: number;
  featureType: string;
  variant: string | null;
  label: string;
  faceIds: number[];
  stableFaceIds: string[];
  sizeMm: number | null;
  sizeSource: string | null;
  depthMm: number | null;
  extentsMm: number[] | null;
  centroidMm: [number, number, number] | null;
  axis: [number, number, number] | null;
  steps: Array<{ diameterMm: number; depthMm: number }> | null;
  lengthMm: number | null;
}

export interface ResolvedRequirement {
  category: GtolCategory;
  value: number;
  source: 'manual' | 'policy_uniform' | 'cad_model' | 'cad_model_replaced' | 'auto_detected';
  note?: string;
  /** The annotation an auto-detected requirement was read from. */
  origin?: { recordId: string; annotationRef: string; basis: 'native_pmi' | 'engineer_approved'; stated: string };
}

/** One tolerance the part's files state and how it reads (backend costing/shared/tolerance/auto-detect.ts). */
export interface DetectedTolerance {
  recordId: string;
  annotationRef: string;
  origin: 'model_pmi' | 'drawing';
  characteristic: string;
  category: GtolCategory | null;
  value: number | null;
  stated: string;
  basis: 'native_pmi' | 'engineer_approved' | null;
  featureKeys: string[];
  labels: string[];
  association: string;
  status: 'interpretable' | 'review' | 'not_a_requirement';
  reviewCode: string | null;
  reason: string;
}

export interface ToleranceDetection {
  detected: DetectedTolerance[];
  general: { text: string; standard: string; applied: false; reason: string } | null;
  conflicts: Array<{ characteristic: string; drawingMm: number; modelMm: number[]; detail: string }>;
}

export interface FeatureTolerancesView {
  instances: Array<{ instance: FeatureInstance; requirements: ResolvedRequirement[] }>;
  orphanedManual: Array<{ featureKey: string; category: GtolCategory; value: number }>;
  unappliedCad: Array<{ type: string; toleranceMm: number; reason: string }>;
  /** What the part's files state, whatever the policy; applied only by the auto_detect policy. */
  detection: ToleranceDetection;
  policy: TolerancePolicy;
  policyErrors: string[];
}

const key = (itemId: string) => ['bom-items', itemId, 'feature-tolerances'] as const;

export function useFeatureTolerances(itemId: string | undefined) {
  return useQuery({
    queryKey: key(itemId ?? ''),
    queryFn: () => apiClient.get<FeatureTolerancesView>(`/bom-items/${itemId}/feature-tolerances`),
    enabled: useAuthEnabledWith(!!itemId),
  });
}

function useAfterToleranceChange(itemId: string) {
  const queryClient = useQueryClient();
  return (data: FeatureTolerancesView) => {
    queryClient.setQueryData(key(itemId), data);
    queryClient.invalidateQueries({ queryKey: ['bom-items', itemId, 'machining-need'] });
    // Required tolerances decide machining operations, so cost follows them.
    queryClient.invalidateQueries({ queryKey: ['bom-items', itemId, 'cost-summary'] });
    queryClient.invalidateQueries({ queryKey: ['bom-items', itemId, 'route-comparison'] });
  };
}

/** values: number = Manual, null = back to Auto. */
export function useSetFeatureTolerances(itemId: string) {
  const after = useAfterToleranceChange(itemId);
  return useMutation({
    mutationFn: ({ featureKey, values }: { featureKey: string; values: Partial<Record<GtolCategory, number | null>> }) =>
      apiClient.put<FeatureTolerancesView>(`/bom-items/${itemId}/feature-tolerances/${encodeURIComponent(featureKey)}`, { values }),
    onSuccess: after,
    onError: (e: any) => toast.error(e?.message ?? 'Failed to save tolerances.'),
  });
}

export function useSetTolerancePolicy(itemId: string) {
  const after = useAfterToleranceChange(itemId);
  return useMutation({
    mutationFn: (policy: TolerancePolicy) => apiClient.put<FeatureTolerancesView>(`/bom-items/${itemId}/tolerance-policy`, policy),
    onSuccess: after,
    onError: (e: any) => toast.error(e?.message ?? 'Failed to save tolerance policy.'),
  });
}

// ── Machining need (GET /bom-items/:id/machining-need) ───────────────────────

export interface MachiningCandidate { operation: string; capabilityProcess: string; detail: string[] }

export interface FeatureMachiningNeed {
  featureKey: string | null;
  label: string;
  featureType: string;
  faceIds: number[];
  featureId: string | null;
  occurrenceIndex: number;
  verdict: 'as_primary' | 'needs_machining' | 'undecided';
  reasons: string[];
  requirements: ResolvedRequirement[];
  /** Makes the feature from solid when the primary process cannot form it. */
  forming: MachiningCandidate | null;
  /** Finishing operations that hold every requirement. */
  candidates: MachiningCandidate[];
  rejected: Array<{ operation: string; reason: string }>;
}

export interface MachiningNeedView {
  assessed: boolean;
  reason: string | null;
  missing: string[];
  result: { primaryProcess: string; features: FeatureMachiningNeed[]; machiningRequired: boolean } | null;
  /** How the part's process treats tolerances, and its decision on every feature (backend process-profile.ts). */
  profile: { process: string; capability: 'primary_process' | 'feature_operation' | 'not_validated'; operation: string; cost: 'priced' | 'reported' | 'none'; note: string };
  decisions: ToleranceDecision[];
}

export interface ToleranceDecision {
  featureKey: string | null;
  label: string;
  featureType: string;
  featureId: string | null;
  occurrenceIndex: number;
  faceIds: number[];
  decision: 'no_requirement' | 'held' | 'add_operation' | 'needs_review';
  judgedAs: string | null;
  operations: string[];
  requirements: ResolvedRequirement[];
  reason: string;
}

export function useMachiningNeed(itemId: string | undefined) {
  return useQuery({
    queryKey: ['bom-items', itemId ?? '', 'machining-need'] as const,
    queryFn: () => apiClient.get<MachiningNeedView>(`/bom-items/${itemId}/machining-need`),
    enabled: useAuthEnabledWith(!!itemId),
  });
}
