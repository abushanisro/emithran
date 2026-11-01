import { BadRequestException } from '@nestjs/common';

import { inspectZip, type ZipLimits } from './inspect-zip';

/**
 * What an uploaded spreadsheet may expand to. ExcelJS (through JSZip) inflates every part of an .xlsx fully in memory and checks
 * sizes only afterwards, so the workbook is measured from its central directory first. A real price list or rate sheet is a few
 * MB of XML.
 */
export const XLSX_LIMITS: ZipLimits = {
  maxEntries: 5000,
  maxEntryBytes: 50 * 1024 * 1024,
  maxTotalBytes: 50 * 1024 * 1024,
  maxRatio: 100,
};

/** The multipart limit for a spreadsheet upload (compressed bytes), enforced by multer while it reads the request. */
export const MAX_XLSX_UPLOAD_BYTES = 20 * 1024 * 1024;

/** Throws 400 unless the buffer is an .xlsx (zip) within XLSX_LIMITS. Call before every workbook.xlsx.load on uploaded bytes. */
export function assertXlsxWithinLimits(buf: Buffer): void {
  const verdict = inspectZip(buf, XLSX_LIMITS);
  if (!verdict.ok) {
    throw new BadRequestException(
      verdict.code === 'archive_unreadable' ? 'The file is not a readable .xlsx workbook.' : `The workbook was refused: ${verdict.message}`,
    );
  }
}
