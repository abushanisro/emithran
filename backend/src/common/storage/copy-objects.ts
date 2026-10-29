import { createHash } from 'node:crypto';

import type { ObjectStore } from './object-store';

export interface CopyReport {
  /** Keys written (or, in a dry run, keys that would be written). */
  copied: string[];
  /** Keys already at the destination with identical bytes. */
  skipped: string[];
  /** Keys that could not be copied, with the reason. Never empty-handed: a copy with failures is not a finished migration. */
  failed: { key: string; reason: string }[];
}

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

/**
 * Copies objects between two ObjectStores and PROVES each copy: the destination is read back and its hash must equal the source's.
 * Safe to repeat (identical objects are skipped) and never deletes anything. Without `apply` it only reports what it would do.
 */
export async function copyObjects(options: {
  source: ObjectStore;
  destination: ObjectStore;
  bucket: string;
  keys: Iterable<string>;
  apply: boolean;
}): Promise<CopyReport> {
  const { source, destination, bucket, apply } = options;
  const report: CopyReport = { copied: [], skipped: [], failed: [] };
  for (const key of options.keys) {
    try {
      const bytes = await source.get(bucket, key);
      if (!bytes) {
        report.failed.push({ key, reason: 'missing at the source' });
        continue;
      }
      const wanted = sha256(bytes);
      const existing = await destination.get(bucket, key);
      if (existing && sha256(existing) === wanted) {
        report.skipped.push(key);
        continue;
      }
      if (apply) {
        await destination.put(bucket, key, bytes, { upsert: true });
        const back = await destination.get(bucket, key);
        if (!back || sha256(back) !== wanted) {
          report.failed.push({ key, reason: 'the copy read back differently' });
          continue;
        }
      }
      report.copied.push(key);
    } catch (error) {
      report.failed.push({ key, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  return report;
}
