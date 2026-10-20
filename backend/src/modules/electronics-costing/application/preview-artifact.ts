import { createHash } from 'node:crypto';
import { gunzip, gzip } from 'node:zlib';
import { promisify } from 'node:util';

import { PACKAGE_CLASS_LOOKUP } from '../domain/lookups/package-class-lookup.generated';
import { PLACEMENT_LAYERS } from '../domain/lookups/placement-layers.generated';

import type { BoardPreview } from '../infrastructure/ecad/ecad-engine.client';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

// The renderVersion the platform expects from the engine. Bump it together with RENDER_VERSION in ecad-engine/extraction/render.py
// when the preview's shape or drawing changes: a stored preview with an older value is stale and is re-rendered.
export const EXPECTED_RENDER_VERSION = '2';
// The shape of the stored envelope itself.
export const PREVIEW_ARTIFACT_VERSION = 1;

// What changes the drawing besides the engine: the placement-layer and footprint lookups are sent with every render.
export const LOOKUPS_DIGEST = createHash('sha256').update(JSON.stringify({ PLACEMENT_LAYERS, PACKAGE_CLASS_LOOKUP })).digest('hex');

export type EnginePreview = BoardPreview & { renderVersion?: string; thumbnail?: string | null };

export interface PreviewArtifact {
  artifactVersion: typeof PREVIEW_ARTIFACT_VERSION;
  /** What the preview was drawn from: the stored files (their keys carry the content hash) and the lookups sent with them. */
  inputsKey: string;
  renderVersion: string;
  renderedAt: string;
  preview: BoardPreview;
}

/** The list-card picture. svg is null when the engine judged it too large to be a thumbnail (the card then shows an icon). */
export interface ThumbnailArtifact {
  artifactVersion: typeof PREVIEW_ARTIFACT_VERSION;
  inputsKey: string;
  renderVersion: string;
  renderedAt: string;
  svg: string | null;
}

export type PreviewMeta = { renderedAt: string; stale: boolean };
export type ServedPreview = BoardPreview & { meta: PreviewMeta };

/** Same files and same lookups give the same key. File order does not matter. */
export function previewInputsKey(storagePaths: readonly string[], lookupsDigest: string = LOOKUPS_DIGEST): string {
  return createHash('sha256')
    .update(JSON.stringify({ files: [...storagePaths].sort(), lookups: lookupsDigest }))
    .digest('hex');
}

/** fresh: serve as is. stale: the inputs or the engine's renderer changed since it was drawn. */
export function artifactState(artifact: Pick<PreviewArtifact, 'inputsKey' | 'renderVersion'>, inputsKey: string): 'fresh' | 'stale' {
  return artifact.inputsKey === inputsKey && artifact.renderVersion === EXPECTED_RENDER_VERSION ? 'fresh' : 'stale';
}

export async function encodeArtifact(artifact: PreviewArtifact | ThumbnailArtifact): Promise<Buffer> {
  return gzipAsync(Buffer.from(JSON.stringify(artifact), 'utf8'));
}

/** null when the bytes are not a readable artifact of this envelope version (it is then simply re-rendered). */
export async function decodeArtifact(bytes: Buffer): Promise<PreviewArtifact | null> {
  try {
    const parsed = JSON.parse((await gunzipAsync(bytes)).toString('utf8')) as Partial<PreviewArtifact>;
    if (parsed.artifactVersion !== PREVIEW_ARTIFACT_VERSION || typeof parsed.inputsKey !== 'string' || !parsed.preview) return null;
    return parsed as PreviewArtifact;
  } catch {
    return null;
  }
}

export function toServed(artifact: PreviewArtifact, stale: boolean): ServedPreview {
  return { ...artifact.preview, meta: { renderedAt: artifact.renderedAt, stale } };
}

export async function decodeThumbnail(bytes: Buffer): Promise<ThumbnailArtifact | null> {
  try {
    const parsed = JSON.parse((await gunzipAsync(bytes)).toString('utf8')) as Partial<ThumbnailArtifact>;
    if (parsed.artifactVersion !== PREVIEW_ARTIFACT_VERSION || typeof parsed.inputsKey !== 'string' || parsed.svg === undefined) return null;
    return parsed as ThumbnailArtifact;
  } catch {
    return null;
  }
}
