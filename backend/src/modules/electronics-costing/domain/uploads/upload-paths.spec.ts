import { isFolderUpload, parseUploadPaths } from './upload-paths';

describe('parseUploadPaths', () => {
  const names = ['a.GTL', 'bom.xlsx'];

  it('accepts one path per file and normalises separators and a leading slash', () => {
    expect(parseUploadPaths(JSON.stringify(['/Asm\\BoardA/a.GTL', 'Asm/bom.xlsx']), 2, names)).toEqual({ ok: true, paths: ['Asm/BoardA/a.GTL', 'Asm/bom.xlsx'] });
  });

  it('refuses anything that is not a plain relative path matching its file', () => {
    expect(parseUploadPaths('nope', 2, names).ok).toBe(false);
    expect(parseUploadPaths(JSON.stringify(['a.GTL']), 2, names).ok).toBe(false);
    expect(parseUploadPaths(JSON.stringify([1, 2]), 2, names).ok).toBe(false);
    expect(parseUploadPaths(JSON.stringify(['../a.GTL', 'x/bom.xlsx']), 2, names).ok).toBe(false);
    expect(parseUploadPaths(JSON.stringify(['x//a.GTL', 'x/bom.xlsx']), 2, names).ok).toBe(false);
    expect(parseUploadPaths(JSON.stringify(['x/other.GTL', 'x/bom.xlsx']), 2, names).ok).toBe(false);
    expect(parseUploadPaths(JSON.stringify([`x/${'a'.repeat(500)}.GTL`, 'x/bom.xlsx']), 2, [`${'a'.repeat(500)}.GTL`, 'bom.xlsx']).ok).toBe(false);
  });

  it('tells a folder upload from loose files', () => {
    expect(isFolderUpload(['Asm/a.GTL'])).toBe(true);
    expect(isFolderUpload(['a.GTL', 'b.GTL'])).toBe(false);
  });
});
