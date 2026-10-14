// Screen-space placement of the dimension labels (pure, no three.js).

export const LABEL_HEIGHT_PX = 18;
export const LABEL_CHAR_PX = 7.5;
export const LABEL_PAD_PX = 14;
const NUDGE_STEP_PX = 16;
const NUDGE_RINGS = 6;

interface Rect { x: number; y: number; w: number; h: number }
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w + 2 && b.x < a.x + a.w + 2 && a.y < b.y + b.h + 2 && b.y < a.y + a.h + 2;

/**
 * Pixel offsets that keep screen labels off each other: each label, nearest
 * first, keeps its place or takes the first free spot on rings of 8 directions
 * around it. Deterministic, O(n^2) in the number of labels (tens), run only
 * when the camera has stopped.
 */
export function separateLabels(
  labels: ReadonlyArray<{ x: number; y: number; w: number; depth: number }>,
): Array<{ dx: number; dy: number }> {
  const order = labels.map((_, i) => i).sort((a, b) => labels[a]!.depth - labels[b]!.depth);
  const placed: Rect[] = [];
  const out = labels.map(() => ({ dx: 0, dy: 0 }));
  for (const i of order) {
    const l = labels[i]!;
    const rect = (dx: number, dy: number): Rect => ({ x: l.x + dx - l.w / 2, y: l.y + dy - LABEL_HEIGHT_PX / 2, w: l.w, h: LABEL_HEIGHT_PX });
    let chosen = { dx: 0, dy: 0 };
    search: for (let ring = 0; ring <= NUDGE_RINGS; ring++) {
      const steps = ring === 0 ? 1 : 8;
      for (let k = 0; k < steps; k++) {
        const angle = (k / steps) * Math.PI * 2;
        const dx = ring === 0 ? 0 : Math.round(Math.cos(angle) * ring * NUDGE_STEP_PX);
        const dy = ring === 0 ? 0 : Math.round(Math.sin(angle) * ring * NUDGE_STEP_PX);
        if (!placed.some((r) => overlaps(r, rect(dx, dy)))) { chosen = { dx, dy }; break search; }
      }
    }
    out[i] = chosen;
    placed.push(rect(chosen.dx, chosen.dy));
  }
  return out;
}
