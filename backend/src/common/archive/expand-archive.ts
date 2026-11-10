// Unpacks an uploaded .zip into the files it holds, so a pack is read exactly like the folder it was made from. Pure: bytes in,
// entries out; nothing touches the filesystem.
//
// Both layers of the shared gate apply (inspect-zip.ts): the whole archive is measured before any entry is inflated (entry count,
// per-file limit, total budget, overlapping data, unsafe paths, encryption), then each entry is inflated capped at its stated size,
// which must be honoured exactly. Folders are kept as paths. Entries that are not design files of the pack (a nested archive, macOS
// resource forks) are listed as skipped, never silently dropped.
import { inflateEntry, inspectZip, type ZipLimits } from './inspect-zip';

/** What the caller allows: each domain has its own file sizes (a Gerber is small, a CAD part is not). */
export type ArchiveLimits = ZipLimits;

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

/** Why an archive inside the archive is left packed; callers that need to tell the user about it match on this. */
export const NESTED_ARCHIVE_REASON = 'an archive inside the archive is not unpacked: unpack it and zip the files it holds';

/**
 * Archive formats people pack design files in. Only a .zip is ever unpacked, and only one level: any of these inside it (a .rar
 * zipped for e-mail, a zip of zips) is listed as skipped by name, so the user is told what to unpack instead of "no files found".
 * The Rust core keeps the same list (core/crates/archive/src/lib.rs `PACKED_EXTENSIONS`).
 */
const PACKED_ARCHIVE = /\.(zip|rar|7z|tar|gz|tgz|bz2|tbz|tbz2|xz|txz|zst|cab|arj|lzh)$/i;

/** The folder name a pack stands for: its file name without the extension, and without characters a path cannot hold. */
export function archiveRootName(fileName: string): string {
  const stem = fileName.replace(/\.zip$/i, '').replace(/[\\/]/g, ' ').trim();
  return stem.length > 0 ? stem : 'Design pack';
}

/** A .zip: the one archive format that is unpacked. */
export function isZipName(fileName: string): boolean {
  return /\.zip$/i.test(fileName);
}

/** Any archive format (.zip, .rar, .7z, .tar.gz...), whether or not it can be unpacked. */
export function isPackedArchiveName(fileName: string): boolean {
  return PACKED_ARCHIVE.test(fileName);
}

/**
 * Why an archive yields no file. When it holds only archives (a .rar zipped for e-mail, a zip of zips) it is not empty: the files are
 * one level down, so the message names what to unpack. The Rust core says the same words (core/crates/archive/src/lib.rs).
 */
export function emptyArchiveMessage(nestedPaths: readonly string[]): string {
  if (nestedPaths.length === 0) return 'The archive holds no files.';
  const names = nestedPaths.slice(0, 3).map((p) => p.slice(p.lastIndexOf('/') + 1)).join(', ') + (nestedPaths.length > 3 ? ` and ${nestedPaths.length - 3} more` : '');
  const one = nestedPaths.length === 1;
  return `The archive holds only ${names}, and an archive inside an archive is not unpacked. Unpack ${one ? 'it' : 'them'} and zip the files ${one ? 'it holds' : 'they hold'}.`;
}

export function expandArchive(fileName: string, buf: Buffer, limits: ArchiveLimits): ExpandedArchive {
  const unreadable = (message: string): ExpandedArchive => ({ ok: false, code: 'archive_unreadable', message });
  const inspected = inspectZip(buf, limits);
  if (!inspected.ok) {
    const { code, message } = inspected;
    if (code === 'archive_entry_too_large' || code === 'archive_too_large' || code === 'archive_encrypted') return { ok: false, code, message };
    return unreadable(message);
  }

  const root = archiveRootName(fileName);
  const entries: ArchiveEntry[] = [];
  const skipped: { path: string; reason: string }[] = [];
  for (const entry of inspected.entries) {
    if (entry.name.endsWith('/')) continue; // a directory entry: folders come from the file paths
    const segments = entry.name.split('/');
    const path = `${root}/${entry.name}`;
    const name = segments[segments.length - 1];
    if (segments[0] === '__MACOSX' || name.startsWith('._') || name === '.DS_Store' || name === 'Thumbs.db') {
      skipped.push({ path, reason: 'system metadata written by the archiving tool' });
      continue;
    }
    if (isPackedArchiveName(name)) {
      skipped.push({ path, reason: NESTED_ARCHIVE_REASON });
      continue;
    }
    const inflated = inflateEntry(buf, entry);
    if (!inflated.ok) return unreadable(inflated.message);
    entries.push({ name, path, bytes: inflated.bytes });
  }
  if (entries.length === 0) {
    const nested = skipped.filter((s) => s.reason === NESTED_ARCHIVE_REASON).map((s) => s.path);
    return { ok: false, code: 'archive_empty', message: emptyArchiveMessage(nested) };
  }
  return { ok: true, root, entries, skipped };
}
