// The one gate for every zip-shaped upload (CAD packs, electronics design packs, .xlsx workbooks), in two layers. Pure: bytes in,
// verdict out; nothing touches the filesystem.
//
// Layer 1, inspectZip: the archive is measured from its central directory before anything is inflated. Refused: too many entries,
// ZIP64, encrypted entries, compression methods other than stored and deflate, absolute or `..` paths, an entry or a total that is
// declared to expand past the caller's budget, and an implausible compression ratio. The declared sizes can only be trusted if each
// entry owns its own bytes, so every entry's local header and data must lie inside the buffer, before the central directory, and
// must not overlap or repeat another entry's: otherwise many directory records can point at one small deflate stream, and the
// archive would expand far past what its real size suggests while every declared number still looks reasonable.
//
// Layer 2, inflateEntry: an entry is inflated with its output capped at the size it declared (already within the caller's limits),
// and the output must match that size exactly. A size the archive lies about therefore costs at most the declared bytes before it is
// refused: the cap is the measured number, never something the inflater reads from the stream. verifyZip runs both layers over a
// whole archive for a consumer that inflates again itself (ExcelJS), so that consumer only ever sees bytes proven to be in budget.
import { inflateRawSync } from 'zlib';

export interface ZipLimits {
  maxEntries: number;
  /** Largest declared uncompressed size of one entry. */
  maxEntryBytes: number;
  /** Largest declared uncompressed size of all entries together. */
  maxTotalBytes: number;
  /** Largest total uncompressed/compressed ratio, checked once the archive expands past 1 MB. Omitted: not checked. */
  maxRatio?: number;
  /** Tighter per-entry limits for entries whose path starts with a prefix (an .xlsx's xl/media/ pictures). */
  prefixLimits?: readonly { prefix: string; maxBytes: number }[];
}

export interface ZipEntryInfo {
  /** The name as stored, with backslashes read as '/' (UTF-8 when flag bit 11 is set, otherwise latin1). */
  name: string;
  flags: number;
  method: number;
  compressedSize: number;
  size: number;
  /** Where the entry's compressed data starts in the buffer. */
  dataStart: number;
}

export type ZipRejection =
  | 'archive_unreadable'
  | 'archive_zip64'
  | 'archive_too_many_entries'
  | 'archive_entry_too_large'
  | 'archive_too_large'
  | 'archive_ratio'
  | 'archive_overlap'
  | 'archive_encrypted'
  | 'archive_unsafe_path'
  | 'archive_unsupported_method'
  | 'archive_size_mismatch';

export type ZipInspection = { ok: true; entries: ZipEntryInfo[] } | { ok: false; code: ZipRejection; message: string };

const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const EOCD = 0x06054b50;
const RATIO_FLOOR_BYTES = 1024 * 1024;
const STORED = 0;
const DEFLATE = 8;

const megabytes = (bytes: number) => Math.floor(bytes / (1024 * 1024));

/** A path that stays inside the folder it is unpacked into: relative, no drive letter, no empty, '.' or '..' segment. */
function safePath(name: string): boolean {
  if (name.startsWith('/') || /^[a-zA-Z]:/.test(name)) return false;
  const segments = (name.endsWith('/') ? name.slice(0, -1) : name).split('/');
  return segments.every((s) => s !== '' && s !== '.' && s !== '..');
}

export function inspectZip(buf: Buffer, limits: ZipLimits): ZipInspection {
  const reject = (code: ZipRejection, message: string): ZipInspection => ({ ok: false, code, message });
  const unreadable = (message: string) => reject('archive_unreadable', message);

  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) return unreadable('Archive has no central directory.');
  const count = buf.readUInt16LE(eocd + 10);
  const dirSize = buf.readUInt32LE(eocd + 12);
  const dirOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || dirSize === 0xffffffff || dirOffset === 0xffffffff) return reject('archive_zip64', 'ZIP64 archives are not accepted.');
  if (count > limits.maxEntries) return reject('archive_too_many_entries', `Archive holds more than ${limits.maxEntries} entries.`);
  const dirEnd = dirOffset + dirSize;
  if (dirEnd > eocd) return unreadable('Archive central directory is truncated.');

  const entries: ZipEntryInfo[] = [];
  const ranges: { start: number; end: number }[] = [];
  let total = 0;
  let compressedTotal = 0;
  let cursor = dirOffset;
  for (let n = 0; n < count; n++) {
    if (cursor + 46 > dirEnd || buf.readUInt32LE(cursor) !== CENTRAL) return unreadable('Archive central directory is corrupt.');
    const flags = buf.readUInt16LE(cursor + 8);
    const method = buf.readUInt16LE(cursor + 10);
    const compressedSize = buf.readUInt32LE(cursor + 20);
    const size = buf.readUInt32LE(cursor + 24);
    const nameLen = buf.readUInt16LE(cursor + 28);
    const extraLen = buf.readUInt16LE(cursor + 30);
    const commentLen = buf.readUInt16LE(cursor + 32);
    const localOffset = buf.readUInt32LE(cursor + 42);
    const recordEnd = cursor + 46 + nameLen + extraLen + commentLen;
    if (recordEnd > dirEnd) return unreadable('Archive central directory is corrupt.');
    const name = buf.subarray(cursor + 46, cursor + 46 + nameLen).toString(flags & 0x800 ? 'utf8' : 'latin1').split('\\').join('/');
    cursor = recordEnd;

    if (size === 0xffffffff || compressedSize === 0xffffffff || localOffset === 0xffffffff) {
      return reject('archive_zip64', 'ZIP64 archives are not accepted.');
    }
    if (!safePath(name)) return reject('archive_unsafe_path', 'Archive contains an unsafe file path.');
    if (flags & 0x1) return reject('archive_encrypted', `${name} is encrypted; upload an unencrypted archive.`);
    if (method !== STORED && method !== DEFLATE) {
      return reject('archive_unsupported_method', `${name}: compression method ${method} is not supported (stored and deflate are).`);
    }
    const prefixLimit = limits.prefixLimits?.find((p) => name.startsWith(p.prefix))?.maxBytes ?? Infinity;
    const entryLimit = Math.min(prefixLimit, limits.maxEntryBytes);
    if (size > entryLimit) return reject('archive_entry_too_large', `${name} expands to more than ${megabytes(entryLimit)} MB.`);
    total += size;
    if (total > limits.maxTotalBytes) return reject('archive_too_large', 'Archive expands beyond the allowed size.');

    // The entry's own bytes: local header, name, extra field and compressed data, all before the central directory.
    if (localOffset + 30 > dirOffset || buf.readUInt32LE(localOffset) !== LOCAL) return unreadable('An entry\'s local header is missing.');
    const dataStart = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
    const end = dataStart + compressedSize;
    if (end > dirOffset) return unreadable('An entry\'s data is truncated.');
    ranges.push({ start: localOffset, end });
    compressedTotal += compressedSize;
    entries.push({ name, flags, method, compressedSize, size, dataStart });
  }

  ranges.sort((a, b) => a.start - b.start);
  for (let i = 1; i < ranges.length; i++) {
    if (ranges[i].start < ranges[i - 1].end) return reject('archive_overlap', 'Archive entries share or overlap their data.');
  }
  // Follows from the ranges being disjoint and inside the buffer; kept as the explicit statement of the rule.
  if (compressedTotal > buf.length) return reject('archive_overlap', 'Archive entries share or overlap their data.');

  if (limits.maxRatio !== undefined && total > RATIO_FLOOR_BYTES && total / Math.max(compressedTotal, 1) > limits.maxRatio) {
    return reject('archive_ratio', 'Archive compression ratio is implausibly high.');
  }
  return { ok: true, entries };
}

export type InflatedEntry = { ok: true; bytes: Buffer } | { ok: false; message: string };

/** Layer 2: the bytes of one entry inspectZip accepted, never more than it declared, and refused unless exactly that many. */
export function inflateEntry(buf: Buffer, entry: ZipEntryInfo): InflatedEntry {
  const data = buf.subarray(entry.dataStart, entry.dataStart + entry.compressedSize);
  let bytes: Buffer;
  if (entry.method === STORED) {
    bytes = Buffer.from(data);
  } else {
    try {
      // maxOutputLength stops zlib as soon as the output would pass the declared size; at least 1 so an entry declared empty
      // that inflates to anything is caught by the size check below instead of being read in full.
      bytes = inflateRawSync(data, { maxOutputLength: Math.max(entry.size, 1) });
    } catch {
      return { ok: false, message: `${entry.name}: could not be inflated within its declared size.` };
    }
  }
  if (bytes.length !== entry.size) return { ok: false, message: `${entry.name}: inflated size does not match the archive's directory.` };
  return { ok: true, bytes };
}

/**
 * Both layers over the whole archive, keeping nothing: for a consumer that inflates the archive again itself. Each entry's output
 * is dropped before the next is inflated, so this holds at most one entry (bounded by maxEntryBytes) at a time.
 */
export function verifyZip(buf: Buffer, limits: ZipLimits): ZipInspection {
  const inspected = inspectZip(buf, limits);
  if (!inspected.ok) return inspected;
  for (const entry of inspected.entries) {
    const inflated = inflateEntry(buf, entry);
    if (!inflated.ok) return { ok: false, code: 'archive_size_mismatch', message: inflated.message };
  }
  return inspected;
}
