// Whether an engineer's draw direction still applies to the item's file. It was chosen on the geometry of the file the item had then. While the item's file is
// the same, it applies. When the file has been replaced it applies only if the new file is shown to be the same geometry; otherwise it is held back (the part is
// analysed automatically) and the engineer is asked to confirm or remove it. It is never silently kept on geometry it was not chosen for. Pure.
import { compareGeometry, type GeometryFingerprint } from './geometry-fingerprint';

export type OverrideBinding =
  /** Applies: the same file, or a replaced file shown to be the same geometry. */
  | { state: 'in_force'; basis: 'same_file' | 'same_geometry'; notice: null }
  /** Held back for now: the new file has not been analysed, so it cannot be compared yet. */
  | { state: 'pending'; notice: string }
  /** Held back: the geometry changed, or there is nothing to compare it with. The engineer confirms (sets it again) or removes it. */
  | { state: 'needs_confirmation'; notice: string };

export function overrideBinding(input: {
  /** The item's file when the override was set, and the geometry then (null: not recorded). */
  override: { sourcePath: string | null; geometry: GeometryFingerprint | null };
  /** The item's file now (null: it has none). */
  currentPath: string | null;
  /** The geometry of the item's file now, from its automatic analysis (null: not analysed yet). */
  current: GeometryFingerprint | null;
}): OverrideBinding {
  const { override, currentPath, current } = input;
  if (currentPath == null || override.sourcePath === currentPath) return { state: 'in_force', basis: 'same_file', notice: null };
  if (override.geometry == null) {
    return {
      state: 'needs_confirmation',
      notice: 'The 3D file was replaced, and the geometry this draw direction was chosen on was not recorded, so it cannot be checked against the new file. Confirm it for the new file or remove it.',
    };
  }
  if (current == null) {
    return { state: 'pending', notice: 'The 3D file was replaced: the draw direction applies again if the new file is the same geometry, which is checked when its analysis is done.' };
  }
  const { same, differences } = compareGeometry(override.geometry, current);
  return same
    ? { state: 'in_force', basis: 'same_geometry', notice: null }
    : { state: 'needs_confirmation', notice: `The 3D file was replaced by a different geometry (${differences.join('; ')}): the draw direction is not applied. Confirm it for the new file or remove it.` };
}
