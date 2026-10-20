import { describe, expect, it } from 'vitest';

import { folderName, isFolder, relativePath } from '@/lib/electronics/upload-paths';

describe('relativePath', () => {
  it('uses the path a dropped folder reports, without a leading slash or ./', () => {
    expect(relativePath({ name: 'a.GTL', path: '/Assembly/BoardA/a.GTL' })).toBe('Assembly/BoardA/a.GTL');
    expect(relativePath({ name: 'a.GTL', path: './a.GTL' })).toBe('a.GTL');
  });

  it('falls back to the folder-picker path, then to the file name', () => {
    expect(relativePath({ name: 'a.GTL', webkitRelativePath: 'Assembly/a.GTL' })).toBe('Assembly/a.GTL');
    expect(relativePath({ name: 'a.GTL' })).toBe('a.GTL');
    expect(relativePath({ name: 'a.GTL', path: 'Assembly\\BoardA\\a.GTL' })).toBe('Assembly/BoardA/a.GTL');
  });
});

describe('folder detection', () => {
  it('is a folder when any file is inside one', () => {
    expect(isFolder(['Assembly/a.GTL', 'b.GTL'])).toBe(true);
    expect(isFolder(['a.GTL', 'b.GTL'])).toBe(false);
  });

  it('names the folder only when every file shares one', () => {
    expect(folderName(['Assembly/x/a.GTL', 'Assembly/b.xlsx'])).toBe('Assembly');
    expect(folderName(['A/a.GTL', 'B/b.GTL'])).toBeNull();
    expect(folderName(['a.GTL'])).toBeNull();
  });
});
