// The engineer's mold-opening axis of a plastic part, and whether it still applies. Pure.
//
// It was chosen on the geometry of the 3D file the item had then. While the item's file is that file it applies. When the file has been replaced
// it is held back (the part is analysed automatically) and the engineer is asked to confirm it for the new file or remove it: unlike the casting
// override, plastic analysis does not keep a geometry fingerprint to prove a replaced file is the same part, so it is never carried over silently.

export type PullAxis = 'x' | 'y' | 'z';

export const PULL_AXES: readonly PullAxis[] = ['x', 'y', 'z'];

export const isPullAxis = (v: unknown): v is PullAxis => typeof v === 'string' && (PULL_AXES as readonly string[]).includes(v);

export interface PullDirectionView {
  /** The axis the analysis is run along: the engineer's when it applies, else null (the engine chooses). */
  axis: PullAxis | null;
  /** The engineer's axis even while it is held back; null when there is no override. */
  declaredAxis: PullAxis | null;
  reason: string | null;
  setBy: string | null;
  setAt: string | null;
  status: 'automatic' | 'in_force' | 'needs_confirmation';
  notice: string | null;
}

export const AUTOMATIC_PULL_DIRECTION: PullDirectionView = {
  axis: null, declaredAxis: null, reason: null, setBy: null, setAt: null, status: 'automatic', notice: null,
};

export function pullDirectionView(
  row: { axis: unknown; reason: string; set_by: string; set_at: string; source_path: string | null } | null,
  currentPath: string | null,
): PullDirectionView {
  // An axis this backend does not know is no override: the part stays automatic rather than being run with a guess.
  if (!row || !isPullAxis(row.axis)) return AUTOMATIC_PULL_DIRECTION;
  const base = { declaredAxis: row.axis, reason: row.reason, setBy: row.set_by, setAt: row.set_at };
  if (currentPath == null || row.source_path === currentPath) return { ...base, axis: row.axis, status: 'in_force', notice: null };
  return {
    ...base,
    axis: null,
    status: 'needs_confirmation',
    notice: 'The 3D file was replaced, so the pull direction chosen on the earlier file is not applied. Confirm it for the new file or remove it.',
  };
}
