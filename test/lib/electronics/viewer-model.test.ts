import { describe, expect, it } from 'vitest';

import type { SceneComponent } from '@/lib/api/electronics';
import {
  centerOn,
  defaultLayerVisible,
  layerSide,
  distanceMm,
  fitView,
  footprintCounts,
  fromScene,
  MIN_VIEW_WIDTH_MM,
  nearestComponent,
  panBy,
  parseViewerUrl,
  searchComponents,
  serializeViewerUrl,
  toScene,
  zoomAt,
} from '@/lib/electronics/viewer-model';

// A frame and a few parts as the Pick Place file states them (millimetres, y up); the values are only geometry for the helpers.

const bounds = { minXMm: 0, minYMm: 0, widthMm: 139.8, heightMm: 55.6 };
const part = (designator: string, comment: string, footprint: string, xMm: number, yMm: number, side: 'top' | 'bottom' = 'top'): SceneComponent => ({
  designator,
  comment,
  footprint,
  side,
  xMm,
  yMm,
  rotationDeg: 0,
});
const parts = [
  part('D1_1', 'LED', 'LED-5MM', 3.75, 31.6),
  part('D2_1', 'LED', 'LED-5MM', 8.65, 31.6),
  part('R1', '', 'RES-1206', 20, 10, 'bottom'),
];

describe('scene coordinates', () => {
  it('puts the board origin at the bottom-left and the scene origin at the top-left', () => {
    expect(toScene(bounds, { xMm: 0, yMm: 55.6 })).toEqual({ x: 0, y: 0 });
    expect(toScene(bounds, { xMm: 3.75, yMm: 31.6 })).toEqual({ x: 3.75, y: 24 });
  });

  it('round-trips, including a frame that does not start at the origin', () => {
    const shifted = { minXMm: -10, minYMm: 5, widthMm: 100, heightMm: 40 };
    const p = { xMm: 12.5, yMm: 20.25 };
    expect(fromScene(shifted, toScene(shifted, p))).toEqual(p);
  });
});

describe('view', () => {
  it('fits the whole frame with a margin and keeps the container aspect', () => {
    const view = fitView(bounds, 2);
    expect(view.w / view.h).toBeCloseTo(2);
    expect(view.x).toBeLessThan(0);
    expect(view.x + view.w).toBeGreaterThan(bounds.widthMm);
    expect(view.y).toBeLessThan(0);
    expect(view.y + view.h).toBeGreaterThan(bounds.heightMm);
  });

  it('fits a tall container by width and a wide container by height', () => {
    const wide = fitView(bounds, 10);
    expect(wide.h).toBeGreaterThan(bounds.heightMm);
    const tall = fitView(bounds, 0.2);
    expect(tall.w).toBeGreaterThan(bounds.widthMm);
  });

  it('keeps the point under the cursor fixed when zooming', () => {
    const fitted = fitView(bounds, 2);
    const about = { x: 30, y: 20 };
    const zoomed = zoomAt(fitted, about, 0.5, fitted);
    expect(zoomed.w).toBeCloseTo(fitted.w * 0.5);
    // the cursor's relative position inside the view is unchanged
    expect((about.x - zoomed.x) / zoomed.w).toBeCloseTo((about.x - fitted.x) / fitted.w);
    expect((about.y - zoomed.y) / zoomed.h).toBeCloseTo((about.y - fitted.y) / fitted.h);
  });

  it('stops zooming in at the minimum width and out at 1.5x the fitted view', () => {
    const fitted = fitView(bounds, 2);
    expect(zoomAt(fitted, { x: 0, y: 0 }, 0.0001, fitted).w).toBe(MIN_VIEW_WIDTH_MM);
    expect(zoomAt(fitted, { x: 0, y: 0 }, 1000, fitted).w).toBeCloseTo(fitted.w * 1.5);
  });

  it('pans by a scene distance and centres on a point', () => {
    expect(panBy({ x: 0, y: 0, w: 10, h: 5 }, 2, -1)).toEqual({ x: -2, y: 1, w: 10, h: 5 });
    expect(centerOn({ x: 10, y: 10 }, 20, 2)).toEqual({ x: 0, y: 5, w: 20, h: 10 });
  });
});

describe('measure and hit-test', () => {
  it('measures straight-line millimetres between two board points', () => {
    expect(distanceMm({ xMm: 3.75, yMm: 31.6 }, { xMm: 8.65, yMm: 31.6 })).toBeCloseTo(4.9);
    expect(distanceMm({ xMm: 0, yMm: 0 }, { xMm: 3, yMm: 4 })).toBe(5);
  });

  it('picks the nearest part within the radius, and none outside it', () => {
    expect(nearestComponent(parts, { xMm: 4, yMm: 31.6 }, 1)?.designator).toBe('D1_1');
    expect(nearestComponent(parts, { xMm: 6, yMm: 31.6 }, 3)?.designator).toBe('D1_1');
    expect(nearestComponent(parts, { xMm: 100, yMm: 50 }, 3)).toBeNull();
  });
});

describe('component search', () => {
  it('matches designator, value and footprint, case-insensitively, by plain text', () => {
    expect(searchComponents(parts, 'd1_1').map((c) => c.designator)).toEqual(['D1_1']);
    expect(searchComponents(parts, 'led').map((c) => c.designator)).toEqual(['D1_1', 'D2_1']);
    expect(searchComponents(parts, 'res-1206').map((c) => c.designator)).toEqual(['R1']);
  });

  it('needs every word, treats pattern characters literally, and an empty query lists all', () => {
    expect(searchComponents(parts, 'led led-5mm').map((c) => c.designator)).toEqual(['D1_1', 'D2_1']);
    expect(searchComponents(parts, 'led res')).toEqual([]);
    expect(searchComponents(parts, 'D.*')).toEqual([]);
    expect(searchComponents(parts, 'LED-5MM')).toHaveLength(2);
    expect(searchComponents(parts, '  ')).toEqual(parts);
  });

  it('counts footprints, most frequent first', () => {
    expect(footprintCounts(parts)).toEqual([
      { footprint: 'LED-5MM', count: 2 },
      { footprint: 'RES-1206', count: 1 },
    ]);
  });
});

describe('review link state', () => {
  it('reads the selected part and side, defaulting to the top with nothing selected', () => {
    expect(parseViewerUrl(new URLSearchParams('c=D1_1&side=bottom'))).toEqual({ component: 'D1_1', side: 'bottom' });
    expect(parseViewerUrl(new URLSearchParams('side=weird'))).toEqual({ component: null, side: 'top' });
  });

  it('writes only what differs from the default and keeps unrelated parameters', () => {
    const existing = new URLSearchParams('revision=r2');
    expect(serializeViewerUrl({ component: 'D1_1', side: 'bottom' }, existing).toString()).toBe('revision=r2&c=D1_1&side=bottom');
    expect(serializeViewerUrl({ component: null, side: 'top' }, new URLSearchParams('revision=r2&c=D1_1&side=bottom')).toString()).toBe('revision=r2');
  });
});

describe('layer visibility by side', () => {
  it('names the side of a layer from its role', () => {
    expect(layerSide('copper_top')).toBe('top');
    expect(layerSide('silkscreen_bottom')).toBe('bottom');
    expect(layerSide('board_outline')).toBeNull();
    expect(layerSide('drill_data')).toBeNull();
  });

  it('shows the viewed side and the layers of both sides by default', () => {
    expect(defaultLayerVisible('copper_top', 'top')).toBe(true);
    expect(defaultLayerVisible('copper_top', 'bottom')).toBe(false);
    expect(defaultLayerVisible('paste_bottom', 'bottom')).toBe(true);
    expect(defaultLayerVisible('board_outline', 'bottom')).toBe(true);
  });
});
