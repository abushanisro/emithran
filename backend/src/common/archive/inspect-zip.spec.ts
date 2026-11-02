import * as zlib from 'node:zlib';

import { expandArchive } from './expand-archive';
import { inflateEntry, inspectZip, verifyZip, type ZipLimits } from './inspect-zip';
import { zip } from './test-zip';
import { xlsxZipLimits } from './xlsx-limits';

const MB = 1024 * 1024;
const LIMITS: ZipLimits = { maxEntries: 100, maxEntryBytes: 25 * MB, maxTotalBytes: 50 * MB, maxRatio: 100 };
const zeros = (bytes: number) => Buffer.alloc(bytes);

/** A raw deflate stream of `bytes` zero bytes, built a megabyte at a time so the test never holds the inflated size. */
async function deflatedZeros(bytes: number): Promise<Buffer> {
  const deflate = zlib.createDeflateRaw({ level: 9 });
  const out: Buffer[] = [];
  deflate.on('data', (chunk: Buffer) => out.push(chunk));
  const done = new Promise<void>((resolve, reject) => deflate.on('end', resolve).on('error', reject));
  const chunk = Buffer.alloc(MB);
  for (let written = 0; written < bytes; written += MB) {
    if (!deflate.write(chunk)) await new Promise((resolve) => deflate.once('drain', resolve));
  }
  deflate.end();
  await done;
  return Buffer.concat(out);
}

describe('inspectZip (layer 1: the central directory, nothing inflated)', () => {
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

  it('holds entries under a path prefix to their own, tighter limit', () => {
    const limits = { ...LIMITS, maxRatio: undefined, prefixLimits: [{ prefix: 'xl/media/', maxBytes: 5 * MB }] };
    expect(inspectZip(zip([{ name: 'xl/media/a.png', data: 'x', statedSize: 6 * MB }]), limits)).toMatchObject({ ok: false, code: 'archive_entry_too_large' });
    expect(inspectZip(zip([{ name: 'xl/worksheets/s.xml', data: 'x', statedSize: 6 * MB }]), limits).ok).toBe(true);
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

  it.each(['/etc/passwd', '../x.xml', 'a/../../x.xml', 'C:/x.xml', 'a\\..\\x.xml', 'a//b.xml', './a.xml'])('refuses the unsafe path %s', (name) => {
    expect(inspectZip(zip([{ name, data: 'x' }]), LIMITS)).toMatchObject({ ok: false, code: 'archive_unsafe_path' });
  });

  it('refuses encrypted entries and compression methods other than stored and deflate', () => {
    expect(inspectZip(zip([{ name: 'a.xml', data: 'x', encrypted: true }]), LIMITS)).toMatchObject({ ok: false, code: 'archive_encrypted' });
    expect(inspectZip(zip([{ name: 'a.xml', data: 'x', method: 12 }]), LIMITS)).toMatchObject({ ok: false, code: 'archive_unsupported_method' });
  });
});

describe('inflateEntry and verifyZip (layer 2: actual output, capped at the declared size)', () => {
  it('returns exactly the declared bytes', () => {
    const bytes = zip([{ name: 'a.txt', data: 'hello world', deflate: true }]);
    const inspected = inspectZip(bytes, LIMITS);
    if (!inspected.ok) throw new Error(inspected.message);
    expect(inflateEntry(bytes, inspected.entries[0])).toEqual({ ok: true, bytes: Buffer.from('hello world') });
    expect(verifyZip(bytes, LIMITS).ok).toBe(true);
  });

  it('refuses an entry that understates its size, after at most the declared bytes', () => {
    // Declared 1 KB, really 10 MB: the directory is within every limit (the ratio is not checked below 1 MB).
    const liar = zip([{ name: 'xl/worksheets/sheet1.xml', data: zeros(10 * MB), deflate: true, statedSize: 1024 }]);
    expect(inspectZip(liar, LIMITS).ok).toBe(true);
    // The module object itself (inspect-zip.ts calls through it), not the import-star copy above.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const inflate = jest.spyOn(require('zlib') as typeof zlib, 'inflateRawSync');
    try {
      expect(verifyZip(liar, LIMITS)).toMatchObject({ ok: false, code: 'archive_size_mismatch' });
      expect(inflate.mock.calls.map(([, options]) => options?.maxOutputLength)).toEqual([1024]);
    } finally {
      inflate.mockRestore();
    }
  });

  it('refuses an entry declared empty that inflates to anything', () => {
    const liar = zip([{ name: 'a.xml', data: 'not empty', deflate: true, statedSize: 0 }]);
    expect(verifyZip(liar, LIMITS)).toMatchObject({ ok: false, code: 'archive_size_mismatch' });
  });

  it('refuses a stored entry whose bytes are not its declared size', () => {
    const liar = zip([{ name: 'a.xml', data: 'hello', statedSize: 3 }]);
    expect(verifyZip(liar, LIMITS)).toMatchObject({ ok: false, code: 'archive_size_mismatch' });
  });

  it('stops a 600 MB-expanding entry that claims 1 MB at 1 MB', async () => {
    const stream = await deflatedZeros(600 * MB);
    expect(stream.length).toBeLessThan(2 * MB);
    const bomb = zip([{ name: 'xl/worksheets/sheet1.xml', deflated: { stream, inflatedSize: MB } }]);
    const before = process.memoryUsage().arrayBuffers;
    expect(verifyZip(bomb, { ...xlsxZipLimits(), maxRatio: 10_000 })).toMatchObject({ ok: false, code: 'archive_size_mismatch' });
    expect(process.memoryUsage().arrayBuffers - before).toBeLessThan(64 * MB);
  }, 60_000);
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
