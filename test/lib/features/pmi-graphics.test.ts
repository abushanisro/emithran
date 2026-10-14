import { describe, expect, it } from 'vitest';

import { buildPmiGraphicsBuffers, type PmiGraphic } from '@/lib/features/pmi-graphics';
import fixture from '../../fixtures/dimension-annotations/pmi-graphics-width.json';

// The drawn Width callouts of RMP-00015: 'Width2@Width1(15)' reads 15.00 +/-0.25, 'Width4@Width3(15.04)' reads 15.04 +/-0.1
// (read off the rendered glyphs); their tolerance exists only as these polylines and glyph triangles.
const graphics = fixture.graphics as unknown as PmiGraphic[];
const origin = fixture.graphics_origin as [number, number, number];

describe('PMI graphics buffers', () => {
  const b = buildPmiGraphicsBuffers(graphics, origin)!;

  it('turns every polyline into segments and every triangle into three vertices', () => {
    const segments = graphics.reduce((n, g) => n + g.curves.reduce((m, c) => m + Math.max(0, c.length - 1), 0), 0);
    expect(b.lines.length).toBe(segments * 6);
    expect(b.triangles.length).toBe(graphics.reduce((n, g) => n + g.triangles.length, 0));
    expect(b.triangles.length % 9).toBe(0);
    expect(b.callouts).toBe(2);
  });

  it('shifts every point by the model origin, into the mesh frame', () => {
    const first = graphics[0]!.curves[0]![0]!;
    expect(b.lines[0]).toBeCloseTo(first[0] - origin[0], 4);
    expect(b.lines[1]).toBeCloseTo(first[1] - origin[1], 4);
    expect(b.lines[2]).toBeCloseTo(first[2] - origin[2], 4);
    const t0 = graphics[0]!.triangles;
    expect(b.triangles[0]).toBeCloseTo(t0[0]! - origin[0], 4);
  });

  it('draws the callouts where they were authored: the 15 mm width spans 15 mm on the slot', () => {
    // the dimension's two arrowheads sit at y = +/-7.5 about the slot centre: the polylines span the width
    const ys: number[] = [];
    for (let i = 1; i < b.lines.length; i += 3) ys.push(b.lines[i]!);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThanOrEqual(15);
  });

  it('draws nothing without graphics or without the frame to draw them in', () => {
    expect(buildPmiGraphicsBuffers(undefined, origin)).toBeNull();
    expect(buildPmiGraphicsBuffers([], origin)).toBeNull();
    expect(buildPmiGraphicsBuffers(graphics, undefined)).toBeNull();
  });

  it('ignores an incomplete trailing triangle instead of drawing a broken one', () => {
    const partial: PmiGraphic = { callout: 'x', curves: [], triangles: [0, 0, 0, 1, 0, 0, 1, 1, 0, 5, 5, 5] };
    expect(buildPmiGraphicsBuffers([partial], [0, 0, 0])!.triangles.length).toBe(9);
  });
});
