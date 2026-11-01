// Measures a .zip from its central directory before anything inflates it. Pure: bytes in, verdict out; nothing is decompressed.
//
// A zip bomb is caught here by what the archive itself declares: too many entries, an entry or a total that expands past the
// caller's budget, or an implausible compression ratio. The declared sizes can only be trusted if each entry owns its own bytes,
// so every entry's local header and data must lie inside the buffer, before the central directory, and must not overlap or repeat
// another entry's: otherwise many directory records can point at one small deflate stream, and the archive would expand far past
// what its real size suggests while every declared number still looks reasonable. Whoever inflates afterwards must still cap each
// entry at its declared size (expand-archive.ts does, with maxOutputLength), so a lying size cannot exceed what was measured here.

export interface ZipLimits {
  maxEntries: number;
  /** Largest declared uncompressed size of one entry. */
  maxEntryBytes: number;
  /** Largest declared uncompressed size of all entries together. */
  maxTotalBytes: number;
  /** Largest total uncompressed/compressed ratio, checked once the archive expands past 1 MB. Omitted: not checked. */
  maxRatio?: number;
}

export interface ZipEntryInfo {
  /** The name as stored (UTF-8 when flag bit 11 is set, otherwise latin1). */
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
  | 'archive_overlap';

export type ZipInspection = { ok: true; entries: ZipEntryInfo[] } | { ok: false; code: ZipRejection; message: string };

const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;
const EOCD = 0x06054b50;
const RATIO_FLOOR_BYTES = 1024 * 1024;

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
    const name = buf.subarray(cursor + 46, cursor + 46 + nameLen).toString(flags & 0x800 ? 'utf8' : 'latin1');
    cursor = recordEnd;

    if (size === 0xffffffff || compressedSize === 0xffffffff || localOffset === 0xffffffff) {
      return reject('archive_zip64', 'ZIP64 archives are not accepted.');
    }
    if (size > limits.maxEntryBytes) {
      return reject('archive_entry_too_large', `An entry expands to more than ${Math.floor(limits.maxEntryBytes / (1024 * 1024))} MB.`);
    }
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
