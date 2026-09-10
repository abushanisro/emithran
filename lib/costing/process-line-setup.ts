/**
 * The setup a process line was actually costed with, ready to persist onto a
 * `process_cost_records` row.
 *
 * Root cause this replaces (traced 2026-09-06): two call sites reverse-derived
 * setup minutes from the line's AMORTISED setup cost —
 *
 *     setupTimeMin = (setupCost x batchSize x 60) / (machineRate + labourRate)
 *
 * — inverting the engine's own `setupCost = (mhrMin + dlrMin * manning) *
 * setupTimeMin`. The algebra is right; the input is not. `setupCost` crosses the
 * API rounded to 2 decimal places, and it has already been divided by the batch,
 * so at any real production batch the rounding error is multiplied straight back
 * up by that same batch:
 *
 *   | batch   | true setup | setupCost sent | reverse-derived |
 *   |---------|------------|----------------|-----------------|
 *   | 1       | 4.8 min    | 5.82           | 4.8   (exact)   |
 *   | 250     | 4.8 min    | 0.02           | 4.12  (-14%)    |
 *   | 100,000 | 4.8 min    | 0.00           | 0.0   (all)     |
 *
 * A real 4.8-minute laser setup and a real 5.0-minute PEM setup were persisted
 * as 0, which is what put "Setup (0.0 min / 100000) $0.00" on every row of the
 * Cost Guide. The engine already reports the exact, un-amortised figure as
 * `setupTimeMin` on the very same line object, so nothing needs deriving.
 *
 * The backend's own apply-route writer (`writeProcessLinesAsRecords`) has read
 * `line.setupTimeMin` / `line.operators` directly since the machine-spec work;
 * this brings the frontend's auto-fill path onto the same contract.
 */

/** Only the fields of a process line this resolver reads. */
export interface ProcessLineSetupSource {
  /** Exact un-amortised setup minutes the engine charged. Optional: not every producer sets it. */
  setupTimeMin?: number | undefined;
  /** Real machine crew size from mhr_records, carried on the selected candidate. */
  operators?: number | null | undefined;
  /** Amortised setup cost — used ONLY for the lossy fallback below. */
  setupCost?: number | undefined;
  hourlyRate?: number | undefined;
  labourRate?: number | null | undefined;
}

export type SetupTimeSource =
  /** The engine's exact `setupTimeMin`. */
  | 'line'
  /** Reverse-derived from a rounded amortised cost — lossy, see module docs. */
  | 'derived'
  /** Neither available; the line genuinely reports no setup. */
  | 'absent';

export interface ResolvedLineSetup {
  /** Minutes to persist. Full precision — round only when displaying. */
  setupTimeMin: number;
  /** Crew size to persist. */
  setupManning: number;
  setupTimeSource: SetupTimeSource;
}

function finite(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Resolves the setup to persist for one process line.
 *
 * `batchSize` is needed only by the fallback branch, and must be the batch the
 * line was AMORTISED over — the same one the engine divided by. Passing any
 * other value silently rescales the derived minutes.
 */
export function resolveLineSetup(
  line: ProcessLineSetupSource,
  batchSize: number,
): ResolvedLineSetup {
  const setupManning = Math.max(finite(line.operators) ?? 1, 1);

  // Exact value from the engine — always preferred, including a real 0.
  const exact = finite(line.setupTimeMin);
  if (exact !== null && exact >= 0) {
    return { setupTimeMin: exact, setupManning, setupTimeSource: 'line' };
  }

  // Fallback for a producer that does not report setupTimeMin yet. Lossy by
  // construction (see module docs) — kept only so such a line degrades to the
  // previous behaviour instead of persisting nothing, never as the normal path.
  const setupCost = finite(line.setupCost) ?? 0;
  const combinedRate = (finite(line.hourlyRate) ?? 0) + (finite(line.labourRate) ?? 0);
  const batch = Math.max(finite(batchSize) ?? 1, 1);
  if (setupCost > 0 && combinedRate > 0) {
    return {
      setupTimeMin: (setupCost * batch * 60) / combinedRate,
      setupManning,
      setupTimeSource: 'derived',
    };
  }

  return { setupTimeMin: 0, setupManning, setupTimeSource: 'absent' };
}

/** Rounds for display/persistence into a NUMERIC column, at the last moment only. */
export function roundSetupMinutes(setupTimeMin: number): number {
  return Math.round(setupTimeMin * 100) / 100;
}
