// Upload validation for customer design files (Gerber, BOM, XY, photos, wire lists).
// Pure: bytes in, verdict out. A file is judged by its content, never by its name alone
// (magic number), and archives are measured before anything extracts them (zip bombs,
// path traversal). Files are customer IP: nothing here logs or echoes content.

// Per file. Uploads are held in memory while validated, so the worst case per request is
// MAX_FILES_PER_UPLOAD x MAX_UPLOAD_BYTES (controller): keep both small. A Gerber archive, a BOM
// or a board photo is well under this.
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MAX_ARCHIVE_ENTRIES = 5000;
export const MAX_ARCHIVE_UNCOMPRESSED_BYTES = 1024 * 1024 * 1024;
export const MAX_ARCHIVE_RATIO = 100;

import { FILE_ROLES, type FileRole } from '../lookups/file-roles.generated';

export type UploadFormat = 'zip' | 'xlsx' | 'pdf' | 'png' | 'jpeg' | 'text';

export type UploadVerdict =
  // role: the board-file role of a Gerber, drill or report file (from the file-role table), when it has one.
  | { ok: true; format: UploadFormat; role?: string }
  | { ok: false; code: UploadRejection; message: string };

export type UploadRejection =
  | 'empty'
  | 'too_large'
  | 'unsupported_extension'
  | 'magic_mismatch'
  | 'archive_too_many_entries'
  | 'archive_too_large'
  | 'archive_ratio'
  | 'archive_path_traversal'
  | 'archive_unreadable'
  | 'archive_zip64';

// Plain text and tabular formats. Board files (Gerber layers, drill data, drill reports) are not listed
// here: their extensions and roles come from the file-role table (memory/Electronics/gerber_file_roles.csv).
const TEXT_EXTENSIONS = new Set(['csv', 'txt', 'json', 'xml', 'tsv']);

const ROLE_BY_EXTENSION = new Map<string, FileRole>(FILE_ROLES.map((r) => [r.extension, r]));

// What an upload may contain, for the screen that offers the file picker: the board files and their roles come from the
// file-role table; the rest are the general formats the validator accepts.
export function acceptedFormats() {
  return {
    boardFiles: FILE_ROLES.map((r) => ({ extension: r.extension, role: r.role, family: r.family, sourceUrl: r.sourceUrl })),
    tabular: [...TEXT_EXTENSIONS, 'xlsx'].sort(),
    documents: ['pdf'],
    images: ['png', 'jpg', 'jpeg'],
    archives: ['zip'],
  };
}

const head = (buf: Buffer) => buf.subarray(0, 8192).toString('latin1');

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

function startsWith(buf: Buffer, bytes: number[]): boolean {
  return buf.length >= bytes.length && bytes.every((b, i) => buf[i] === b);
}

const ZIP_MAGICS = [
  [0x50, 0x4b, 0x03, 0x04],
  [0x50, 0x4b, 0x05, 0x06],
];

function looksLikeText(buf: Buffer): boolean {
  const head = buf.subarray(0, 8192);
  return !head.includes(0);
}

// Reads the zip central directory only; nothing is inflated.
function checkArchive(buf: Buffer): UploadVerdict | null {
  const searchFrom = Math.max(0, buf.length - 65557);
  let eocd = -1;
  for (let i = buf.length - 22; i >= searchFrom; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) return { ok: false, code: 'archive_unreadable', message: 'Archive has no central directory.' };

  const entryCount = buf.readUInt16LE(eocd + 10);
  const dirSize = buf.readUInt32LE(eocd + 12);
  const dirOffset = buf.readUInt32LE(eocd + 16);
  if (entryCount === 0xffff || dirSize === 0xffffffff || dirOffset === 0xffffffff) {
    return { ok: false, code: 'archive_zip64', message: 'ZIP64 archives are not accepted.' };
  }
  if (entryCount > MAX_ARCHIVE_ENTRIES) {
    return { ok: false, code: 'archive_too_many_entries', message: `Archive holds more than ${MAX_ARCHIVE_ENTRIES} entries.` };
  }
  if (dirOffset + dirSize > buf.length) {
    return { ok: false, code: 'archive_unreadable', message: 'Archive central directory is truncated.' };
  }

  let cursor = dirOffset;
  let compressed = 0;
  let uncompressed = 0;
  for (let n = 0; n < entryCount; n++) {
    if (cursor + 46 > buf.length || buf.readUInt32LE(cursor) !== 0x02014b50) {
      return { ok: false, code: 'archive_unreadable', message: 'Archive central directory is corrupt.' };
    }
    compressed += buf.readUInt32LE(cursor + 20);
    uncompressed += buf.readUInt32LE(cursor + 24);
    const nameLen = buf.readUInt16LE(cursor + 28);
    const extraLen = buf.readUInt16LE(cursor + 30);
    const commentLen = buf.readUInt16LE(cursor + 32);
    const name = buf.subarray(cursor + 46, cursor + 46 + nameLen).toString('utf8');
    if (name.startsWith('/') || /^[a-zA-Z]:/.test(name) || name.split(/[\\/]/).includes('..')) {
      return { ok: false, code: 'archive_path_traversal', message: 'Archive contains an unsafe file path.' };
    }
    cursor += 46 + nameLen + extraLen + commentLen;
  }

  if (uncompressed > MAX_ARCHIVE_UNCOMPRESSED_BYTES) {
    return { ok: false, code: 'archive_too_large', message: 'Archive expands beyond the allowed size.' };
  }
  if (uncompressed / Math.max(compressed, 1) > MAX_ARCHIVE_RATIO && uncompressed > 1024 * 1024) {
    return { ok: false, code: 'archive_ratio', message: 'Archive compression ratio is implausibly high.' };
  }
  return null;
}

export function validateUpload(fileName: string, bytes: Buffer): UploadVerdict {
  if (bytes.length === 0) return { ok: false, code: 'empty', message: 'File is empty.' };
  if (bytes.length > MAX_UPLOAD_BYTES) {
    return { ok: false, code: 'too_large', message: `File exceeds ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB.` };
  }

  const ext = extensionOf(fileName);
  const mismatch: UploadVerdict = { ok: false, code: 'magic_mismatch', message: `File content does not match .${ext}.` };

  if (ext === 'zip' || ext === 'xlsx') {
    if (!ZIP_MAGICS.some((m) => startsWith(bytes, m))) return mismatch;
    return checkArchive(bytes) ?? { ok: true, format: ext };
  }
  if (ext === 'pdf') return startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]) ? { ok: true, format: 'pdf' } : mismatch;
  if (ext === 'png') return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47]) ? { ok: true, format: 'png' } : mismatch;
  if (ext === 'jpg' || ext === 'jpeg') return startsWith(bytes, [0xff, 0xd8, 0xff]) ? { ok: true, format: 'jpeg' } : mismatch;
  // A board file is judged by its content: a Gerber layer must carry its format statement, and a drill
  // file must be Excellon. A .txt that is not Excellon is just text.
  const role = ROLE_BY_EXTENSION.get(ext);
  if (role && looksLikeText(bytes)) {
    const text = head(bytes);
    if (role.family === 'gerber') return text.includes('%FS') ? { ok: true, format: 'text', role: role.role } : mismatch;
    if (role.family === 'excellon' && (text.startsWith('\uFEFF') ? text.slice(1) : text).trimStart().startsWith('M48')) return { ok: true, format: 'text', role: role.role };
    if (role.family === 'report') return { ok: true, format: 'text', role: role.role };
  }
  if (role && !looksLikeText(bytes)) return mismatch;

  if (TEXT_EXTENSIONS.has(ext)) return looksLikeText(bytes) ? { ok: true, format: 'text' } : mismatch;

  return { ok: false, code: 'unsupported_extension', message: `.${ext || '(none)'} files are not accepted.` };
}
