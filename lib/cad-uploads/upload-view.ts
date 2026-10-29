import type { AssemblyNode, CadUpload, CadUploadStatus } from '@/lib/api/cad-uploads';

export const isInFlight = (status: CadUploadStatus | undefined): boolean => status === 'queued' || status === 'running';

const FAILURES: Record<string, string> = {
  archive_unreadable: 'The zip could not be read. Re-create it and try again.',
  archive_encrypted: 'The zip is password-protected. Upload an unencrypted zip.',
  archive_entry_too_large: 'A file in the zip is larger than the upload limit.',
  archive_too_large: 'The zip expands to far more than the upload limit allows.',
  archive_empty: 'The zip holds no files.',
  no_step_files: 'The zip holds no STEP files. Export your parts as STEP (AP242).',
  no_solids: 'None of the STEP files could be read as a part or assembly.',
  engine_rejected: 'The CAD engine refused these files.',
  invalid_engine_result: 'The CAD engine returned an unexpected answer. This is a platform fault, not your file.',
  worker_crashed: 'Processing stopped unexpectedly more than once.',
  processing_failed: 'Processing failed after several attempts.',
};

/** What to tell the user about a failed upload: a plain sentence per code, plus the detail the server recorded. */
export function describeFailure(upload: Pick<CadUpload, 'errorCode' | 'errorDetail'>): string {
  const base = (upload.errorCode ? FAILURES[upload.errorCode] : undefined) ?? 'Processing failed.';
  return upload.errorDetail && upload.errorDetail !== base ? `${base} ${upload.errorDetail}` : base;
}

export interface UploadSummary {
  items: number;
  distinctParts: number;
  /** Things the user should know about a done upload, most important first. */
  warnings: string[];
}

export function summarize(upload: CadUpload): UploadSummary {
  const report = upload.result?.report;
  const warnings: string[] = [];
  for (const input of report?.inputs ?? []) {
    if (input.status === 'unreadable') warnings.push(`${input.file} could not be read and was left out.`);
    else if (input.inside) warnings.push(`${input.file} is already part of ${input.inside}, so it was not added twice.`);
  }
  for (const skipped of upload.result?.skipped ?? []) warnings.push(`${skipped.path} was skipped (${skipped.reason}).`);
  const invalid = (report?.problems ?? []).filter((p) => p.code === 'invalid_geometry').length;
  if (invalid > 0) warnings.push(`${invalid} part${invalid > 1 ? 's have' : ' has'} geometry the CAD engine flags as invalid.`);
  return { items: upload.createdItemIds.length, distinctParts: report?.parts.length ?? 0, warnings };
}

export interface TreeRow {
  key: string;
  depth: number;
  name: string;
  quantity: number;
  kind: AssemblyNode['kind'];
  hasChildren: boolean;
}

/** The tree as flat rows, skipping the children of collapsed nodes. A node's key is its position, so it is stable. */
export function visibleRows(roots: AssemblyNode[], collapsed: ReadonlySet<string>): TreeRow[] {
  const rows: TreeRow[] = [];
  const walk = (node: AssemblyNode, key: string, depth: number): void => {
    rows.push({ key, depth, name: node.name, quantity: node.quantity, kind: node.kind, hasChildren: node.children.length > 0 });
    if (!collapsed.has(key)) node.children.forEach((child, i) => { walk(child, `${key}.${i}`, depth + 1); });
  };
  roots.forEach((root, i) => { walk(root, String(i), 0); });
  return rows;
}
