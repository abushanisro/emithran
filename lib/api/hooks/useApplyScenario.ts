import { useMutation, useQueryClient } from '@tanstack/react-query';

import type { ApplyScenarioRequest } from '@/lib/scenario/build-apply-request';

import { apiClient } from '../client';
import { analysisStatusKey } from './useAnalysisStatus';

/** The state the backend stores on the item and returns from an apply (backend AppliedScenarioState). */
export interface AppliedScenarioState {
  revision: number;
  status: 'applying' | 'applied' | 'failed';
  startedAt?: string;
  appliedAt?: string;
  failedAt?: string;
  error?: string;
}

/** What one apply did (backend ScenarioApplicationResult). */
export interface ScenarioApplicationResult {
  scenario: AppliedScenarioState;
  analysis: { ran: string[] };
  material: { grade: string; action: 'kept' | 'replaced'; recordId: string | null } | null;
  route: { mode: string; routeId: string | null; routeLabel: string; created: number; operations: string[] };
  machineOverrides: { saved: number; failed: { processKey: string; message: string }[] };
  warnings: string[];
}

/**
 * Apply Scenario as one request: the backend makes the analysis current, writes the scenario, the material cost record and the route, and stores the
 * outcome on the item. The page no longer runs that sequence step by step. A refusal arrives as an ApiError with a code the caller can act on:
 * analysis_not_ready, scenario_revision_conflict (another apply moved the scenario since the page read it) or scenario_apply_in_progress.
 */
export function useApplyScenario(bomItemId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: ApplyScenarioRequest): Promise<ScenarioApplicationResult> => {
      if (!bomItemId) throw new Error('Apply needs a BOM item id');
      // retry: false - an apply writes; repeating it after a timeout is the caller's choice (it is idempotent, and the revision check refuses a stale one).
      return apiClient.post<ScenarioApplicationResult>(`/bom-items/${bomItemId}/scenario-applications`, request, { timeout: 240_000, retry: false });
    },
    // Success or refusal, the server may have moved on (the analysis ran, earlier writes stay on a failure): read it again.
    onSettled: () => {
      for (const key of [
        ['bom-items', 'detail', bomItemId],
        ['bom-items', bomItemId],
        ['process-costs'],
        ['raw-material-costs'],
        analysisStatusKey(bomItemId),
      ]) void queryClient.invalidateQueries({ queryKey: key });
    },
  });
}
