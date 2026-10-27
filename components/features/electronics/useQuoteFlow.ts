'use client';

import { useEffect, useMemo, useState } from 'react';

import type { ElectronicsScenario } from '@/lib/api/electronics';
import { useCostResult, useJob, useLatestResult, useRequestQuote } from '@/lib/api/hooks/useElectronics';
import { createSingleFlight } from '@/lib/utils/single-flight';


/** A stated input as typed: kept as text until it is sent, so a half-typed number is never coerced. */
export interface DraftValue { value: string; note: string }

export interface ScenarioDraft {
  location: string;
  displayCurrency: string;
  annualVolume: string;
  machines: Record<string, string>;
  inputs: Record<string, DraftValue>;
}

const EMPTY: ScenarioDraft = { location: '', displayCurrency: 'USD', annualVolume: '', machines: {}, inputs: {} };
const draftKey = (uploadId: string) => `electronics-scenario-draft:${uploadId}`;

function fromScenario(s: ElectronicsScenario): ScenarioDraft {
  return {
    location: s.location,
    displayCurrency: s.displayCurrency ?? 'USD',
    annualVolume: s.annualVolume ? String(s.annualVolume) : '',
    machines: { ...s.machines },
    inputs: Object.fromEntries(Object.entries(s.inputs).map(([k, v]) => [k, { value: String(v.value), note: v.note }])),
  };
}

/** The scenario to send: only inputs with both a number and a source, never a defaulted value. */
export function toScenario(d: ScenarioDraft): ElectronicsScenario {
  const inputs: ElectronicsScenario['inputs'] = {};
  for (const [key, v] of Object.entries(d.inputs)) {
    const value = Number(v.value);
    if (v.value.trim() !== '' && Number.isFinite(value) && value > 0 && v.note.trim() !== '') inputs[key] = { value, note: v.note.trim() };
  }
  const annual = Number(d.annualVolume);
  return {
    location: d.location,
    ...(d.displayCurrency ? { displayCurrency: d.displayCurrency } : {}),
    ...(Number.isInteger(annual) && annual >= 1 ? { annualVolume: annual } : {}),
    machines: Object.fromEntries(Object.entries(d.machines).filter(([, id]) => id)),
    inputs,
  };
}

/** Problems that stop a value from being sent, by input key: a number without a source, or a source without a number. */
export function draftProblems(d: ScenarioDraft): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, v] of Object.entries(d.inputs)) {
    const hasValue = v.value.trim() !== '';
    const value = Number(v.value);
    if (hasValue && (!Number.isFinite(value) || value <= 0)) out[key] = 'must be a number greater than 0';
    else if (hasValue && v.note.trim() === '') out[key] = 'say where the value comes from';
    else if (!hasValue && v.note.trim() !== '') out[key] = 'enter the value';
  }
  return out;
}

/**
 * One cost calculation for an upload: the scenario (location, machines, stated inputs), the batch size (never defaulted),
 * the queued job and its versioned result. The last calculated scenario is restored from its stored result; an unsent
 * draft is kept in this browser only.
 */
export function useQuoteFlow(uploadId: string) {
  const [batch, setBatch] = useState('');
  const [draft, setDraftState] = useState<ScenarioDraft>(EMPTY);
  const [restored, setRestored] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [flight] = useState(() => createSingleFlight());
  const quote = useRequestQuote();
  const latest = useLatestResult(uploadId);
  const { data: job } = useJob(jobId);
  const { data: fresh } = useCostResult(job?.state === 'completed' ? (job.costResultId ?? null) : null);
  const result = fresh ?? (jobId ? undefined : (latest.data ?? undefined));

  // Restore once: an unsent draft in this browser wins, else the scenario of the last calculation.
  useEffect(() => {
    if (restored || latest.isLoading) return;
    let saved: { draft: ScenarioDraft; batch: string } | null;
    try {
      const raw = window.localStorage.getItem(draftKey(uploadId));
      saved = raw ? (JSON.parse(raw) as { draft: ScenarioDraft; batch: string }) : null;
    } catch {
      saved = null;
    }
    if (saved) {
      setDraftState({ ...EMPTY, ...saved.draft });
      setBatch(saved.batch);
    } else if (latest.data?.result.scenario) {
      setDraftState(fromScenario(latest.data.result.scenario));
      setBatch(String(latest.data.batchSize));
    }
    setRestored(true);
  }, [restored, latest.isLoading, latest.data, uploadId]);

  const setDraft = (update: (d: ScenarioDraft) => ScenarioDraft) => {
    setDraftState((current) => {
      const next = update(current);
      try {
        window.localStorage.setItem(draftKey(uploadId), JSON.stringify({ draft: next, batch }));
      } catch {
        // storage unavailable (private window): the draft still lives in this tab
      }
      return next;
    });
  };

  const size = Number(batch);
  const valid = Number.isInteger(size) && size >= 1;
  const problems = useMemo(() => draftProblems(draft), [draft]);
  const ready = valid && draft.location !== '' && Object.keys(problems).length === 0;

  const calculate = () =>
    flight(async () => {
      const started = await quote.mutateAsync({ uploadId, batchSize: size, scenario: toScenario(draft) });
      setJobId(started.jobId);
      try {
        window.localStorage.removeItem(draftKey(uploadId)); // sent: the stored result now carries the scenario
      } catch {
        // nothing to clear
      }
    });

  return {
    batch,
    setBatch: (v: string) => {
      setBatch(v);
      try {
        window.localStorage.setItem(draftKey(uploadId), JSON.stringify({ draft, batch: v }));
      } catch {
        // storage unavailable
      }
    },
    draft,
    setDraft,
    problems,
    valid,
    ready,
    calculate,
    starting: quote.isPending,
    job,
    result,
    running: !!job && job.state !== 'completed' && job.state !== 'failed',
  };
}

export type QuoteFlow = ReturnType<typeof useQuoteFlow>;
