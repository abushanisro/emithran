// Real MHR/LHR rate resolution for a single process line — extracted
// verbatim (behavior-preserving refactor, 2026-09-04) from
// components/features/process-planning/ProcessCostDialog.tsx, which had
// this same ~300-line block inlined. Extracted so a second consumer
// (the new tree-based process-line editor, Machine Economics backlog Phase
// 1b) can reuse the EXACT same rate-resolution rules instead of a risky
// re-derivation — this logic carries several real, previously-shipped
// live-bug fixes (see the per-block comments below) that a rewrite could
// easily and silently drop.
//
// Deliberately a pure LOGIC hook: it does not own selectedMHRId/selectedLHRId
// state (the caller does, since which row is "selected" is a UI concern that
// differs between the old dialog and the new editor) — it only resolves the
// real candidate lists and effective rates from real DB data.
import { useMemo, useCallback } from 'react';

import { useLHR, useLHRById, useLHRBenchmark } from './useLHR';
import { useMHRRecords, useMHRRecord, useMHRBenchmark } from './useMHR';

import type { LHREntry, BenchmarkLHREntry } from '../lhr';
import type { MHRRecord, MHRBenchmarkEntry } from '../mhr';
import type { ProcessCalculatorMapping } from './useProcessCalculatorMappings';

// The real API surface genuinely mixes two structurally different shapes in
// the same candidate list (a shop's own mhr_records row vs. a synthetic
// mhr_benchmark_rates entry) — real heterogeneity, not a typing shortcut.
export type MhrLikeRow = MHRRecord | MHRBenchmarkEntry;

// Machine-specific labour rate (see machineSpecificLHR below) is a real,
// synthesized LHR-shaped pseudo-record — this is its exact shape, distinct
// from the two real DB row shapes it's unioned with.
export interface MachineSpecificLhrRow {
  id: string;
  labourType: string;
  processGroup: string | null;
  lhr: number;
  lhrUsdEffective: number;
  location: string;
  isBenchmark: boolean;
}
export type LhrLikeRow = LHREntry | BenchmarkLHREntry | MachineSpecificLhrRow;

// process_cost_records.machine_rate is always stored in USD — prefer the
// USD-normalised field so a non-USA-location machine's local-currency rate
// is never misread as a USD number. Same real formula as
// lib/api/mhr.ts's resolveMhrUsdRate, duplicated (not imported) because that
// function is strictly typed to MHRRecord alone — this hook's real
// filteredMHR list also contains MHRBenchmarkEntry rows, which
// resolveMhrUsdRate was never meant to (and structurally cannot) accept.
function resolveRateUsd(r: MhrLikeRow): number {
  // calculations.totalMachineHourRate is always a real, defined number on
  // both real shapes — mhrUsdPerHour (a real mhr_records row only) still
  // takes priority over it when present, matching resolveMhrUsdRate's own
  // real formula (lib/api/mhr.ts) for the shared, non-benchmark case.
  if ('mhrUsdPerHour' in r) {
    return r.mhrUsdPerHour ?? r.calculations.totalMachineHourRate;
  }
  return r.calculations.totalMachineHourRate;
}

export interface UseProcessLineRatesParams {
  open: boolean;
  location: string;
  selectedGroup: string;
  selectedRoute: string;
  selectedOperation: string;
  allMappings: ProcessCalculatorMapping[] | undefined;
  selectedMHRId: string;
  selectedLHRId: string;
  // The row's own previously-saved ids (editData.mhrId/machineId, .lhrId,
  // .benchmarkMhrId, .benchmarkLhrId in the old dialog's terms) — ensures a
  // saved-but-now-out-of-filter pick still appears in the dropdown/resolves
  // a real rate instead of silently vanishing.
  savedMhrId?: string;
  savedLhrId?: string;
  savedBenchmarkMhrId?: string;
  savedBenchmarkLhrId?: string;
  manualMhrRate: number | '';
  manualLhrRate: number | '';
  editDataMachineRate?: number;
  editDataLaborRate?: number;
}

export function useProcessLineRates(params: UseProcessLineRatesParams) {
  const {
    open, location, selectedGroup, selectedRoute, selectedOperation, allMappings,
    selectedMHRId, selectedLHRId,
    savedMhrId = '', savedLhrId = '', savedBenchmarkMhrId = '', savedBenchmarkLhrId = '',
    manualMhrRate, manualLhrRate, editDataMachineRate, editDataLaborRate,
  } = params;

  // Derive the machine class key for this specific operation from the process
  // mapping row. selectedGroup is the domain name ('Sheet Metal');
  // selectedMachineClass is the MHR table key ('fiber_laser') — migration 368
  // added machine_class to process_calculator_mappings so no heuristic is
  // needed to link them.
  const selectedMapping = useMemo(() => {
    if (!selectedGroup || !selectedRoute || !selectedOperation || !allMappings) return undefined;
    return allMappings.find((m) =>
      m.processGroup === selectedGroup &&
      m.processRoute === selectedRoute &&
      m.operation === selectedOperation,
    );
  }, [allMappings, selectedGroup, selectedRoute, selectedOperation]);

  const selectedMachineClass = useMemo(() => selectedMapping?.machineClass ?? '', [selectedMapping]);

  // Real lhr_records/lhr_benchmark_rates process_group this operation's
  // machine class is billed against (migration 424's lhr_process_group
  // column) — falls back to selectedGroup when the mapping row has none set.
  const selectedLhrGroup = useMemo(
    () => selectedMapping?.lhrProcessGroup ?? selectedGroup,
    [selectedMapping, selectedGroup],
  );

  // Mirrors backend migration 369's chk_machine_class_required CHECK
  // constraint: Raw Material intake, Packing & Delivery logistics, and the
  // General/General placeholder route are legitimately non-machine steps.
  const isNonMachineOperation =
    selectedRoute === 'Raw Material' ||
    selectedGroup === 'Packing & Delivery' ||
    (selectedRoute === 'General' && selectedOperation === 'General');

  const operationFullySelected = !!(selectedGroup && selectedRoute && selectedOperation);

  const { data: mhrData, isLoading: isLoadingMHR } = useMHRRecords({
    limit: 100,
    ...(selectedMachineClass ? { machineClass: selectedMachineClass } : {}),
  }, { enabled: open });
  const { data: benchmarkMHR } = useMHRBenchmark(undefined, selectedMachineClass || undefined, { enabled: open });
  const { data: savedMHRRecord } = useMHRRecord(savedMhrId, { enabled: !!savedMhrId && open });
  const { data: savedLHRRecord } = useLHRById(savedLhrId && open ? savedLhrId : '');
  const { data: lhrData, isLoading: isLoadingLHR } = useLHR();
  const { data: benchmarkLHR } = useLHRBenchmark();

  const { data: allBenchmarkMHR } = useMHRBenchmark(undefined, undefined, { enabled: open && !!savedBenchmarkMhrId });
  const savedBenchmarkMHRRecord = useMemo<MHRBenchmarkEntry | null>(
    () => allBenchmarkMHR.find((r) => r.id === savedBenchmarkMhrId) ?? null,
    [allBenchmarkMHR, savedBenchmarkMhrId],
  );
  const savedBenchmarkLHRRecord = useMemo<BenchmarkLHREntry | null>(
    () => (benchmarkLHR ?? []).find((r) => r.id === savedBenchmarkLhrId) ?? null,
    [benchmarkLHR, savedBenchmarkLhrId],
  );

  // ─── filteredMHR ───────────────────────────────────────────────────────
  // Priority: 1) user's own mhr_records (location+group exact match)
  //           2) user's own mhr_records (location only)
  //           3) mhr_benchmark_rates DB table — location+group
  //           4) mhr_benchmark_rates DB table — location only / all benchmark
  //           5) ALL user's own mhr_records cross-location (dropdown is
  //              never empty when the user has records for a different factory)
  // Never falls back to hardcoded constants.
  const filteredMHR = useMemo<MhrLikeRow[]>(() => {
    if (isNonMachineOperation) return [];
    const base: MhrLikeRow[] = mhrData?.records ?? [];
    const bm: MhrLikeRow[] = benchmarkMHR;
    const locLower = location.toLowerCase();

    const byLoc = (arr: MhrLikeRow[]) =>
      !location ? arr : arr.filter((r) => r.location.toLowerCase() === locLower);
    const byGroup = (arr: MhrLikeRow[]) => {
      if (!operationFullySelected) return arr;
      if (selectedMachineClass) return arr.filter((r) => r.machineClass === selectedMachineClass);
      return [];
    };
    const byBmGroup = byGroup;

    const withSaved = (list: MhrLikeRow[]) => {
      let result = list;
      if (savedMHRRecord && !result.some((r) => r.id === savedMHRRecord.id)) {
        const savedClass = savedMHRRecord.machineClass;
        if (!savedClass || !selectedMachineClass || savedClass === selectedMachineClass) {
          result = [savedMHRRecord, ...result];
        }
      }
      if (savedBenchmarkMHRRecord && !result.some((r) => r.id === savedBenchmarkMHRRecord.id)) {
        result = [savedBenchmarkMHRRecord, ...result];
      }
      return result;
    };

    const dbLoc = byLoc(base);
    const dbMatch = byGroup(dbLoc);
    const dbResult = dbMatch.length > 0 ? dbMatch : (dbLoc.length > 0 && !operationFullySelected ? dbLoc : null);
    if (dbResult && dbResult.length > 0) return withSaved(dbResult);

    const bmLoc = byLoc(bm);
    const bmMatch = byBmGroup(bmLoc);
    const bmResult = bmMatch.length > 0 ? bmMatch : (bmLoc.length > 0 && !operationFullySelected ? bmLoc : []);
    if (bmResult.length > 0) return withSaved(bmResult);

    // Deliberately NO cross-location fallback — an applied/selected location
    // must always be respected, never silently widened to every country's
    // machines (the exact "China labour rate auto-selected for an
    // India-costed part" defect this replaced).
    return withSaved([]);
  }, [mhrData, benchmarkMHR, location, selectedMachineClass, savedMHRRecord, savedBenchmarkMHRRecord, operationFullySelected, isNonMachineOperation]);

  // Each lhr_records/lhr_benchmark_rates row's `description` carries
  // operation-keyword text — match the selected operation's words against it
  // so e.g. a laser-cutting op prefers the Skilled band over whatever record
  // happens to sort first.
  const operationKeywords = useMemo(() => {
    if (!selectedOperation) return [] as string[];
    return selectedOperation.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w.length >= 4);
  }, [selectedOperation]);

  const rankByOperationMatch = useCallback((arr: LhrLikeRow[]): LhrLikeRow[] => {
    // "Highly Skilled" is reserved for supervisory/production management/
    // engineering (migration 374) — structurally never valid for a
    // process-cost line. Pushed to the back unconditionally (not just when a
    // keyword mismatches), so an operation whose name shares no keyword with
    // any description doesn't fall through to "Highly Skilled" by sort order.
    const isHighlySkilled = (r: LhrLikeRow) => r.labourType.trim().toLowerCase() === 'highly skilled';
    const eligible = arr.filter((r) => !isHighlySkilled(r));
    const excluded = arr.filter(isHighlySkilled);
    const base = eligible.length > 0 ? eligible : arr;

    let ranked = base;
    if (operationKeywords.length > 0) {
      const matched: LhrLikeRow[] = [];
      const rest: LhrLikeRow[] = [];
      for (const r of base) {
        const desc = ('description' in r ? r.description : '').toLowerCase();
        (operationKeywords.some((w) => desc.includes(w)) ? matched : rest).push(r);
      }
      ranked = matched.length > 0 ? [...matched, ...rest] : base;
    }

    return eligible.length > 0 ? [...ranked, ...excluded] : ranked;
  }, [operationKeywords]);

  // ─── Machine-specific labour rate (root-caused 2026-08-30) ─────────────
  // The specific selected machine's own real usd_lhr_total takes precedence
  // over a generic (location, process_group) wage-grade lookup. Synthesized
  // as a real LHR-shaped pseudo-record so it slots into the exact same
  // dropdown/priority/rendering/effective-rate logic below.
  const machineSpecificLHR = useMemo<MachineSpecificLhrRow | null>(() => {
    const mhr = filteredMHR.find((r) => r.id === selectedMHRId);
    // usdLhrTotal/laborRateSource only exist on a real mhr_records row, never
    // on a synthetic MHRBenchmarkEntry — a real `in` narrow, not a cast.
    if (!mhr || !('usdLhrTotal' in mhr)) return null;
    const rate = mhr.usdLhrTotal;
    if (typeof rate !== 'number' || !(rate > 0)) return null;
    const laborRateSource = mhr.laborRateSource;
    return {
      id: `mhr-lhr-${mhr.id}`,
      labourType: mhr.machineName ? `Machine-Specific Rate (${mhr.machineName})` : 'Machine-Specific Rate',
      processGroup: selectedGroup || null,
      lhr: rate,
      lhrUsdEffective: rate,
      location: mhr.location,
      isBenchmark: laborRateSource === 'benchmark' || laborRateSource === 'lhr_benchmark',
    };
  }, [filteredMHR, selectedMHRId, selectedGroup]);

  // ─── filteredLHR ───────────────────────────────────────────────────────
  // Priority: 0) the selected machine's own real rate (machineSpecificLHR)
  //           1) user's own lsr_records (location+group exact match)
  //           2) user's own lsr_records (location only)
  //           3) lhr_benchmark_rates DB table — location+group
  //           4) lhr_benchmark_rates DB table — location only / all benchmark
  //           5) ALL user's own lsr_records cross-location
  const filteredLHR = useMemo<LhrLikeRow[]>(() => {
    const withMachineSpecific = (rows: LhrLikeRow[]) =>
      machineSpecificLHR
        ? [machineSpecificLHR, ...rows.filter((r) => String(r.id) !== machineSpecificLHR.id)]
        : rows;
    const records: LhrLikeRow[] = lhrData?.records ?? [];
    const bm: LhrLikeRow[] = benchmarkLHR ?? [];
    const locLower = location.toLowerCase();

    const byLoc = (arr: LhrLikeRow[]) =>
      !location ? arr : arr.filter((r) => r.location.toLowerCase() === locLower);
    // Match against the machine class's REAL billing skill-group
    // (selectedLhrGroup), not the coarse hierarchy domain name — genuinely
    // differ for cmm/deburring/turret_punch/CNC/injection_molding.
    const byGroup = (arr: LhrLikeRow[]) => {
      if (!selectedGroup) return arr;
      return arr.filter((r) =>
        r.processGroup === selectedLhrGroup ||
        (selectedMachineClass && r.processGroup === selectedMachineClass),
      );
    };

    const withSaved = (base: LhrLikeRow[]) => {
      let result = base;
      if (savedLHRRecord && !result.some((r) => String(r.id) === String(savedLHRRecord.id))) {
        const savedPg = savedLHRRecord.processGroup;
        const groupMatch = !savedPg || !selectedGroup ||
          savedPg === selectedLhrGroup ||
          (selectedMachineClass && savedPg === selectedMachineClass);
        if (groupMatch) result = [savedLHRRecord, ...result];
      }
      if (savedBenchmarkLHRRecord && !result.some((r) => String(r.id) === savedBenchmarkLHRRecord.id)) {
        result = [savedBenchmarkLHRRecord, ...result];
      }
      return withMachineSpecific(rankByOperationMatch(result));
    };

    const userLoc = byLoc(records);
    const userMatch = byGroup(userLoc);
    const userResult = userMatch.length > 0 ? userMatch : (userLoc.length > 0 && !operationFullySelected ? userLoc : null);
    if (userResult && userResult.length > 0) return withSaved(userResult);

    const bmLoc = byLoc(bm);
    const bmMatch = byGroup(bmLoc);
    const bmResult = bmMatch.length > 0 ? bmMatch : (bmLoc.length > 0 && !operationFullySelected ? bmLoc : []);
    if (bmResult.length > 0) return withSaved(bmResult);

    // Deliberately NO cross-location fallback — same rationale as filteredMHR.
    return withSaved([]);
  }, [lhrData, benchmarkLHR, location, selectedGroup, selectedLhrGroup, selectedMachineClass, savedLHRRecord, savedBenchmarkLHRRecord, operationFullySelected, machineSpecificLHR, rankByOperationMatch]);

  const selectedMHR = useMemo(
    () => filteredMHR.find((r) => r.id === selectedMHRId),
    [filteredMHR, selectedMHRId],
  );
  const selectedLHR = useMemo(
    () => filteredLHR.find((r) => String(r.id) === selectedLHRId),
    [filteredLHR, selectedLHRId],
  );

  // Effective rates: dropdown selection → live-fetched saved record → manual
  // input → stale editData snapshot as last resort. Non-machine operations
  // never have a real machine cost, so no stale saved/manual value surfaces.
  const effectiveMachineRate = isNonMachineOperation
    ? 0
    : selectedMHR
      ? resolveRateUsd(selectedMHR)
      : savedMHRRecord
        ? resolveRateUsd(savedMHRRecord)
        : (typeof manualMhrRate === 'number' && manualMhrRate > 0 ? manualMhrRate : (Number(editDataMachineRate) || 0));

  // Deliberately `||`, not `??`: a real but literal $0 rate must still fall
  // through to the next tier (same "0 means unresolved, not free" convention
  // as the manualMhrRate/manualLhrRate > 0 checks below) — `??` would treat
  // an explicit 0 as a valid resolved rate instead.
  /* eslint-disable @typescript-eslint/prefer-nullish-coalescing */
  const effectiveLaborRate = selectedLHR
    ? (selectedLHR.lhrUsdEffective || selectedLHR.lhr || 0)
    : savedLHRRecord
      ? (savedLHRRecord.lhrUsdEffective || savedLHRRecord.lhr || 0)
      : (typeof manualLhrRate === 'number' && manualLhrRate > 0 ? manualLhrRate : (Number(editDataLaborRate) || 0));
  /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */

  return {
    selectedMapping,
    selectedMachineClass,
    selectedLhrGroup,
    isNonMachineOperation,
    filteredMHR,
    filteredLHR,
    selectedMHR,
    selectedLHR,
    effectiveMachineRate,
    effectiveLaborRate,
    isLoadingMHR,
    isLoadingLHR,
  };
}
