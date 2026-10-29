// Unpacks an uploaded .zip into the files it holds, so a pack is read exactly like the folder it was made from. Pure: bytes in, entries out; Node's zlib does the inflating, nothing touches the filesystem.
//
// Every entry is checked as it is inflated: its stated sizes must be honoured, no entry may exceed the caller's per-file
// limit, the total may not exceed the caller's budget, unsafe paths are refused, and encrypted entries are refused. Folders are kept as paths. Entries that are not design files of
// the pack (a nested archive, macOS resource forks) are listed as skipped, never silently dropped.
import { inflateRawSync } from 'zlib';

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

const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const EOCD = 0x06054b50;

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
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) return unreadable('Archive has no central directory.');
  const count = buf.readUInt16LE(eocd + 10);
  const dirOffset = buf.readUInt32LE(eocd + 16);
  if (count > limits.maxEntries) return unreadable(`Archive holds more than ${limits.maxEntries} entries.`);

  const root = archiveRootName(fileName);
  const entries: ArchiveEntry[] = [];
  const skipped: { path: string; reason: string }[] = [];
  let total = 0;
  let cursor = dirOffset;
  for (let n = 0; n < count; n++) {
    if (cursor + 46 > buf.length || buf.readUInt32LE(cursor) !== CENTRAL) return unreadable('Archive central directory is corrupt.');
    const flags = buf.readUInt16LE(cursor + 8);
    const method = buf.readUInt16LE(cursor + 10);
    const compressedSize = buf.readUInt32LE(cursor + 20);
    const size = buf.readUInt32LE(cursor + 24);
    const nameLen = buf.readUInt16LE(cursor + 28);
    const extraLen = buf.readUInt16LE(cursor + 30);
    const commentLen = buf.readUInt16LE(cursor + 32);
    const localOffset = buf.readUInt32LE(cursor + 42);
    // Bit 11 marks a UTF-8 name; older tools write the DOS code page, which is read as latin1 rather than mangled.
    const rawName = buf.subarray(cursor + 46, cursor + 46 + nameLen).toString(flags & 0x800 ? 'utf8' : 'latin1');
    cursor += 46 + nameLen + extraLen + commentLen;

    const inner = rawName.split('\\').join('/').replace(/^\/+/, '');
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
    if (size > limits.maxEntryBytes) {
      return { ok: false, code: 'archive_entry_too_large', message: `${inner} expands to more than ${limits.maxEntryBytes / (1024 * 1024)} MB.` };
    }
    total += size;
    if (total > limits.maxTotalBytes) return { ok: false, code: 'archive_too_large', message: 'Archive expands beyond the allowed size.' };
    if (isArchiveName(name)) {
      skipped.push({ path, reason: 'an archive inside the archive is not unpacked; upload it on its own' });
      continue;
    }

    if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== LOCAL) return unreadable(`${inner}: local header is missing.`);
    const dataStart = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
    if (dataStart + compressedSize > buf.length) return unreadable(`${inner}: data is truncated.`);
    const data = buf.subarray(dataStart, dataStart + compressedSize);
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
