import { describe, expect, it } from 'vitest';

import { modelViewerMessage } from '@/lib/cad-uploads/model-viewer-message';

describe('modelViewerMessage', () => {
  it('a part with no file is a missing model', () => {
    expect(modelViewerMessage({ itemType: 'child_part', file3dPath: undefined }, null)).toBe('No 3D model attached');
  });

  it('an assembly or sub-assembly with no file is a grouping, not a failed upload', () => {
    for (const itemType of ['assembly', 'sub_assembly'] as const) {
      expect(modelViewerMessage({ itemType, file3dPath: undefined }, null)).toMatch(/^This is an assembly: it has no 3D model of its own/);
    }
  });

  it('an item with a file is loading, or shows why its link failed', () => {
    expect(modelViewerMessage({ itemType: 'child_part', file3dPath: 'a/b.stl' }, null)).toBe('Loading 3D model…');
    expect(modelViewerMessage({ itemType: 'assembly', file3dPath: 'a/b.stl' }, 'Could not sign the link')).toBe('Could not sign the link');
  });
});
