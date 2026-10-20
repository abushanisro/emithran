import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { SupabaseService } from '../../../../common/supabase/supabase.service';

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

// The bucket is private with no end-user policy: only the service role reaches it, and the
// path always starts with the caller organization id. Files are never logged.
@Injectable()
export class ElectronicsFileStore {
  constructor(private readonly supabase: SupabaseService) {}

  private bucket() {
    return this.supabase
      .getPrivilegedClient('storage: electronics design-file bucket, private, organization-prefixed object keys')
      .storage.from(ELECTRONICS_BUCKET);
  }

  async put(path: string, bytes: Buffer): Promise<void> {
    const { error } = await this.bucket().upload(path, bytes, { contentType: 'application/octet-stream', upsert: false });
    if (error) throw new Error(`electronics-uploads put failed: ${error.message}`);
  }

  /** Writes a derived artifact, replacing the previous one at the same key. */
  async putArtifact(path: string, bytes: Buffer): Promise<void> {
    const { error } = await this.bucket().upload(path, bytes, { contentType: 'application/gzip', upsert: true });
    if (error) throw new Error(`electronics-uploads put artifact failed: ${error.message}`);
  }

  /** The stored bytes, or null when nothing is stored at the key. Any other failure throws. */
  async getIfExists(path: string, organizationId: string): Promise<Buffer | null> {
    if (!path.startsWith(`${organizationId}/`)) throw new Error('Object key is outside the organization prefix');
    const { data, error } = await this.bucket().download(path);
    if (error) {
      const status = String((error as { statusCode?: string | number }).statusCode ?? '');
      if (status === '404' || /not found/i.test(error.message)) return null;
      throw new Error(`electronics-uploads get failed: ${error.message}`);
    }
    return data ? Buffer.from(await data.arrayBuffer()) : null;
  }

  async remove(paths: string[]): Promise<void> {
    if (paths.length === 0) return;
    const { error } = await this.bucket().remove(paths);
    if (error) throw new Error(`electronics-uploads remove failed: ${error.message}`);
  }

  async get(path: string, organizationId: string): Promise<Buffer> {
    if (!path.startsWith(`${organizationId}/`)) throw new Error('Object key is outside the organization prefix');
    const { data, error } = await this.bucket().download(path);
    if (error || !data) throw new Error(`electronics-uploads get failed: ${error?.message ?? 'no data'}`);
    return Buffer.from(await data.arrayBuffer());
  }
}
