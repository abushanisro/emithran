import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { OBJECT_STORE, type ObjectStore } from '../../../../common/storage/object-store';

export const ELECTRONICS_BUCKET = 'electronics-uploads';

export function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

// Object keys are <organizationId>/<uploadId>/<n>-<sha256>. The name the customer chose is
// kept in the upload row, never in the key, so it cannot traverse or collide.
export function storagePathFor(organizationId: string, uploadId: string, index: number, sha256: string): string {
  return `${organizationId}/${uploadId}/${index}-${sha256}`;
}

// One derived preview per upload, at a fixed key (overwritten when stale) so deleting an upload removes it by name.
export function previewArtifactPathFor(organizationId: string, uploadId: string): string {
  return `${organizationId}/${uploadId}/preview.json.gz`;
}

// The small list-card picture of the same board, kept the same way.
export function thumbnailArtifactPathFor(organizationId: string, uploadId: string): string {
  return `${organizationId}/${uploadId}/thumbnail.json.gz`;
}

// The bucket is private with no end-user policy: only the backend reaches it, and the
// path always starts with the caller organization id. Files are never logged.
@Injectable()
export class ElectronicsFileStore {
  constructor(@Inject(OBJECT_STORE) private readonly objects: ObjectStore) {}

  async put(path: string, bytes: Buffer): Promise<void> {
    await this.objects.put(ELECTRONICS_BUCKET, path, bytes, { contentType: 'application/octet-stream', upsert: false });
  }

  /** Writes a derived artifact, replacing the previous one at the same key. */
  async putArtifact(path: string, bytes: Buffer): Promise<void> {
    await this.objects.put(ELECTRONICS_BUCKET, path, bytes, { contentType: 'application/gzip', upsert: true });
  }

  /** The stored bytes, or null when nothing is stored at the key. Any other failure throws. */
  async getIfExists(path: string, organizationId: string): Promise<Buffer | null> {
    if (!path.startsWith(`${organizationId}/`)) throw new Error('Object key is outside the organization prefix');
    return this.objects.get(ELECTRONICS_BUCKET, path);
  }

  async remove(paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    await this.objects.remove(ELECTRONICS_BUCKET, paths);
  }

  async get(path: string, organizationId: string): Promise<Buffer> {
    const bytes = await this.getIfExists(path, organizationId);
    if (!bytes) throw new Error('electronics-uploads get failed: not found');
    return bytes;
  }
}
