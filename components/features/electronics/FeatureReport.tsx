'use client';

import { useQueryClient } from '@tanstack/react-query';
import { Loader2, XCircle } from 'lucide-react';
import { useEffect } from 'react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { electronicsKeys, useJob, useUploadFeatures } from '@/lib/api/hooks/useElectronics';

import { BatchInput, FeatureSections, FileTable, FindingsList, ProcessNeeds, QuoteOutcome, UnresolvedList } from './report-parts';
import { useQuoteFlow } from './useQuoteFlow';

function JobBanner({ jobId, onSettled }: { jobId: string; onSettled: () => void }) {
  const { data: job } = useJob(jobId);
  const settled = job?.state === 'completed' || job?.state === 'failed' || job?.state === 'expired';
  useEffect(() => {
    if (settled) onSettled();
  }, [settled, onSettled]);
  if (!job || !settled) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
        <Loader2 className="h-4 w-4 animate-spin" /> {job?.state === 'running' ? 'Reading the files…' : 'Waiting in the queue…'}
      </div>
    );
  }
  if (job.state === 'failed') {
    return (
      <Alert variant="destructive">
        <XCircle className="h-4 w-4" />
        <AlertTitle>The files could not be read</AlertTitle>
        <AlertDescription>{job.error ?? 'The extraction failed.'}</AlertDescription>
      </Alert>
    );
  }
  return null;
}

function Quote({ uploadId }: { uploadId: string }) {
  const flow = useQuoteFlow(uploadId);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Calculate assembly cost</CardTitle>
        <CardDescription>The cost is computed only from sourced rates. A missing rate is reported, never priced at zero.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <BatchInput flow={flow} />
        <QuoteOutcome flow={flow} />
        <ProcessNeeds />
      </CardContent>
    </Card>
  );
}

/** The whole extraction report for one upload, as one page: files, features, cross-checks, unknowns and the cost calculation. */
export function FeatureReport({ uploadId, jobId }: { uploadId: string; jobId?: string }) {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useUploadFeatures(uploadId);
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: electronicsKeys.features(uploadId) });
  };

  return (
    <div className="space-y-4">
      {jobId && <JobBanner jobId={jobId} onSettled={refresh} />}
      {isLoading && <div className="h-24 animate-pulse rounded-md bg-muted" />}
      {error && <Alert variant="destructive"><XCircle className="h-4 w-4" /><AlertTitle>Could not load the result</AlertTitle><AlertDescription>Try reloading the page.</AlertDescription></Alert>}

      {data && (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                Files
                <Badge variant={data.upload.status === 'failed' ? 'destructive' : 'secondary'}>{data.upload.status.replace('_', ' ')}</Badge>
              </CardTitle>
              {data.upload.failure && <CardDescription className="text-destructive">{data.upload.failure.message}</CardDescription>}
            </CardHeader>
            <CardContent><FileTable data={data} /></CardContent>
          </Card>

          {data.featureGraph && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Extracted features</CardTitle>
                  <CardDescription>Each value says where it came from: measured from a file, supplied by a person or document, or derived from other values.</CardDescription>
                </CardHeader>
                <CardContent><FeatureSections graph={data.featureGraph.graph} /></CardContent>
              </Card>

              {(data.featureGraph.graph.findings?.length ?? 0) > 0 && (
                <Card>
                  <CardHeader><CardTitle className="text-base">Cross-checks</CardTitle></CardHeader>
                  <CardContent><FindingsList graph={data.featureGraph.graph} /></CardContent>
                </Card>
              )}

              {data.featureGraph.graph.unresolved.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Not known from these files</CardTitle>
                    <CardDescription>These stay blank. They are never estimated.</CardDescription>
                  </CardHeader>
                  <CardContent><UnresolvedList graph={data.featureGraph.graph} /></CardContent>
                </Card>
              )}

              <Quote uploadId={uploadId} />
            </>
          )}
        </>
      )}
    </div>
  );
}
