import { describe, expect, it } from 'vitest';

import { LABEL_HEIGHT_PX, separateLabels } from '@/lib/viewer/label-separation';

const rect = (l: { x: number; y: number; w: number }, o: { dx: number; dy: number }) => ({
  x: l.x + o.dx - l.w / 2, y: l.y + o.dy - LABEL_HEIGHT_PX / 2, w: l.w, h: LABEL_HEIGHT_PX,
});
const touch = (a: ReturnType<typeof rect>, b: ReturnType<typeof rect>) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('separateLabels', () => {
  it('leaves labels that do not collide where they are', () => {
    const out = separateLabels([{ x: 50, y: 50, w: 40, depth: 0 }, { x: 300, y: 200, w: 40, depth: 0.5 }]);
    expect(out).toEqual([{ dx: 0, dy: 0 }, { dx: 0, dy: 0 }]);
  });

  it('moves stacked labels apart so no two overlap, nearest label keeps its place', () => {
    const labels = Array.from({ length: 12 }, (_, i) => ({ x: 200 + (i % 3), y: 200 + (i % 2), w: 44, depth: i / 12 }));
    const out = separateLabels(labels);
    expect(out[0]).toEqual({ dx: 0, dy: 0 });
    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) {
        expect(touch(rect(labels[i]!, out[i]!), rect(labels[j]!, out[j]!))).toBe(false);
      }
    }
  });

  it('is deterministic', () => {
    const labels = Array.from({ length: 8 }, (_, i) => ({ x: 100, y: 100, w: 44, depth: i }));
    expect(separateLabels(labels)).toEqual(separateLabels(labels));
  });

  it('handles none', () => {
    expect(separateLabels([])).toEqual([]);
  });
});
