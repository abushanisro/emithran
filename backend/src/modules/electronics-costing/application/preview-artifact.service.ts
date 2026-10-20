import { Injectable, Logger } from '@nestjs/common';

import {
  EXPECTED_RENDER_VERSION,
  PREVIEW_ARTIFACT_VERSION,
  artifactState,
  decodeArtifact,
  decodeThumbnail,
  encodeArtifact,
  previewInputsKey,
  toServed,
  type EnginePreview,
  type PreviewArtifact,
  type ThumbnailArtifact,
  type ServedPreview,
} from './preview-artifact';
import { EcadEngineClient, ExtractionUnavailable } from '../infrastructure/ecad/ecad-engine.client';
import { ElectronicsFileStore, previewArtifactPathFor, thumbnailArtifactPathFor } from '../infrastructure/storage/electronics-file-store';

import type { StoredUploadFile, UploadRow } from '../infrastructure/repositories/electronics.repository';

// The board preview is drawn once, when the set is parsed, and kept next to the files it came from. Reading it later does not need
// the extraction engine: the engine is only called when nothing fresh is stored (an upload from before this existed, a changed
// lookup, a newer renderer) and, if it is down then, the last stored drawing is served marked stale instead of nothing.
// It lives in the same private, organization-prefixed bucket as the customer files, so it is no wider a copy than they are.
interface Drawn {
  artifact: PreviewArtifact;
  thumbnail: ThumbnailArtifact;
}

@Injectable()
export class PreviewArtifactService {
  private readonly logger = new Logger(PreviewArtifactService.name);
  // Concurrent requests for the same drawing share one render instead of each calling the engine.
  private readonly rendering = new Map<string, Promise<Drawn>>();

  constructor(
    private readonly store: ElectronicsFileStore,
    private readonly engine: EcadEngineClient,
  ) {}

  /** The Gerber and drill files draw the layers; a Pick Place file (csv or workbook) positions the parts on them. */
  static drawnFiles(upload: UploadRow): StoredUploadFile[] {
    return upload.files.filter((f) => f.role !== undefined || f.format === 'xlsx' || f.format === 'text');
  }

  /** The stored preview when it is fresh; otherwise a new render, stored; the stale drawing only if the engine cannot be reached. */
  async get(upload: UploadRow, organizationId: string): Promise<ServedPreview> {
    const key = previewInputsKey(PreviewArtifactService.drawnFiles(upload).map((f) => f.storagePath));
    const stored = await this.read(upload.id, organizationId);
    if (stored && artifactState(stored, key) === 'fresh') return toServed(stored, false);
    try {
      return toServed((await this.render(upload, organizationId, key)).artifact, false);
    } catch (error) {
      if (stored && error instanceof ExtractionUnavailable) {
        this.logger.warn(`engine unavailable; serving the stored preview of upload ${upload.id} marked stale`);
        return toServed(stored, true);
      }
      throw error;
    }
  }

  /** The list-card picture (SVG text), or null when none can be shown. Stored with the preview and served from storage the same way. */
  async getThumbnail(upload: UploadRow, organizationId: string): Promise<string | null> {
    const key = previewInputsKey(PreviewArtifactService.drawnFiles(upload).map((f) => f.storagePath));
    const stored = await this.readThumbnail(upload.id, organizationId);
    if (stored && artifactState(stored, key) === 'fresh') return stored.svg;
    try {
      return (await this.render(upload, organizationId, key)).thumbnail.svg;
    } catch (error) {
      if (stored && error instanceof ExtractionUnavailable) return stored.svg;
      throw error;
    }
  }

  /** Called after a successful parse so the first drawing is kept. Never throws: a missing drawing must not fail the parse. */
  async keep(upload: UploadRow, organizationId: string): Promise<void> {
    try {
      if (upload.kind !== 'board' || !upload.files.some((f) => f.role)) return;
      await this.get(upload, organizationId);
    } catch (error) {
      this.logger.warn(`could not store the preview of upload ${upload.id}: ${error instanceof Error ? error.message : 'error'}`);
    }
  }

  private async read(uploadId: string, organizationId: string): Promise<PreviewArtifact | null> {
    try {
      const bytes = await this.store.getIfExists(previewArtifactPathFor(organizationId, uploadId), organizationId);
      return bytes ? await decodeArtifact(bytes) : null;
    } catch (error) {
      // A storage read failure must not hide a drawing the engine can still produce.
      this.logger.warn(`could not read the stored preview of upload ${uploadId}: ${error instanceof Error ? error.message : 'error'}`);
      return null;
    }
  }

  private async readThumbnail(uploadId: string, organizationId: string): Promise<ThumbnailArtifact | null> {
    try {
      const bytes = await this.store.getIfExists(thumbnailArtifactPathFor(organizationId, uploadId), organizationId);
      return bytes ? await decodeThumbnail(bytes) : null;
    } catch (error) {
      this.logger.warn(`could not read the stored thumbnail of upload ${uploadId}: ${error instanceof Error ? error.message : 'error'}`);
      return null;
    }
  }

  private render(upload: UploadRow, organizationId: string, inputsKey: string): Promise<Drawn> {
    const flightKey = `${upload.id}:${inputsKey}`;
    const running = this.rendering.get(flightKey);
    if (running) return running;
    const run = this.drawAndStore(upload, organizationId, inputsKey).finally(() => this.rendering.delete(flightKey));
    this.rendering.set(flightKey, run);
    return run;
  }

  private async drawAndStore(upload: UploadRow, organizationId: string, inputsKey: string): Promise<Drawn> {
    const files = await Promise.all(
      PreviewArtifactService.drawnFiles(upload).map(async (f) => ({
        name: f.name,
        bytes: await this.store.get(f.storagePath, organizationId),
        role: f.role ?? null,
      })),
    );
    const drawn = (await this.engine.renderBoard(files)) as EnginePreview;
    const { renderVersion, thumbnail, ...preview } = drawn;
    const artifact: PreviewArtifact = {
      artifactVersion: PREVIEW_ARTIFACT_VERSION,
      inputsKey,
      renderVersion: renderVersion ?? EXPECTED_RENDER_VERSION,
      renderedAt: new Date().toISOString(),
      preview,
    };
    const thumb: ThumbnailArtifact = {
      artifactVersion: PREVIEW_ARTIFACT_VERSION,
      inputsKey,
      renderVersion: artifact.renderVersion,
      renderedAt: artifact.renderedAt,
      svg: thumbnail ?? null,
    };
    // The drawing was produced; failing to keep it only means the next view draws it again.
    for (const [path, value] of [
      [previewArtifactPathFor(organizationId, upload.id), artifact],
      [thumbnailArtifactPathFor(organizationId, upload.id), thumb],
    ] as const) {
      try {
        await this.store.putArtifact(path, await encodeArtifact(value));
      } catch (error) {
        this.logger.warn(`could not store a preview artifact of upload ${upload.id}: ${error instanceof Error ? error.message : 'error'}`);
      }
    }
    return { artifact, thumbnail: thumb };
  }
}
