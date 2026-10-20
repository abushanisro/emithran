/**
 * Pure helpers for the board preview: stacking order, labels and the data URI each layer is shown through.
 * Layers are shown as images, never injected as markup, so nothing inside a layer can run.
 */

import type { BoardPreview } from '@/lib/api/electronics';

// Bottom to top: the board outline and the copper under everything, paste and silkscreen over it, holes last.
const STACK_ORDER = ['soldermask_bottom', 'copper_bottom', 'silkscreen_bottom', 'soldermask_top', 'copper_top', 'paste_top', 'paste_bottom', 'silkscreen_top', 'board_outline', 'drill_data'];

export type PreviewLayer = BoardPreview['layers'][number] & { label: string; src: string };

export function layerLabel(role: string): string {
  return role.replace(/_/g, ' ');
}

export function toDataUri(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Layers in drawing order (first is drawn first, i.e. lowest). A role the order does not know goes on top, never dropped. */
export function stackLayers(preview: BoardPreview): PreviewLayer[] {
  const rank = (role: string) => {
    const i = STACK_ORDER.indexOf(role);
    return i === -1 ? STACK_ORDER.length : i;
  };
  return [...preview.layers]
    .sort((a, b) => rank(a.role) - rank(b.role) || a.name.localeCompare(b.name))
    .map((l) => ({ ...l, label: layerLabel(l.role), src: toDataUri(l.svg) }));
}

