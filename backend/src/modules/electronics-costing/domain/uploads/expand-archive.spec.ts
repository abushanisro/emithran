import { deflateRawSync } from 'zlib';

import { archiveRootName, expandArchive, isArchiveName } from './expand-archive';
import { validateUpload } from './validate-upload';

interface TestEntry {
  name: string;
  data?: string;
  deflate?: boolean;
  encrypted?: boolean;
  /** Override the size written to the central directory. */
  statedSize?: number;
}

// Writes the smallest well-formed zip that holds the given entries (local headers, central directory, end record).
function zip(entries: TestEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const raw = Buffer.from(e.data ?? '', 'utf8');
    const body = e.deflate ? deflateRawSync(raw) : raw;
    const name = Buffer.from(e.name, 'utf8');
    const flags = 0x800 | (e.encrypted ? 0x1 : 0);
    const method = e.deflate ? 8 : 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(e.statedSize ?? raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, body);
    centrals.push(central, name);
    offset += 30 + name.length + body.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

const GERBER = '%FSLAX25Y25*%\n%MOIN*%\nM02*\n';

describe('expandArchive', () => {
  it('unpacks stored and deflated entries under a folder named after the archive', () => {
    const bytes = zip([
      { name: 'Board A/', data: '' },
      { name: 'Board A/layer.GTL', data: GERBER, deflate: true },
      { name: 'Board A/notes.txt', data: 'hello' },
      { name: 'BOM.csv', data: 'Designator,Comment\n', deflate: true },
    ]);
    expect(validateUpload('pack.zip', bytes).ok).toBe(true);
    const result = expandArchive('Customer pack (1).zip', bytes);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.root).toBe('Customer pack (1)');
    expect(result.entries.map((e) => [e.path, e.name, e.bytes.toString('utf8')])).toEqual([
      ['Customer pack (1)/Board A/layer.GTL', 'layer.GTL', GERBER],
      ['Customer pack (1)/Board A/notes.txt', 'notes.txt', 'hello'],
      ['Customer pack (1)/BOM.csv', 'BOM.csv', 'Designator,Comment\n'],
    ]);
    expect(result.skipped).toEqual([]);
  });

  it('lists macOS metadata and nested archives as skipped instead of dropping them silently', () => {
    const result = expandArchive('p.zip', zip([
      { name: 'b/layer.gtl', data: GERBER },
      { name: '__MACOSX/b/._layer.gtl', data: 'x' },
      { name: 'b/.DS_Store', data: 'x' },
      { name: 'b/older.zip', data: 'PK' },
    ]));
    expect(result.ok && result.entries.map((e) => e.path)).toEqual(['p/b/layer.gtl']);
    expect(result.ok && result.skipped.map((s) => s.path)).toEqual(['p/__MACOSX/b/._layer.gtl', 'p/b/.DS_Store', 'p/b/older.zip']);
  });

  it('refuses an encrypted entry', () => {
    const result = expandArchive('p.zip', zip([{ name: 'secret.gtl', data: GERBER, encrypted: true }]));
    expect(result).toMatchObject({ ok: false, code: 'archive_encrypted' });
  });

  it('refuses an entry whose inflated size differs from the directory (a lying archive)', () => {
    const result = expandArchive('p.zip', zip([{ name: 'a.gtl', data: GERBER, deflate: true, statedSize: 5 }]));
    expect(result).toMatchObject({ ok: false, code: 'archive_unreadable' });
  });

  it('refuses an entry that claims to expand past the per-file limit before inflating it', () => {
    const result = expandArchive('p.zip', zip([{ name: 'a.gtl', data: GERBER, statedSize: 26 * 1024 * 1024 }]));
    expect(result).toMatchObject({ ok: false, code: 'archive_entry_too_large' });
  });

  it('refuses parent-directory segments', () => {
    const result = expandArchive('p.zip', zip([{ name: 'a/../../etc/x.gtl', data: GERBER }]));
    expect(result).toMatchObject({ ok: false, code: 'archive_unreadable' });
  });

  it('an archive of folders only is empty', () => {
    expect(expandArchive('p.zip', zip([{ name: 'a/' }]))).toMatchObject({ ok: false, code: 'archive_empty' });
  });

  it('names the root after the archive file', () => {
    expect(archiveRootName('PCBA + Harness Drawing.ZIP')).toBe('PCBA + Harness Drawing');
    expect(archiveRootName('.zip')).toBe('Design pack');
    expect(isArchiveName('a.Zip')).toBe(true);
    expect(isArchiveName('a.xlsx')).toBe(false);
  });
});
