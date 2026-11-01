// Unpacks an uploaded .zip into the files it holds, so a pack is read exactly like the folder it was made from. Pure: bytes in, entries out; Node's zlib does the inflating, nothing touches the filesystem.
//
// The whole archive is measured before any entry is inflated (inspect-zip.ts): no entry may exceed the caller's per-file limit,
// the total may not exceed the caller's budget, and entries may not share or overlap their data. Each entry is then inflated
// capped at its stated size, which must be honoured exactly; unsafe paths and encrypted entries are refused. Folders are kept as
// paths. Entries that are not design files of the pack (a nested archive, macOS resource forks) are listed as skipped, never
// silently dropped.
import { inflateRawSync } from 'zlib';

import { inspectZip } from './inspect-zip';

/** What the caller allows: each domain has its own file sizes (a Gerber is small, a CAD part is not). */
export interface ArchiveLimits {
  maxEntries: number;
  maxEntryBytes: number;
  maxTotalBytes: number;
}

export interface ArchiveEntry {
  /** File name (last path segment). */
  name: string;
  /** '/'-separated path starting with the archive's own name, as a dropped folder would report it. */
  path: string;
  bytes: Buffer;
}

export type ExpandedArchive =
  | { ok: true; root: string; entries: ArchiveEntry[]; skipped: { path: string; reason: string }[] }
  | { ok: false; code: 'archive_unreadable' | 'archive_encrypted' | 'archive_entry_too_large' | 'archive_too_large' | 'archive_empty'; message: string };

/** The folder name a pack stands for: its file name without the extension, and without characters a path cannot hold. */
export function archiveRootName(fileName: string): string {
  const stem = fileName.replace(/\.zip$/i, '').replace(/[\\/]/g, ' ').trim();
  return stem.length > 0 ? stem : 'Design pack';
}

export function isArchiveName(fileName: string): boolean {
  return /\.zip$/i.test(fileName);
}

export function expandArchive(fileName: string, buf: Buffer, limits: ArchiveLimits): ExpandedArchive {
  const unreadable = (message: string): ExpandedArchive => ({ ok: false, code: 'archive_unreadable', message });
  const inspected = inspectZip(buf, limits);
  if (!inspected.ok) {
    if (inspected.code === 'archive_entry_too_large' || inspected.code === 'archive_too_large') {
      return { ok: false, code: inspected.code, message: inspected.message };
    }
    return unreadable(inspected.message);
  }

  const root = archiveRootName(fileName);
  const entries: ArchiveEntry[] = [];
  const skipped: { path: string; reason: string }[] = [];
  for (const entry of inspected.entries) {
    const { flags, method, size } = entry;
    // Bit 11 marks a UTF-8 name; older tools write the DOS code page, which inspectZip reads as latin1 rather than mangled.
    const inner = entry.name.split('\\').join('/').replace(/^\/+/, '');
    if (inner === '' || inner.endsWith('/')) continue; // a directory entry: folders come from the file paths
    const segments = inner.split('/');
    if (segments.some((s) => s === '' || s === '.' || s === '..')) return unreadable('Archive contains an unsafe file path.');
    const path = `${root}/${inner}`;
    const name = segments[segments.length - 1] ?? inner;
    if (segments[0] === '__MACOSX' || name.startsWith('._') || name === '.DS_Store' || name === 'Thumbs.db') {
      skipped.push({ path, reason: 'system metadata written by the archiving tool' });
      continue;
    }
    if (flags & 0x1) return { ok: false, code: 'archive_encrypted', message: `${inner} is encrypted; upload an unencrypted archive.` };
    if (isArchiveName(name)) {
      skipped.push({ path, reason: 'an archive inside the archive is not unpacked; upload it on its own' });
      continue;
    }

    const data = buf.subarray(entry.dataStart, entry.dataStart + entry.compressedSize);
    let bytes: Buffer;
    if (method === 0) {
      bytes = Buffer.from(data);
    } else if (method === 8) {
      try {
        bytes = inflateRawSync(data, { maxOutputLength: Math.max(size, 1) });
      } catch {
        return unreadable(`${inner}: could not be inflated.`);
      }
    } else {
      return unreadable(`${inner}: compression method ${method} is not supported (stored and deflate are).`);
    }
    if (bytes.length !== size) return unreadable(`${inner}: inflated size does not match the archive's directory.`);
    entries.push({ name, path, bytes });
  }
  if (entries.length === 0) return { ok: false, code: 'archive_empty', message: 'The archive holds no files.' };
  return { ok: true, root, entries, skipped };
}
