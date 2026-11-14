import type { CalculationTraceStep } from '../../dto/cost-breakdown.dto';

/** One phase of an operation's cycle: a time-valued part of its Cycle Time (or Total Time) formula, in seconds. */
export interface CyclePhase {
  name: string;
  seconds: number;
}

const CYCLE_FIELDS = ['Cycle Time', 'Total Time'];
const TO_SECONDS: Record<string, number> = { s: 1, sec: 1, min: 60 };

/**
 * The phases of a line's cycle, from the trace its stored calculator produced: the fields its Cycle Time (or Total Time) formula names, in formula
 * order, that are times with a value. A factor (no time unit) is not a phase. Null when the line has no such cycle, or fewer than two phases (a single
 * part is the cycle itself). Nothing is computed here: the values are the calculator's.
 */
export function cyclePhasesOf(trace: readonly CalculationTraceStep[] | null | undefined): CyclePhase[] | null {
  if (!trace?.length) return null;
  const cycle = [...trace].reverse().find((s) => s.kind === 'calculated' && CYCLE_FIELDS.includes(s.fieldName));
  if (!cycle?.formula) return null;
  const byName = new Map(trace.map((s) => [s.fieldName, s]));
  const names = [...new Set([...cycle.formula.matchAll(/\{([^}]+)\}/g)].map((m) => m[1] ?? ''))];
  const phases = names.flatMap((name): CyclePhase[] => {
    const step = byName.get(name);
    const factor = TO_SECONDS[(step?.unit ?? '').trim().toLowerCase()];
    const value = typeof step?.value === 'number' ? step.value : Number(step?.value);
    return step && factor && step.value != null && Number.isFinite(value) ? [{ name, seconds: value * factor }] : [];
  });
  return phases.length >= 2 ? phases : null;
}
