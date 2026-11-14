/**
 * React Query hooks for ZIP / STEP assembly upload. One canonical key per upload; polling stops as soon as the job
 * has settled (done or failed), and a missing upload (404) is not polled at all.
 */

import { useMutation, useQuery } from '@tanstack/react-query';

import { isInFlight } from '@/lib/cad-uploads/upload-view';

import { cadUploadsApi, type CadUpload } from '../cad-uploads';
import { ApiError } from '../client';
import { pollDelay } from '../poll-backoff';

const cadUploadKeys = {
  all: ['cad-uploads'] as const,
  one: (uploadId: string) => [...cadUploadKeys.all, uploadId] as const,
};

const POLL_MS = 2000;

/** A query only runs when its id is present (`enabled`); this keeps the type honest without an assertion. */
function required(id: string | null): string {
  if (!id) throw new Error('This query needs an id');
  return id;
}

export function useCadUpload(uploadId: string | null) {
  return useQuery({
    queryKey: cadUploadKeys.one(uploadId ?? 'none'),
    queryFn: () => cadUploadsApi.get(required(uploadId)),
    enabled: !!uploadId,
    refetchInterval: (query) => {
      const data: CadUpload | undefined = query.state.data;
      const wait = pollDelay(POLL_MS, query.state.status === 'error', query.state.errorUpdateCount); // slows down while the API is failing
      if (data) return isInFlight(data.status) ? wait : false;
      const error = query.state.error;
      return error instanceof ApiError && error.status === 404 ? false : wait; // a network blip must not end polling
    },
    retry: false,
    refetchOnWindowFocus: false,
  });
}

export function useStartCadUpload(bomId: string) {
  return useMutation({ mutationFn: (file: File) => cadUploadsApi.start(bomId, file) });
}
