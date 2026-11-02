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
    if (isArchiveName(name)) {
      skipped.push({ path, reason: 'an archive inside the archive is not unpacked; upload it on its own' });
      continue;
    }
    const inflated = inflateEntry(buf, entry);
    if (!inflated.ok) return unreadable(inflated.message);
    entries.push({ name, path, bytes: inflated.bytes });
  }
  if (entries.length === 0) return { ok: false, code: 'archive_empty', message: 'The archive holds no files.' };
  return { ok: true, root, entries, skipped };
}
