import * as fs from 'node:fs';
import * as path from 'node:path';
import { BadRequestException } from '@nestjs/common';
import * as ExcelJS from 'exceljs';

import { expandArchive } from './expand-archive';
import { inspectZip, type ZipLimits } from './inspect-zip';
import { zip } from './test-zip';
import { assertXlsxWithinLimits } from './xlsx-limits';

const MB = 1024 * 1024;
const LIMITS: ZipLimits = { maxEntries: 100, maxEntryBytes: 25 * MB, maxTotalBytes: 50 * MB, maxRatio: 100 };
const zeros = (bytes: number) => Buffer.alloc(bytes);

describe('inspectZip', () => {
  it('accepts an ordinary archive and reports where each entry\'s data starts', () => {
    const bytes = zip([{ name: 'a.txt', data: 'hello' }, { name: 'b.txt', data: 'world', deflate: true }]);
    const result = inspectZip(bytes, LIMITS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entries.map((e) => [e.name, e.size])).toEqual([['a.txt', 5], ['b.txt', 5]]);
    expect(bytes.subarray(result.entries[0].dataStart, result.entries[0].dataStart + 5).toString()).toBe('hello');
  });

  it('refuses many directory records that point at one local header (a bomb whose declared sizes look small)', () => {
    // One 20 MB deflate stream of zeros (~20 KB), named by 40 records: 800 MB of declared output from a ~20 KB file.
    const bomb = zip([
      { name: 'a.bin', data: zeros(20 * MB), deflate: true },
      ...Array.from({ length: 39 }, (_, i) => ({ name: `copy${i}.bin`, sharesWith: 0 })),
    ]);
    expect(bomb.length).toBeLessThan(64 * 1024);
    const generous = { maxEntries: 100, maxEntryBytes: 25 * MB, maxTotalBytes: 1024 * MB };
    expect(inspectZip(bomb, generous)).toMatchObject({ ok: false, code: 'archive_overlap' });
  });

  it('refuses an entry whose data runs into the next entry', () => {
    const bytes = zip([{ name: 'a.txt', data: 'hello', statedCompressedSize: 5 + 30 }, { name: 'b.txt', data: 'world' }]);
    expect(inspectZip(bytes, LIMITS)).toMatchObject({ ok: false, code: 'archive_overlap' });
  });

  it('refuses an entry whose data runs past the archive', () => {
    const bytes = zip([{ name: 'a.txt', data: 'hello', statedCompressedSize: 10_000 }]);
    expect(inspectZip(bytes, LIMITS)).toMatchObject({ ok: false, code: 'archive_unreadable' });
  });

  it('refuses an entry or a total above the budget from the directory alone', () => {
    expect(inspectZip(zip([{ name: 'a', data: 'x', statedSize: 26 * MB }]), LIMITS)).toMatchObject({ ok: false, code: 'archive_entry_too_large' });
    const three = zip([0, 1, 2].map((i) => ({ name: `f${i}`, data: 'x', statedSize: 20 * MB })));
    expect(inspectZip(three, LIMITS)).toMatchObject({ ok: false, code: 'archive_too_large' });
  });

  it('refuses a compression ratio above the limit', () => {
    const bytes = zip([{ name: 'zeros.bin', data: zeros(5 * MB), deflate: true }]);
    expect(inspectZip(bytes, LIMITS)).toMatchObject({ ok: false, code: 'archive_ratio' });
    expect(inspectZip(bytes, { ...LIMITS, maxRatio: undefined }).ok).toBe(true);
  });

  it('refuses too many entries, ZIP64 markers and anything without a central directory', () => {
    expect(inspectZip(zip([{ name: 'a' }, { name: 'b' }]), { ...LIMITS, maxEntries: 1 })).toMatchObject({ ok: false, code: 'archive_too_many_entries' });
    const zip64 = zip([{ name: 'a', data: 'x' }]);
    zip64.writeUInt32LE(0xffffffff, zip64.length - 22 + 16);
    expect(inspectZip(zip64, LIMITS)).toMatchObject({ ok: false, code: 'archive_zip64' });
    expect(inspectZip(Buffer.from('not a zip'), LIMITS)).toMatchObject({ ok: false, code: 'archive_unreadable' });
  });
});

describe('expandArchive measures before it inflates', () => {
  it('refuses records sharing one local header without inflating any of them', () => {
    const bomb = zip([
      { name: 'a.gtl', data: zeros(MB), deflate: true },
      { name: 'b.gtl', sharesWith: 0 },
    ]);
    const limits = { maxEntries: 10, maxEntryBytes: 25 * MB, maxTotalBytes: 200 * MB };
    expect(expandArchive('p.zip', bomb, limits)).toMatchObject({ ok: false, code: 'archive_unreadable' });
  });
});

describe('assertXlsxWithinLimits', () => {
  it('lets a real workbook through', async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('Rates').addRow(['Machine', 'Rate']);
    const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
    expect(() => assertXlsxWithinLimits(bytes)).not.toThrow();
  });

  it('refuses a workbook with a media part that inflates to gigabytes, before ExcelJS sees it', () => {
    const bomb = zip([
      { name: '[Content_Types].xml', data: '<Types/>' },
      { name: 'xl/media/a.bin', data: zeros(60 * MB), deflate: true },
    ]);
    expect(bomb.length).toBeLessThan(200 * 1024);
    expect(() => assertXlsxWithinLimits(bomb)).toThrow(BadRequestException);
  });

  it('refuses something that is not a zip', () => {
    expect(() => assertXlsxWithinLimits(Buffer.from('a,b\n1,2\n'))).toThrow('not a readable .xlsx');
  });

  it('runs before every ExcelJS load of uploaded bytes', () => {
    const root = path.resolve(__dirname, '..', '..');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) files.push(full);
      }
    };
    walk(root);
    const loaders = files.filter((f) => fs.readFileSync(f, 'utf8').includes('xlsx.load('));
    expect(loaders.length).toBeGreaterThanOrEqual(5);
    for (const file of loaders) {
      const source = fs.readFileSync(file, 'utf8');
      expect({ file: path.relative(root, file), guarded: source.split('xlsx.load(').length - 1 <= source.split('assertXlsxWithinLimits(').length - 1 }).toEqual({
        file: path.relative(root, file),
        guarded: true,
      });
    }
  });
});
