import { inspectZip, type ZipLimits, type ZipRejection } from '../../../common/archive/inspect-zip';
import { RESOURCE_LIMITS } from '../../../common/resource-limits';
import { MAX_ARCHIVE_ENTRIES, MAX_ARCHIVE_RATIO, MAX_UPLOAD_BYTES, validateUpload, type UploadVerdict } from '../domain/uploads/validate-upload';

/**
 * What a design pack (.zip) or a BOM workbook (.xlsx, also a zip) may hold: the electronics per-file limit for each entry, and the
 * one archive budget every zip upload shares (ARCHIVE_MAX_EXPANDED_MB, common/resource-limits.ts).
 */
export const ELECTRONICS_ARCHIVE_LIMITS: ZipLimits = {
  maxEntries: MAX_ARCHIVE_ENTRIES,
  maxEntryBytes: MAX_UPLOAD_BYTES,
  maxTotalBytes: RESOURCE_LIMITS.archiveMaxExpandedBytes,
  maxRatio: MAX_ARCHIVE_RATIO,
};

export type DesignFileVerdict = UploadVerdict | { ok: false; code: ZipRejection; message: string };

/**
 * A customer design file judged by its content (domain validateUpload), and a zip-shaped one also measured by the shared archive
 * gate (common/archive/inspect-zip.ts) from its central directory, before anything stores or extracts it.
 */
export function validateDesignFile(fileName: string, bytes: Buffer, limits: ZipLimits = ELECTRONICS_ARCHIVE_LIMITS): DesignFileVerdict {
  const verdict = validateUpload(fileName, bytes);
  if (!verdict.ok || (verdict.format !== 'zip' && verdict.format !== 'xlsx')) return verdict;
  const inspected = inspectZip(bytes, limits);
  return inspected.ok ? verdict : inspected;
}
