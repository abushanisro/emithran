import { describe, expect, it } from 'vitest';

import type { BoardPreview } from '@/lib/api/electronics';
import { layerLabel, stackLayers, toDataUri } from '@/lib/electronics/preview-view';

// Layer names follow the board-file role table (the engine returns them in file order); the svg bodies are
// irrelevant to ordering, so they are minimal.
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 273.7 170.7"></svg>';
const layer = (name: string, role: string) => ({ name, role, color: '#fff', opacity: 0.8, svg });
const preview: BoardPreview = {
  bounds: { minXMm: 0, minYMm: 0, widthMm: 273.7, heightMm: 170.7 },
  layers: [
    layer('board.GBL', 'copper_bottom'),
    layer('board.GBO', 'silkscreen_bottom'),
    layer('board.GBS', 'soldermask_bottom'),
    layer('board.GKO', 'board_outline'),
    layer('board.GTL', 'copper_top'),
    layer('board.GTO', 'silkscreen_top'),
    layer('board.GTP', 'paste_top'),
    layer('board.GTS', 'soldermask_top'),
    layer('board.TXT', 'drill_data'),
  ],
  components: [],
  componentsError: null,
  holes: [],
};

describe('stackLayers', () => {
  it('draws copper under paste and silkscreen, and the outline and holes on top', () => {
    const roles = stackLayers(preview).map((l) => l.role);
    expect(roles.indexOf('copper_bottom')).toBeLessThan(roles.indexOf('copper_top'));
    expect(roles.indexOf('copper_top')).toBeLessThan(roles.indexOf('paste_top'));
    expect(roles.indexOf('paste_top')).toBeLessThan(roles.indexOf('silkscreen_top'));
    expect(roles.indexOf('silkscreen_top')).toBeLessThan(roles.indexOf('board_outline'));
    expect(roles[roles.length - 1]).toBe('drill_data');
  });

  it('keeps every layer, and puts a role it does not know on top instead of dropping it', () => {
    const extra: BoardPreview = { ...preview, layers: [...preview.layers, layer('x.new', 'brand_new_role')] };
    const stacked = stackLayers(extra);
    expect(stacked).toHaveLength(10);
    expect(stacked[stacked.length - 1].role).toBe('brand_new_role');
  });

  it('is stable: the same input gives the same order, and the input is not changed', () => {
    const before = preview.layers.map((l) => l.name);
    expect(stackLayers(preview).map((l) => l.name)).toEqual(stackLayers(preview).map((l) => l.name));
    expect(preview.layers.map((l) => l.name)).toEqual(before);
  });

  it('labels roles for people and gives each layer an image source', () => {
    const top = stackLayers(preview).find((l) => l.role === 'copper_top');
    expect(top?.label).toBe('copper top');
    expect(top?.src.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true);
  });
});

describe('toDataUri / layerLabel', () => {
  it('encodes the svg so it can be shown as an image and decodes back to the same text', () => {
    const uri = toDataUri(svg);
    expect(decodeURIComponent(uri.split(',')[1])).toBe(svg);
    expect(uri).not.toContain('<');
  });

  it('turns a role into words', () => {
    expect(layerLabel('soldermask_bottom')).toBe('soldermask bottom');
  });

});
