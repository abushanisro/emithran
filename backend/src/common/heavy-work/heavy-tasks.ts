import * as ExcelJS from 'exceljs';

import { workbookToData, type SheetData } from './workbook-data';
import { expandArchive, type ArchiveLimits, type ExpandedArchive } from '../archive/expand-archive';
import { verifyZip, type ZipLimits } from '../archive/inspect-zip';

// The parses that run inside a heavy-work worker (heavy-work.worker.ts), kept apart from the thread plumbing so they can be tested
// directly. Every input is untrusted upload bytes.

export type HeavyTask =
  | { kind: 'workbook'; bytes: Uint8Array; limits: ZipLimits }
  | { kind: 'archive'; name: string; bytes: Uint8Array; limits: ArchiveLimits };

export type HeavyResult =
  | { kind: 'workbook'; ok: true; sheets: SheetData[] }
  | { kind: 'workbook'; ok: false; message: string }
  | { kind: 'archive'; archive: ExpandedArchive };

const asBuffer = (bytes: Uint8Array) => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);

/** The workbook's values, or why it was refused. ExcelJS only ever sees bytes that passed both layers of the archive gate. */
async function readWorkbook(bytes: Buffer, limits: ZipLimits): Promise<HeavyResult> {
  const verdict = verifyZip(bytes, limits);
  if (!verdict.ok) {
    const message = verdict.code === 'archive_unreadable' ? 'The file is not a readable .xlsx workbook.' : `The workbook was refused: ${verdict.message}`;
    return { kind: 'workbook', ok: false, message };
  }
  const workbook = new ExcelJS.Workbook();
  try {
    // ExcelJS types its input as its own ArrayBuffer-like Buffer; JSZip underneath reads a Node Buffer as is, without a copy.
    await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
  } catch {
    return { kind: 'workbook', ok: false, message: 'The file is not a readable .xlsx workbook.' };
  }
  return { kind: 'workbook', ok: true, sheets: workbookToData(workbook) };
}

export async function runHeavyTask(task: HeavyTask): Promise<HeavyResult> {
  if (task.kind === 'workbook') return readWorkbook(asBuffer(task.bytes), task.limits);
  return { kind: 'archive', archive: expandArchive(task.name, asBuffer(task.bytes), task.limits) };
}

/**
 * The buffers a result can hand to the API thread without copying. Each must own its whole ArrayBuffer, so an entry that is a view
 * into a shared one (Node's small-buffer pool, a slice of zlib's output) is first copied into its own.
 */
export function transferables(result: HeavyResult): ArrayBuffer[] {
  if (result.kind !== 'archive' || !result.archive.ok) return [];
  return result.archive.entries.map((entry) => {
    const { bytes } = entry;
    // new Uint8Array(view) copies into a fresh ArrayBuffer of exactly that length (Buffer.from would take a pooled one).
    if (bytes.byteOffset !== 0 || bytes.byteLength !== bytes.buffer.byteLength) entry.bytes = Buffer.from(new Uint8Array(bytes).buffer);
    return entry.bytes.buffer as ArrayBuffer;
  });
}
