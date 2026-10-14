import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiClient } from '../client';
import { useAuthEnabledWith } from './useAuthEnabled';

// Engineer review of PMI values the CAD engine could only decode from drawn glyphs
// (GET /bom-items/:id/pmi-records, POST /bom-items/:id/pmi-records/review, GET .../history).
// Shapes mirror backend costing/shared/tolerance/pmi-records.ts. The backend decides who may review and
// whether a record is still current; nothing here is trusted for that.

export type PmiReviewState = 'verified' | 'awaiting_review' | 'approved' | 'rejected' | 'stale' | 'conflict' | 'unresolved';
export type PmiReviewScope = 'record' | 'datum_refs';
export type PmiReviewBasis = 'engineering_drawing' | 'cad_model_pmi' | 'customer_specification' | 'other';

export const PMI_BASIS_LABEL: Record<PmiReviewBasis, string> = {
  engineering_drawing: 'Engineering drawing',
  cad_model_pmi: 'CAD model PMI (native)',
  customer_specification: 'Customer specification',
  other: 'Other authoritative source',
};

export interface PmiReviewRow {
  recordKey: string;
  scope: PmiReviewScope;
  decision: 'approved' | 'rejected';
  recordFingerprint: string;
  fileSha256: string;
  reviewerId: string;
  reviewerEmail: string | null;
  reviewedAt: string;
  approvedValues: Record<string, unknown>;
  basis: string;
  notes: string | null;
  supersededAt: string | null;
}

export interface PmiLimits { lowerMm: number; upperMm: number; minMm: number; maxMm: number }

export interface ReviewablePmiRecord {
  id: string;
  annotationRef: string;
  recordType: 'dimension' | 'gdt' | 'datum';
  dimensionType: string | null;
  characteristic: string | null;
  nominalMm: number | null;
  unit: string;
  limits: PmiLimits | null;
  zoneMm: number | null;
  datumRefs: string[] | null;
  datumLetter: string | null;
  source: 'native_pmi' | 'decoded_graphics' | 'callout_label';
  status: string;
  automationReady: boolean;
  automationBasis: 'native_pmi' | 'engineer_approved' | null;
  checks: string[];
  reasons: string[];
  cadFeature: string | null;
  decodedText: string | null;
  glyphMatch: { minIou: number | null; minMargin: number | null; ignoredGlyphs: number; ambiguousOrientation: boolean } | null;
  faceIds: number[];
  association: string;
  fingerprint: string | null;
  datumRefsFingerprint: string | null;
  reviewState: PmiReviewState;
  review: PmiReviewRow | null;
  datumRefsReviewState: PmiReviewState | null;
  datumRefsReview: PmiReviewRow | null;
  datumRefsAutomationReady: boolean;
}

export interface PmiRecordsView {
  records: ReviewablePmiRecord[];
  fileSha256: string | null;
  role: string | null;
  canReview: boolean;
  bases: PmiReviewBasis[];
}

export interface PmiReviewRequest {
  recordKey: string;
  scope: PmiReviewScope;
  decision: 'approved' | 'rejected';
  recordFingerprint: string;
  basis: PmiReviewBasis;
  notes?: string;
}

const key = (itemId: string) => ['bom-items', itemId, 'pmi-records'] as const;

export function usePmiRecords(itemId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: key(itemId ?? ''),
    queryFn: () => apiClient.get<PmiRecordsView>(`/bom-items/${itemId}/pmi-records`),
    enabled: useAuthEnabledWith(!!itemId && enabled),
    staleTime: 30_000,
  });
}

export function usePmiRecordHistory(itemId: string | undefined, recordKey: string | null) {
  return useQuery({
    queryKey: [...key(itemId ?? ''), 'history', recordKey] as const,
    queryFn: () => apiClient.get<PmiReviewRow[]>(`/bom-items/${itemId}/pmi-records/history?recordKey=${encodeURIComponent(recordKey ?? '')}`),
    enabled: useAuthEnabledWith(!!itemId && !!recordKey),
  });
}

export function useReviewPmiRecord(itemId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: PmiReviewRequest) => apiClient.post<PmiRecordsView>(`/bom-items/${itemId}/pmi-records/review`, request),
    onSuccess: (view, request) => {
      queryClient.setQueryData(key(itemId ?? ''), view);
      queryClient.invalidateQueries({ queryKey: [...key(itemId ?? ''), 'history'] });
      toast.success(request.decision === 'approved' ? 'Approved: recorded with your name and the source you checked' : 'Rejected: recorded');
    },
    // A stale record (409) or a permission error is the backend's decision; show its words and reload the current state.
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'The review was not saved');
      queryClient.invalidateQueries({ queryKey: key(itemId ?? '') });
    },
  });
}
