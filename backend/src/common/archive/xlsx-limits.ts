import { RESOURCE_LIMITS, type XlsxLimits } from '../resource-limits';
import { verifyZip, type ZipInspection, type ZipLimits } from './inspect-zip';

/** The multipart limit for a spreadsheet upload (compressed bytes), enforced by multer while it reads the request. */
export const MAX_XLSX_UPLOAD_BYTES = 20 * 1024 * 1024;

/** The shared archive gate's limits for a workbook (configured in common/resource-limits.ts). */
export function xlsxZipLimits(limits: XlsxLimits = RESOURCE_LIMITS.xlsx): ZipLimits {
  return {
    maxEntries: limits.maxEntries,
    maxEntryBytes: limits.maxEntryBytes,
    maxTotalBytes: limits.maxExpandedBytes,
    maxRatio: limits.maxRatio,
    prefixLimits: [{ prefix: 'xl/media/', maxBytes: limits.maxMediaEntryBytes }],
  };
}

/**
 * Both layers of the archive gate over an uploaded workbook. ExcelJS (through JSZip) inflates every part of an .xlsx fully in
 * memory and checks sizes only afterwards, so it must only ever be handed bytes that passed this: the directory is within budget
 * and every part was inflated, capped, to exactly its declared size. Runs inside the heavy-work worker, before ExcelJS
 * (common/heavy-work/heavy-work.worker.ts).
 */
export function verifyXlsx(buf: Buffer, limits: ZipLimits = xlsxZipLimits()): ZipInspection {
  return verifyZip(buf, limits);
}
