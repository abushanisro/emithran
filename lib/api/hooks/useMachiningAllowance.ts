import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { apiClient } from '../client';

// The machining allowance of a sand-cast part, as the cost summary carries it (backend costing/casting/machining-allowance.ts), and the
// engineer's decision on one feature (POST /bom-items/:id/machining-allowances). The backend and the database decide who may write and
// bind the decision to the current file; nothing here is trusted for that.

export type AllowanceStatus = 'specified' | 'standard_derived' | 'foundry_profile_derived' | 'estimated' | 'requires_review';
export type AllowanceBasis = 'engineering_drawing' | 'cad_model_pmi' | 'customer_specification' | 'engineering_estimate';

export interface FeatureAllowance {
  featureKey: string;
  featureType: string;
  label: string;
  faceIds: number[];
  featureId: string | null;
  occurrenceIndex: number;
  status: AllowanceStatus;
  allowanceMm: number | null;
  sides: 1 | 2 | null;
  unit: 'mm';
  source: {
    level: 1 | 2 | 3 | 4 | 5;
    kind: 'decision' | 'dataset' | 'profile' | 'none';
    id: string | null;
    ref: string | null;
    basis?: string;
    reason?: string;
    setBy?: string | null;
    setAt?: string;
  };
  asCast: { rule: 'internal' | 'planar' | 'external'; finishedMm: number | null; asCastMm: number | null; detail: string } | null;
  notes: string[];
}

export interface MachiningAllowanceSummary {
  features: FeatureAllowance[];
  notMachined: { featureKey: string; label: string; reason: string; setBy: string | null }[];
  costed: false;
}

export interface AllowanceDecisionRequest {
  featureKey: string;
  machined: boolean;
  allowanceMm?: number;
  sides?: 1 | 2;
  basis?: AllowanceBasis;
  reason: string;
}

export function useDecideMachiningAllowance(itemId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: AllowanceDecisionRequest) => apiClient.post<{ ok: true }>(`/bom-items/${itemId}/machining-allowances`, request),
    onSuccess: (_r, request) => {
      void queryClient.invalidateQueries({ queryKey: ['bom-items', itemId, 'cost-summary'] });
      toast.success(request.machined ? 'Allowance recorded with your name and its source' : 'Marked not machined');
    },
    // The backend's words: not a member, part not analysed, a malformed value.
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'The allowance was not saved');
    },
  });
}
