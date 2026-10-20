// The relative paths a browser reports for a dropped or chosen folder (webkitRelativePath), sent beside the files so the
// folder structure survives a multipart upload (which carries only file names). Validated here, never trusted.

export const MAX_PATH_LENGTH = 400;

export type UploadPaths = { ok: true; paths: string[] } | { ok: false; message: string };

/** Normalises '\' to '/', strips a leading '/', and refuses empty, '.' or '..' segments and over-long paths. */
export function parseUploadPaths(raw: string, fileCount: number, fileNames: string[]): UploadPaths {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, message: 'paths must be valid JSON' };
  }
  if (!Array.isArray(parsed) || parsed.length !== fileCount || parsed.some((p) => typeof p !== 'string')) {
    return { ok: false, message: 'paths must be an array with one path per file' };
  }
  const paths: string[] = [];
  for (const [i, value] of (parsed as string[]).entries()) {
    let path = value.split('\\').join('/');
    while (path.startsWith('/')) path = path.slice(1);
    const segments = path.split('/');
    if (path.length === 0 || path.length > MAX_PATH_LENGTH || segments.some((s) => s === '' || s === '.' || s === '..')) {
      return { ok: false, message: `path ${i + 1} is not a plain relative path` };
    }
    if (segments[segments.length - 1] !== fileNames[i]) {
      return { ok: false, message: `path ${i + 1} does not end in the file name ${fileNames[i]}` };
    }
    paths.push(path);
  }
  return { ok: true, paths };
}

/** True when the paths describe a folder (some file sits inside a directory). */
export function isFolderUpload(paths: string[]): boolean {
  return paths.some((p) => p.includes('/'));
}
