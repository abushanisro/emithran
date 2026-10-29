import { MAX_CAD_FILE_BYTES } from '../../common/upload-limits';

export type UploadCheck = { ok: true; kind: 'zip' | 'step' } | { ok: false; code: string; message: string };

const NATIVE_CAD = /\.(sldasm|sldprt|catpart|catproduct|prt|asm|ipt|iam|x_t|x_b|3dm|dwg)$/i;

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
