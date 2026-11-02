// Upload validation for customer design files (Gerber, BOM, XY, photos, wire lists).
// Pure: bytes in, verdict out. A file is judged by its content, never by its name alone
// (magic number). Files are customer IP: nothing here logs or echoes content.
// A .zip or .xlsx is only recognised here; it is measured by the shared archive gate (common/archive, through
// application/validate-design-file.ts) before anything extracts it.

// Per file. Uploads are held in memory while validated, so the worst case per request is
// MAX_FILES_PER_UPLOAD x MAX_UPLOAD_BYTES (controller): keep both small. A Gerber archive, a BOM
// or a board photo is well under this. An entry of an archive is held to the same per-file limit.
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MAX_ARCHIVE_ENTRIES = 5000;
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
  | 'magic_mismatch';

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

export function validateUpload(fileName: string, bytes: Buffer): UploadVerdict {
  if (bytes.length === 0) return { ok: false, code: 'empty', message: 'File is empty.' };
  if (bytes.length > MAX_UPLOAD_BYTES) {
    return { ok: false, code: 'too_large', message: `File exceeds ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB.` };
  }

  const ext = extensionOf(fileName);
  const mismatch: UploadVerdict = { ok: false, code: 'magic_mismatch', message: `File content does not match .${ext}.` };

  if (ext === 'zip' || ext === 'xlsx') {
    if (!ZIP_MAGICS.some((m) => startsWith(bytes, m))) return mismatch;
    return { ok: true, format: ext };
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
