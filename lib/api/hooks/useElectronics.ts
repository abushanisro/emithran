/**
 * React Query hooks for the electronics costing API.
 *
 * One canonical key per resource (engineering rules): a key carries every parameter that affects the result and is
 * built in one place here. Jobs poll until they settle; nothing is polled after that.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import { isInFlight } from '@/lib/electronics/design-view';

import { ApiError } from '../client';
import { electronicsApi, type JobStatus } from '../electronics';

export const electronicsKeys = {
  all: ['electronics'] as const,
  formats: () => [...electronicsKeys.all, 'file-formats'] as const,
  coverage: () => [...electronicsKeys.all, 'reference-coverage'] as const,
  designs: (projectId: string) => [...electronicsKeys.all, 'designs', projectId] as const,
  design: (designId: string) => [...electronicsKeys.all, 'design', designId] as const,
  job: (jobId: string) => [...electronicsKeys.all, 'job', jobId] as const,
  features: (uploadId: string) => [...electronicsKeys.all, 'features', uploadId] as const,
  preview: (uploadId: string) => [...electronicsKeys.all, 'preview', uploadId] as const,
  thumbnail: (uploadId: string) => [...electronicsKeys.all, 'thumbnail', uploadId] as const,
  result: (resultId: string) => [...electronicsKeys.all, 'result', resultId] as const,
};

const JOB_POLL_MS = 1000;

/** A query only runs when its id is present (`enabled`); this keeps the type honest without an assertion. */
function required(id: string | null): string {
  if (!id) throw new Error('This query needs an id');
  return id;
}
const isSettled = (job: JobStatus | undefined) => job?.state === 'completed' || job?.state === 'failed' || job?.state === 'expired';

/** The file types an upload accepts, from the platform file-role table (never a list kept in the UI). */
export function useFileFormats() {
  return useQuery({
    queryKey: electronicsKeys.formats(),
    queryFn: electronicsApi.fileFormats,
    staleTime: 1000 * 60 * 60,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

/** The designs of one project. */
export function useDesigns(projectId: string) {
  return useQuery({
    queryKey: electronicsKeys.designs(projectId),
    queryFn: () => electronicsApi.designs(projectId),
    enabled: !!projectId,
    // While any revision is still being read the list keeps refreshing, then stops.
    refetchInterval: (query) => (query.state.data?.some((d) => d.revisions.some((r) => isInFlight(r.status))) ? 2000 : false),
    retry: false,
    refetchOnWindowFocus: false,
  });
}

export function useDesign(designId: string | null) {
  return useQuery({
    queryKey: electronicsKeys.design(designId ?? 'none'),
    queryFn: () => electronicsApi.design(required(designId)),
    enabled: !!designId,
    refetchInterval: (query) => (query.state.data?.revisions.some((r) => isInFlight(r.status)) ? 2000 : false),
    retry: false,
    refetchOnWindowFocus: false,
  });
}

export function useReferenceCoverage() {
  return useQuery({
    queryKey: electronicsKeys.coverage(),
    queryFn: electronicsApi.coverage,
    staleTime: 1000 * 60 * 5,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

/** A job, polled once a second until it completes, fails or expires. */
export function useJob(jobId: string | null) {
  return useQuery({
    queryKey: electronicsKeys.job(jobId ?? 'none'),
    queryFn: () => electronicsApi.job(required(jobId)),
    enabled: !!jobId,
    refetchInterval: (query) => (isSettled(query.state.data) ? false : JOB_POLL_MS),
    retry: false,
    refetchOnWindowFocus: false,
  });
}

export function useUploadFeatures(uploadId: string | null) {
  return useQuery({
    queryKey: electronicsKeys.features(uploadId ?? 'none'),
    queryFn: () => electronicsApi.features(required(uploadId)),
    enabled: !!uploadId,
    refetchInterval: (query) => (isInFlight(query.state.data?.upload.status ?? null) ? 2000 : false),
    retry: false,
    refetchOnWindowFocus: false,
  });
}

/** The board layers, as drawn when the set was parsed and stored by the platform (the engine is only needed for an upload with no stored drawing). Only asked for once the upload has a feature graph. */
export function useBoardPreview(uploadId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: electronicsKeys.preview(uploadId ?? 'none'),
    queryFn: () => electronicsApi.preview(required(uploadId)),
    enabled: !!uploadId && enabled,
    staleTime: 1000 * 60 * 10,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

/** The list-card picture of a board. One small request per card, kept for the session; a card without one shows its icon. */
export function useBoardThumbnail(uploadId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: electronicsKeys.thumbnail(uploadId ?? 'none'),
    queryFn: () => electronicsApi.thumbnail(required(uploadId)),
    enabled: !!uploadId && enabled,
    staleTime: 1000 * 60 * 30,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

export function useCostResult(resultId: string | null) {
  return useQuery({
    queryKey: electronicsKeys.result(resultId ?? 'none'),
    queryFn: () => electronicsApi.result(required(resultId)),
    enabled: !!resultId,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

const refreshAll = (queryClient: ReturnType<typeof useQueryClient>) => queryClient.invalidateQueries({ queryKey: electronicsKeys.all });
const failure = (title: string) => (error: unknown) => {
  toast.error(title, { description: error instanceof ApiError ? error.message : 'Try again.' });
};

/** An empty assembly or sub-assembly. */
export function useCreateContainer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: electronicsApi.createContainer,
    onSuccess: () => refreshAll(queryClient),
    onError: failure('Could not create it'),
  });
}

/** Permanent: a design and everything below it, or one revision. The lists and any open report refresh. */
export function useDeleteDesign() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (designId: string) => electronicsApi.deleteDesign(designId),
    onSuccess: (result) => {
      if (result.fileRemovalFailed) toast.warning('Deleted, but some stored files could not be removed', { description: 'They are unreachable; ask an administrator to clean them up.' });
      return refreshAll(queryClient);
    },
    onError: failure('Could not delete it'),
  });
}

export function useDeleteRevision() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { designId: string; revisionId: string }) => electronicsApi.deleteRevision(args.designId, args.revisionId),
    onSuccess: () => refreshAll(queryClient),
    onError: failure('Could not delete the revision'),
  });
}

/** Read the stored files of a revision again. */
export function useReparse() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (uploadId: string) => electronicsApi.reparse(uploadId),
    onSuccess: () => refreshAll(queryClient),
    onError: failure('Could not read the files again'),
  });
}

export function useStartUpload() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: Parameters<typeof electronicsApi.startUpload>[0]) => electronicsApi.startUpload(args),
    // A new design or revision changes every list that shows designs.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [...electronicsKeys.all, 'designs'] }),
    onError: (error: unknown) => {
      toast.error('Upload failed', { description: error instanceof ApiError ? error.message : 'The files could not be uploaded.' });
    },
  });
}

export function useRequestQuote() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { uploadId: string; batchSize: number }) => electronicsApi.requestQuote(args.uploadId, args.batchSize),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: electronicsKeys.all }),
    onError: (error: unknown) => {
      toast.error('Could not start the calculation', { description: error instanceof ApiError ? error.message : 'Try again.' });
    },
  });
}
