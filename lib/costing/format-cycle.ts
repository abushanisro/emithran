/**
 * A cycle time as text: minutes from a minute up, seconds below, and two significant figures under a tenth of a second, so a casting's
 * few-millisecond share of a furnace reads "0.0041 s", not "0.0 s". Nothing resolved reads "0.0 min".
 */
export function formatCycleMin(min: number | null | undefined): string {
  if (min == null || !Number.isFinite(min) || min <= 0) return '0.0 min';
  if (min >= 1) return `${min.toFixed(1)} min`;
  const sec = min * 60;
  if (sec >= 0.1) return `${sec.toFixed(1)} s`;
  return `${sec.toLocaleString('en-US', { maximumSignificantDigits: 2, useGrouping: false })} s`;
}

/** A cycle in seconds for the route table: whole seconds from a second up, two significant figures below (0.2 s, 0.0041 s), never "0 sec". */
export function formatCycleSec(sec: number): string {
  if (sec >= 1 || sec <= 0) return `${sec.toFixed(0)} sec`;
  return `${sec.toLocaleString('en-US', { maximumSignificantDigits: 2, useGrouping: false })} sec`;
}
