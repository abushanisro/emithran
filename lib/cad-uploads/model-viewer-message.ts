import type { BOMItem } from '@/lib/api/hooks/useBOMItems';

/**
 * What the 3D viewer says when it has no model to draw. A CAD upload gives every part its own model and an assembly none (the assembly is
 * the grouping, not a solid), so an assembly without a file is expected and must not read as a failed upload.
 */
export function modelViewerMessage(item: Pick<BOMItem, 'itemType' | 'file3dPath'>, urlError: string | null): string {
  if (!item.file3dPath) {
    return item.itemType === 'child_part'
      ? 'No 3D model attached'
      : 'This is an assembly: it has no 3D model of its own. Open one of its parts from the BOM to see its model.';
  }
  return urlError ?? 'Loading 3D model…';
}
