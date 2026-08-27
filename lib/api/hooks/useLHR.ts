import { useQuery } from '@tanstack/react-query';

import { lhrApi } from '../lhr';

import type { BenchmarkLHREntry, EffectiveLHRRate } from '../lhr';

export const useLHRBenchmark = (location?: string) => useQuery<BenchmarkLHREntry[]>({
    queryKey: ['lhr-benchmark', location ?? '__all__'],
    queryFn: () => lhrApi.getBenchmarkRates(location),
    staleTime: 10 * 60 * 1000,   // benchmark rates rarely change
    refetchOnWindowFocus: false,
    // Same fix as useMHRBenchmark/useMHRRecords (useMHR.ts) for the exact
    // same bug: whichever process group/location this was queried for BEFORE
    // an admin edit or a data-gap migration landed permanently caches that
    // empty/stale result for the rest of the browser tab's life — nothing
    // else in this config (staleTime elapsing, window refocus, dialog
    // close/reopen without a real unmount) ever forces a re-fetch of an
    // already-cached key. Confirmed live: a real China "Sheet Metal" LHR
    // benchmark row existed in the DB the whole time, but the dialog kept
    // showing "No labour rate configured" and fell back to a manual $/hr
    // input because this query's cached result was never re-verified.
    refetchOnMount: 'always',
    throwOnError: false,
    select: (data) => data ?? [],
  });

export const useLHR = (search?: string) => useQuery({
    queryKey: ['lhr', search],
    queryFn: () => lhrApi.getAll(search),
    retry: false,
    staleTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    // Same reasoning as useLHRBenchmark above.
    refetchOnMount: 'always',
    throwOnError: false,
    select: (data) => data ?? { records: [], total: 0 },
  });

// The real cost-engine-aligned Skill Rate for a (location, process_group) —
// same resolver the MHR form's Labour tab shows read-only and mhr.service.ts
// snapshots server-side on save. Disabled until both args are real, non-empty
// strings — an empty processGroup/location would otherwise fire a query
// against every row.
export const useLHREffectiveRate = (location?: string | null, processGroup?: string | null) => useQuery<EffectiveLHRRate>({
    queryKey: ['lhr-effective-rate', location ?? '', processGroup ?? ''],
    // `enabled` below stops react-query from firing this in the disabled
    // state, but doesn't narrow location/processGroup's type here — this
    // guard both satisfies that and gives a safe result if ever called
    // anyway (e.g. an explicit refetch()) instead of a `!`-assertion crash.
    queryFn: () => (!location || !processGroup
      ? Promise.resolve<EffectiveLHRRate>({ rateUsdPerHr: null, source: 'none', sampleSize: 0 })
      : lhrApi.getEffectiveRate(location, processGroup)),
    enabled: !!location && !!processGroup,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: 'always',
    throwOnError: false,
  });

export const useLHRById = (id: string | number) => useQuery({
    queryKey: ['lhr', id],
    queryFn: () => lhrApi.getById(id),
    enabled: !!id,
  });
