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
  | { mode: 'cad'; replaceBelow: { thresholdMm: number; withMm: number } | null };

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
  source: 'manual' | 'policy_uniform' | 'cad_model' | 'cad_model_replaced';
  note?: string;
}

export interface FeatureTolerancesView {
  instances: Array<{ instance: FeatureInstance; requirements: ResolvedRequirement[] }>;
  orphanedManual: Array<{ featureKey: string; category: GtolCategory; value: number }>;
  unappliedCad: Array<{ type: string; toleranceMm: number; reason: string }>;
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
}

export function useMachiningNeed(itemId: string | undefined) {
  return useQuery({
    queryKey: ['bom-items', itemId ?? '', 'machining-need'] as const,
    queryFn: () => apiClient.get<MachiningNeedView>(`/bom-items/${itemId}/machining-need`),
    enabled: useAuthEnabledWith(!!itemId),
  });
}
