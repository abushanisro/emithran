/**
 * Hooks for the AI Process Plan Generator.
 *
 * Three primary surfaces:
 *   - useGenerateProcessPlan   — start a generation (POST /:bomItemId/generate)
 *   - useGenerationStream      — SSE stream of stage progress
 *   - useApplyGeneration       — commit the draft transactionally
 *   - useDiscardGeneration     — discard a draft (no credit charged)
 *   - useRecordLineEdit        — capture a user edit (feedback dataset)
 *
 * Shapes mirror backend DTOs in backend/src/modules/process-plan-generator/dto/.
 */

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiClient } from '../client';
import { apiConfig } from '../config';
import { supabase } from '../../supabase/client';

// ─── Types (mirror backend DTOs) ────────────────────────────────────────────

export type GenerationStatus = 'running' | 'draft_ready' | 'applied' | 'failed' | 'discarded' | 'out_of_scope';

export type DraftLineKind = 'raw_material' | 'process' | 'tooling' | 'logistics' | 'procured_part';

export interface CandidateConsidered {
  candidateId: string;
  label: string;
  score: number;
  chosen: boolean;
}

export interface DraftLineReferences {
  candidatesConsidered: CandidateConsidered[];
  newMasterRefs: string[];
}

export interface DraftLine {
  kind: DraftLineKind;
  index: number;
  data: Record<string, any>;
  references: DraftLineReferences;
  reason: string;
  estimatedCost: number | null;
}

export interface ProposedMaster {
  proposedMasterId: string;
  kind: 'raw_material' | 'process';
  data: Record<string, any>;
  reason: string;
  approved: boolean;
}

export interface RouteIssue {
  ruleId: string;
  ruleName: string;
  severity: 'error' | 'warning';
  message: string;
  affectedProcesses: string[];
  suggestedFix?: string;
}

export interface AlternativeRoute {
  routeId: string;
  routeLabel: string;
  complexityLevel: string;
  templateName: string;
  draft: Omit<DraftPackage, 'alternatives' | 'selectedRouteId'>;
  costPreview: {
    rawMaterial: number;
    process: number;
    tooling: number;
    logistics: number;
    procuredPart: number;
    total: number;
  };
  estimatedLeadTimeHours: number;
  riskScore: number;
  compositeRank: number;
  isRecommended: boolean;
  rationale: string;
}

export interface DraftPackage {
  draftLines: DraftLine[];
  proposedMasters: ProposedMaster[];
  validationErrors: string[];
  routeValidationIssues?: RouteIssue[];
  hasValidationErrors?: boolean;
  partFamily?: string;
  templateUsed?: string | null;
  costPreview: {
    rawMaterial: number;
    process: number;
    tooling: number;
    logistics: number;
    procuredPart: number;
    total: number;
  };
  alternatives?: AlternativeRoute[];
  selectedRouteId?: string | null;
}

export interface ToolCallLogEntry {
  index: number;
  toolName: 'expand_candidates' | 'save_draft';
  input: Record<string, any>;
  result: Record<string, any> | { error: string };
  durationMs: number;
}

export interface GenerationResponse {
  id: string;
  bomItemId: string;
  status: GenerationStatus;
  model: string;
  scopeDecision: {
    family: 'cnc_turned' | 'cnc_milled' | 'sheet_metal' | 'out_of_scope';
    inScope: boolean;
    reason: string;
    confidence: number;
  };
  brief: any;
  candidates: any;
  abstractPlan: any | null;
  draft: DraftPackage | null;
  toolCalls: ToolCallLogEntry[];
  tokensIn: number;
  tokensOut: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  creditCost: number;
  errorMessage: string | null;
  errorStage: string | null;
  routeValidationIssues?: RouteIssue[];
  hasValidationErrors?: boolean;
  partFamily?: string;
  templateUsed?: string | null;
  startedAt: string;
  completedAt: string | null;
  appliedAt: string | null;
}

export interface ApplyRequest {
  proposedMasterApprovals?: Array<{ proposedMasterId: string; approved: boolean }>;
  overrides?: Array<{ kind: DraftLineKind; index: number; data: Record<string, any> }>;
  removals?: Array<{ kind: DraftLineKind; index: number }>;
}

export interface ApplyResult {
  appliedLineIds: {
    rawMaterials: string[];
    processes: string[];
    tooling: string[];
    logistics: string[];
    procuredParts: string[];
    newRawMaterialMasters: string[];
    newProcessMasters: string[];
  };
  creditCost: number;
  totalCost: number;
}

export interface CreateLineEdit {
  lineKind: DraftLineKind;
  lineIndex: number;
  fieldPath: string;
  originalValue?: unknown;
  newValue?: unknown;
  editAction?: 'field_change' | 'added_line' | 'removed_line';
  editReason?: string;
}

// ─── Mutations ──────────────────────────────────────────────────────────────

const BASE = '/process-plan-generator';

export function useLatestDraftGeneration(bomItemId: string | null) {
  return useQuery({
    queryKey: ['process-plan-draft', bomItemId],
    queryFn: async (): Promise<GenerationResponse | null> => {
      if (!bomItemId) return null;
      try {
        return await apiClient.get<GenerationResponse>(`${BASE}/${bomItemId}/draft`, { silent: true });
      } catch {
        return null;
      }
    },
    enabled: !!bomItemId,
    staleTime: 30_000,
    retry: false,
    throwOnError: false,
  });
}

export function useGenerateProcessPlan() {
  return useMutation({
    mutationFn: async (input: { bomItemId: string; forceRefresh?: boolean; notes?: string }) => {
      const result = await apiClient.post<GenerationResponse>(
        `${BASE}/${input.bomItemId}/generate`,
        { forceRefresh: !!input.forceRefresh, notes: input.notes },
        { timeout: 120_000 },
      );
      return result;
    },
    onError: (error: any) => {
      const status = error?.status ?? error?.response?.status;
      if (status === 404) {
        toast.error('BOM item not found.');
      } else if (status === 403) {
        toast.error('You do not have permission to generate for this part.');
      } else {
        toast.error('Failed to generate process plan. Try again or use deterministic auto-fill.');
      }
    },
  });
}

export function useApplyGeneration() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ generationId, body }: { generationId: string; body: ApplyRequest; bomItemId?: string }) => {
      return apiClient.post<ApplyResult>(`${BASE}/generations/${generationId}/apply`, body);
    },
    onSuccess: (_data, variables) => {
      // Invalidate every cost-line query so the 5 section tables refresh
      queryClient.invalidateQueries({ queryKey: ['raw-material-costs'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['process-costs'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['tooling-costs'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['packaging-logistics-costs'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['procured-parts-costs'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['bom-item-cost'] });
      queryClient.invalidateQueries({ queryKey: ['bom-cost-report'] });
      // Clear the draft query so "View Draft" disappears after apply
      queryClient.invalidateQueries({ queryKey: ['process-plan-draft', variables.bomItemId], exact: false });
      queryClient.invalidateQueries({ queryKey: ['process-plan-draft'], exact: false });
      toast.success('Process plan applied.');
    },
    onError: (error: any) => {
      const msg = error?.body?.message ?? error?.message ?? 'Apply failed';
      toast.error(`Apply failed: ${msg}`);
    },
  });
}

export function useDiscardGeneration() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ generationId, bomItemId }: { generationId: string; bomItemId?: string }) => {
      await apiClient.post(`${BASE}/generations/${generationId}/discard`, {});
      return { generationId, bomItemId };
    },
    onSuccess: (_data) => {
      queryClient.invalidateQueries({ queryKey: ['process-plan-draft'], exact: false });
    },
  });
}

export function useRecordLineEdit() {
  return useMutation({
    mutationFn: async ({ generationId, edit }: { generationId: string; edit: CreateLineEdit }) => {
      return apiClient.post<{ id: string }>(`${BASE}/generations/${generationId}/edits`, edit);
    },
    // Silent — these fire on every field change; don't toast.
  });
}

export function useSelectRoute() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ generationId, routeId }: { generationId: string; routeId: string }) => {
      return apiClient.post(`${BASE}/generations/${generationId}/select-route`, { routeId });
    },
    onSuccess: (_data, { generationId }) => {
      queryClient.invalidateQueries({ queryKey: ['process-plan-draft'], exact: false });
      queryClient.invalidateQueries({ queryKey: ['process-plan-generation', generationId] });
    },
    onError: () => {
      toast.error('Failed to select route. Please try again.');
    },
  });
}

// ─── SSE stream hook ────────────────────────────────────────────────────────

export type StreamEvent =
  | { type: 'scope_decided'; data: { family: string; inScope: boolean; reason: string } }
  | { type: 'retrieval.done'; data: { candidateCounts: Record<string, number> } }
  | { type: 'reasoning.started'; data: { model: string } }
  | { type: 'reasoning.tool_call'; data: ToolCallLogEntry }
  | { type: 'resolver.done'; data: { lineCounts: Record<string, number>; proposedMasters: number; costPreview: any; validationErrors: string[] } }
  | { type: 'draft_ready'; data: { generationId: string; lineCounts: Record<string, number>; costPreview: any } }
  | { type: 'out_of_scope'; data: { reason: string } }
  | { type: 'failed'; data: { stage: string; error: string } }
  | { type: 'ping'; data: { t: number } };

/**
 * Subscribes to /process-plan-generator/:bomItemId/stream as long as
 * `enabled` is true. Returns an in-memory array of events received.
 *
 * The backend gates the stream by the user's auth token, but the browser
 * EventSource API doesn't allow custom headers, so we pass the token as
 * a query-string parameter and the backend's SupabaseAuthGuard accepts
 * either Authorization header OR ?token=.
 *
 * Hits the API gateway directly (apiConfig.endpoints.api.v1, e.g.
 * http://localhost:4000/v1/api). Going through Next.js doesn't work for
 * SSE because Next dev-server doesn't proxy long-lived connections.
 */
export function useGenerationStream(bomItemId: string, enabled: boolean): StreamEvent[] {
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!enabled || !bomItemId) {
      sourceRef.current?.close();
      sourceRef.current = null;
      return;
    }

    let cancelled = false;
    (async () => {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token ?? '';
      if (cancelled) return;

      const base = apiConfig.endpoints.api.v1;
      const url = `${base}${BASE}/${bomItemId}/stream?token=${encodeURIComponent(token)}`;
      const src = new EventSource(url);
      sourceRef.current = src;

      const handlers: StreamEvent['type'][] = [
        'scope_decided',
        'retrieval.done',
        'reasoning.started',
        'reasoning.tool_call',
        'resolver.done',
        'draft_ready',
        'out_of_scope',
        'failed',
        'ping',
      ];
      for (const t of handlers) {
        src.addEventListener(t, (e: MessageEvent) => {
          try {
            const data = JSON.parse((e as any).data);
            setEvents((prev) => [...prev, { type: t, data } as StreamEvent]);
          } catch { /* malformed event, ignore */ }
        });
      }
    })();

    return () => {
      cancelled = true;
      sourceRef.current?.close();
      sourceRef.current = null;
    };
  }, [bomItemId, enabled]);

  return events;
}
