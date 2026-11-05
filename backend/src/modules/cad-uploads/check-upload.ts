import { MAX_CAD_FILE_BYTES } from '../../common/upload-limits';

export type UploadCheck = { ok: true; kind: 'zip' | 'step' } | { ok: false; code: string; message: string };

const NATIVE_CAD = /\.(sldasm|sldprt|catpart|catproduct|prt|asm|ipt|iam|x_t|x_b|3dm|dwg)$/i;

/**
 * Why a file of a zip that is not STEP is left out. A native CAD file (Parasolid, SolidWorks, CATIA...) is a part the user expects in the BOM, so
 * the reason names its format and what to do; anything else (a drawing, a note) is just "not a STEP file". The Rust core says the same words
 * (core/crates/runner/src/job.rs `skip_reason`), and the parity harness checks that they agree.
 */
export function skipReason(fileName: string): string {
  const extension = /\.([a-z0-9_]+)$/i.exec(fileName)?.[1]?.toLowerCase();
  return NATIVE_CAD.test(fileName) ? `a native CAD file (.${extension}), not read: export it as STEP (AP242) and upload that` : 'not a STEP file';
}

/** What the API accepts: a zip of STEP files, or one STEP file. Content is checked, not just the name. */
export function checkUpload(name: string, bytes: Buffer): UploadCheck {
  const reject = (code: string, message: string): UploadCheck => ({ ok: false, code, message });
  if (bytes.length === 0) return reject('empty_file', `${name} is empty.`);
  if (bytes.length > MAX_CAD_FILE_BYTES) return reject('file_too_large', `${name} is larger than ${MAX_CAD_FILE_BYTES / 1024 / 1024} MB.`);

  if (/\.zip$/i.test(name)) {
    return bytes.readUInt32LE(0) === 0x04034b50 ? { ok: true, kind: 'zip' } : reject('not_a_zip', `${name} is not a zip archive.`);
  }
  if (/\.(step|stp)$/i.test(name)) {
    const head = bytes.subarray(0, 64).toString('utf8').replace(/^﻿/, '').trimStart();
    return head.startsWith('ISO-10303-21') ? { ok: true, kind: 'step' } : reject('not_a_step', `${name} is not a STEP file.`);
  }
  if (NATIVE_CAD.test(name)) {
    return reject('native_cad_not_supported', `${name} is a native CAD file. Export it as STEP (AP242) and upload that.`);
  }
  return reject('unsupported_type', `${name}: upload a .zip of STEP files, or a .step / .stp file.`);
}

/** What a zip with no STEP file says about itself: the kinds of file it does hold, so "no STEP files" is never a bare verdict. */
export function noStepFilesMessage(paths: readonly string[]): string {
  const base = 'The archive holds no STEP files.';
  const advice = 'Export your parts as STEP (AP242) and zip those.';
  const byType = new Map<string, number>();
  for (const path of paths) {
    const name = path.slice(path.lastIndexOf('/') + 1);
    const dot = name.lastIndexOf('.');
    const type = dot > 0 ? name.slice(dot).toLowerCase() : '(no extension)';
    byType.set(type, (byType.get(type) ?? 0) + 1);
  }
  if (byType.size === 0) return `${base} ${advice}`;
  const found = [...byType].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([type, n]) => `${n} ${type}`).join(', ');
  return `${base} It holds ${found}. ${advice}`;
}
