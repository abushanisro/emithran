import JSZip from 'jszip';

import { ELECTRONICS_ARCHIVE_LIMITS, validateDesignFile } from './validate-design-file';
import { RESOURCE_LIMITS } from '../../../common/resource-limits';
import { MAX_ARCHIVE_ENTRIES } from '../domain/uploads/validate-upload';

// Building the archives deflates tens of megabytes; under a parallel full run the default 5 s is not enough.
jest.setTimeout(60_000);

async function zipOf(files: Record<string, Buffer | string>, deflate = true): Promise<Buffer> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) zip.file(name, content, { createFolders: false });
  return zip.generateAsync({ type: 'nodebuffer', compression: deflate ? 'DEFLATE' : 'STORE' });
}

const code = (name: string, bytes: Buffer) => {
  const v = validateDesignFile(name, bytes);
  return v.ok ? 'ok' : v.code;
};

describe('validateDesignFile: zip-shaped uploads go through the shared archive gate', () => {
  it('accepts an ordinary archive and an xlsx container', async () => {
    const bytes = await zipOf({ 'top.gtl': 'G04 gerber*\n', 'drill.drl': 'M48\n' });
    expect(validateDesignFile('gerbers.zip', bytes)).toEqual({ ok: true, format: 'zip' });
    expect(validateDesignFile('bom.xlsx', bytes)).toEqual({ ok: true, format: 'xlsx' });
  });

  it('expands within the one archive budget every zip upload shares', () => {
    expect(ELECTRONICS_ARCHIVE_LIMITS.maxTotalBytes).toBe(RESOURCE_LIMITS.archiveMaxExpandedBytes);
  });

  it('leaves other files to the content check alone', () => {
    expect(validateDesignFile('board.GTL', Buffer.from('G04*\n%FSLAX25Y25*%\n'))).toEqual({ ok: true, format: 'text', role: 'copper_top' });
    expect(code('run.exe', Buffer.from('MZ'))).toBe('unsupported_extension');
  });

  it('rejects a decompression bomb by its compression ratio', async () => {
    const bomb = await zipOf({ 'zeros.gbr': Buffer.alloc(20 * 1024 * 1024) });
    expect(bomb.length).toBeLessThan(200 * 1024);
    expect(code('gerbers.zip', bomb)).toBe('archive_ratio');
  });

  it('rejects an entry over the per-file limit, a .xlsx included', async () => {
    const big = await zipOf({ 'zeros.gbr': Buffer.alloc(26 * 1024 * 1024) });
    expect(code('gerbers.zip', big)).toBe('archive_entry_too_large');
    expect(code('bom.xlsx', big)).toBe('archive_entry_too_large');
  });

  it('rejects an archive with too many entries', async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i <= MAX_ARCHIVE_ENTRIES; i++) files[`f${i}.txt`] = 'x';
    expect(code('many.zip', await zipOf(files, false))).toBe('archive_too_many_entries');
  });

  it.each([['../evil.txt'], ['/etc/passwd'], ['a/../../b.txt'], ['C:/windows/x.txt']])('rejects path %s', async (name) => {
    expect(code('slip.zip', await zipOf({ [name]: 'x' }))).toBe('archive_unsafe_path');
  });

  it('rejects a truncated archive', async () => {
    const bytes = await zipOf({ 'a.txt': 'hello world' });
    expect(code('cut.zip', bytes.subarray(0, bytes.length - 30))).toBe('archive_unreadable');
  });
});
