import { archiveRootName, expandArchive as expand, isArchiveName, type ArchiveLimits } from './expand-archive';
import { zip } from './test-zip';

const LIMITS: ArchiveLimits = { maxEntries: 5000, maxEntryBytes: 25 * 1024 * 1024, maxTotalBytes: 1024 * 1024 * 1024 };
const expandArchive = (name: string, bytes: Buffer, limits: ArchiveLimits = LIMITS) => expand(name, bytes, limits);

const GERBER = '%FSLAX25Y25*%\n%MOIN*%\nM02*\n';

describe('expandArchive', () => {
  it('unpacks stored and deflated entries under a folder named after the archive', () => {
    const bytes = zip([
      { name: 'Board A/', data: '' },
      { name: 'Board A/layer.GTL', data: GERBER, deflate: true },
      { name: 'Board A/notes.txt', data: 'hello' },
      { name: 'BOM.csv', data: 'Designator,Comment\n', deflate: true },
    ]);
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

describe('expandArchive limits are the caller\'s', () => {
  it('lets a CAD caller allow an entry that a Gerber caller would refuse', () => {
    const bytes = zip([{ name: 'big.step', data: GERBER, statedSize: 60 * 1024 * 1024 }]);
    expect(expandArchive('p.zip', bytes)).toMatchObject({ ok: false, code: 'archive_entry_too_large' });
    expect(expandArchive('p.zip', bytes, { ...LIMITS, maxEntryBytes: 100 * 1024 * 1024 })).toMatchObject({ ok: false, code: 'archive_unreadable' }); // stated size lies about the real bytes
  });

  it('refuses more entries than the caller allows', () => {
    const bytes = zip([{ name: 'a.txt', data: 'x' }, { name: 'b.txt', data: 'y' }]);
    expect(expandArchive('p.zip', bytes, { ...LIMITS, maxEntries: 1 })).toMatchObject({ ok: false, code: 'archive_unreadable' });
  });
});
