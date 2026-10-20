'use client';

import { useState } from 'react';

import { useCostResult, useJob, useRequestQuote } from '@/lib/api/hooks/useElectronics';
import { createSingleFlight } from '@/lib/utils/single-flight';

/**
 * One cost calculation for an upload: the batch size a person enters (never defaulted), the queued job, and its versioned result.
 * Shared by the Scenario tab (where the batch is entered) and the Cost tab (where the result is shown).
 */
export function useQuoteFlow(uploadId: string) {
  const [batch, setBatch] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const [flight] = useState(() => createSingleFlight());
  const quote = useRequestQuote();
  const { data: job } = useJob(jobId);
  const { data: result } = useCostResult(job?.state === 'completed' ? (job.costResultId ?? null) : null);

  const size = Number(batch);
  const valid = Number.isInteger(size) && size >= 1;

  const calculate = () =>
    flight(async () => {
      const started = await quote.mutateAsync({ uploadId, batchSize: size });
      setJobId(started.jobId);
    });

  return {
    batch,
    setBatch,
    valid,
    calculate,
    starting: quote.isPending,
    job,
    result,
    running: !!job && job.state !== 'completed' && job.state !== 'failed',
  };
}

export type QuoteFlow = ReturnType<typeof useQuoteFlow>;
