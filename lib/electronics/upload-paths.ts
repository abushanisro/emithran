/**
 * The relative path of a picked or dropped file. A folder dropped on the page (or chosen with the folder button) reports each
 * file's path inside it; loose files report just their name. The server turns the folder structure into the assembly tree.
 */

interface PathedFile {
  name: string;
  path?: string;
  webkitRelativePath?: string;
}

export function relativePath(file: PathedFile): string {
  // An empty path (a loose file) falls through to the next source, so this is not a nullish choice.
  let path = [file.path, file.webkitRelativePath].find((p) => p !== undefined && p !== '') ?? file.name;
  path = path.split('\\').join('/');
  while (path.startsWith('./') || path.startsWith('/')) path = path.startsWith('./') ? path.slice(2) : path.slice(1);
  return path || file.name;
}

/** True when any file sits inside a folder: the upload is an assembly folder, not loose files. */
export function isFolder(paths: string[]): boolean {
  return paths.some((p) => p.includes('/'));
}

/** The folder a set of paths was chosen from (their shared first segment), or null for loose files or several folders. */
export function folderName(paths: string[]): string | null {
  if (!isFolder(paths)) return null;
  const roots = new Set(paths.map((p) => p.split('/')[0]));
  return roots.size === 1 ? ([...roots][0] ?? null) : null;
}
