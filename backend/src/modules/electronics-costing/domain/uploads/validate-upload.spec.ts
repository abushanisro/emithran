import JSZip from 'jszip';

import { MAX_UPLOAD_BYTES, validateUpload } from './validate-upload';

async function zipOf(files: Record<string, Buffer | string>, deflate = true): Promise<Buffer> {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(files)) zip.file(name, content, { createFolders: false });
  return zip.generateAsync({ type: 'nodebuffer', compression: deflate ? 'DEFLATE' : 'STORE' });
}

const code = (name: string, bytes: Buffer) => {
  const v = validateUpload(name, bytes);
  return v.ok ? 'ok' : v.code;
};

describe('validateUpload', () => {
  it('rejects an empty file and one over the size cap', () => {
    expect(code('board.csv', Buffer.alloc(0))).toBe('empty');
    expect(code('board.csv', Buffer.alloc(MAX_UPLOAD_BYTES + 1, 0x41))).toBe('too_large');
  });

  it('rejects an extension that is not on the list', () => {
    expect(code('run.exe', Buffer.from('MZ'))).toBe('unsupported_extension');
    expect(code('noextension', Buffer.from('a'))).toBe('unsupported_extension');
  });

  describe('magic numbers: content, not the name, decides', () => {
    describe('board files are judged by content, with the role from the file-role table', () => {
      it('a Gerber layer needs its format statement, and gets its role', () => {
        expect(validateUpload('board.GTL', Buffer.from('G04*\n%FSLAX25Y25*%\n%MOIN*%\n'))).toEqual({ ok: true, format: 'text', role: 'copper_top' });
        expect(code('board.gtl', Buffer.from('just some text, no format statement'))).toBe('magic_mismatch');
        expect(code('board.gtl', Buffer.from([0x25, 0x46, 0x53, 0x00, 0x01]))).toBe('magic_mismatch');
      });

      it('a drill .txt is drill data only when it is Excellon; otherwise it is plain text', () => {
        expect(validateUpload('drill.txt', Buffer.from('M48\n;FILE_FORMAT=2:5\nINCH,LZ\n'))).toEqual({ ok: true, format: 'text', role: 'drill_data' });
        expect(validateUpload('notes.txt', Buffer.from('assembly notes'))).toEqual({ ok: true, format: 'text' });
      });

      it('a drill report is accepted with its role', () => {
        expect(validateUpload('board.DRR', Buffer.from('NCDrill File Report For: board.PCB'))).toEqual({ ok: true, format: 'text', role: 'drill_report' });
      });

      it('an extension that is not in the file-role table is refused, never guessed', () => {
        expect(code('board.gbr', Buffer.from('%FSLAX25Y25*%'))).toBe('unsupported_extension');
        expect(code('board.xyz', Buffer.from('%FSLAX25Y25*%'))).toBe('unsupported_extension');
      });
    });

    it.each([
      ['photo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d]), 'png'],
      ['photo.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 'jpeg'],
      ['drawing.pdf', Buffer.from('%PDF-1.7 ...'), 'pdf'],
      ['bom.csv', Buffer.from('ref,mpn\nR1,RC0603\n'), 'text'],
      ['top.gtl', Buffer.from('%FSLAX46Y46*%\n'), 'text'],
    ])('accepts %s', (name, bytes, format) => {
      expect(validateUpload(name, bytes)).toMatchObject({ ok: true, format });
    });

    it.each([
      ['photo.png', Buffer.from('not a png')],
      ['photo.jpg', Buffer.from([0x00, 0x01, 0x02])],
      ['drawing.pdf', Buffer.from('MZ executable')],
      ['bom.xlsx', Buffer.from('plain text')],
      ['board.zip', Buffer.from('plain text')],
      ['bom.csv', Buffer.concat([Buffer.from('a,b\n'), Buffer.from([0x00, 0x00]), Buffer.from('binary')])],
    ])('rejects %s whose content does not match', (name, bytes) => {
      expect(code(name, bytes)).toBe('magic_mismatch');
    });
  });

  // Measuring an archive is the shared gate's job (application/validate-design-file.spec.ts); here a zip is only recognised.
  it('recognises an archive and an xlsx container by their zip signature', async () => {
    const bytes = await zipOf({ 'top.gtl': 'G04 gerber*\n', 'drill.drl': 'M48\n' });
    expect(validateUpload('gerbers.zip', bytes)).toEqual({ ok: true, format: 'zip' });
    expect(validateUpload('bom.xlsx', bytes)).toEqual({ ok: true, format: 'xlsx' });
  });
});
