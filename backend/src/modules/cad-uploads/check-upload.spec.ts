import { MAX_CAD_FILE_BYTES } from '../../common/upload-limits';

import { checkUpload, noStepFilesMessage, skipReason } from './check-upload';

const STEP = Buffer.from('ISO-10303-21;\nHEADER;');
const ZIP = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(30)]);

describe('checkUpload', () => {
  it('accepts a zip and a STEP file by their content', () => {
    expect(checkUpload('pack.ZIP', ZIP)).toEqual({ ok: true, kind: 'zip' });
    expect(checkUpload('part.stp', STEP)).toEqual({ ok: true, kind: 'step' });
    expect(checkUpload('part.step', Buffer.concat([Buffer.from('﻿  \n'), STEP]))).toEqual({ ok: true, kind: 'step' });
  });

  it('refuses a name that lies about its content', () => {
    expect(checkUpload('part.step', Buffer.from('<html>'))).toMatchObject({ ok: false, code: 'not_a_step' });
    expect(checkUpload('pack.zip', Buffer.from('not a zip at all'))).toMatchObject({ ok: false, code: 'not_a_zip' });
  });

  it('tells the user to export native CAD as STEP', () => {
    expect(checkUpload('Gearbox.SLDASM', STEP)).toMatchObject({ ok: false, code: 'native_cad_not_supported', message: expect.stringContaining('STEP') });
  });

  it('accepts a file exactly at the upload limit and refuses one a byte over (the free tier cap, from MAX_UPLOAD_MB)', () => {
    const header = Buffer.from('ISO-10303-21;');
    const atLimit = Buffer.concat([header, Buffer.alloc(MAX_CAD_FILE_BYTES - header.length)]);
    expect(checkUpload('big.step', atLimit)).toEqual({ ok: true, kind: 'step' });
    expect(checkUpload('big.step', Buffer.concat([atLimit, Buffer.alloc(1)]))).toMatchObject({ ok: false, code: 'file_too_large' });
  });

  it('refuses empty and unknown files', () => {
    expect(checkUpload('a.step', Buffer.alloc(0))).toMatchObject({ ok: false, code: 'empty_file' });
    expect(checkUpload('notes.txt', STEP)).toMatchObject({ ok: false, code: 'unsupported_type' });
  });

  it('names an archive it cannot read and says what to upload instead', () => {
    expect(checkUpload('EMUSKI_sheet metal.rar', Buffer.from('Rar!\x1a\x07\x01\x00'))).toEqual({
      ok: false,
      code: 'unsupported_type',
      message: 'EMUSKI_sheet metal.rar is a .rar archive, which is not read. Unpack it and upload a .zip of the STEP files.',
    });
    expect(checkUpload('parts.7z', STEP)).toMatchObject({ ok: false, code: 'unsupported_type', message: expect.stringContaining('a .7z archive') });
  });
});

describe('noStepFilesMessage', () => {
  const advice = 'Export your parts as STEP (AP242) and zip those.';

  it('names the kinds of file the zip does hold, most common first', () => {
    expect(noStepFilesMessage(['P/P01.pdf', 'P/P02.PDF', 'P/readme.txt'])).toBe(`The archive holds no STEP files. It holds 2 .pdf, 1 .txt. ${advice}`);
  });

  it('shows native CAD by its extension, so the user sees why it was not read', () => {
    expect(noStepFilesMessage(['a/Top.SLDASM', 'a/Bolt.sldprt'])).toBe(`The archive holds no STEP files. It holds 1 .sldasm, 1 .sldprt. ${advice}`);
  });

  it('says only what is certain when nothing else was found', () => {
    expect(noStepFilesMessage([])).toBe(`The archive holds no STEP files. ${advice}`);
  });

  it('names the archive inside the zip to unpack, since the parts are most likely in it', () => {
    expect(noStepFilesMessage([], ['EMUSKI_sheet metal.rar/EMUSKI_sheet metal.rar'])).toBe(
      'The archive holds no STEP files. It holds 1 .rar. An archive inside a zip is not unpacked: unpack EMUSKI_sheet metal.rar and zip the STEP files it holds.',
    );
    expect(noStepFilesMessage(['P/readme.pdf'], ['P/a.zip', 'P/b.7z', 'P/c.rar', 'P/d.rar'])).toBe(
      'The archive holds no STEP files. It holds 2 .rar, 1 .7z, 1 .pdf, 1 .zip. An archive inside a zip is not unpacked: unpack a.zip, b.7z, c.rar and 1 more and zip the STEP files they hold.',
    );
  });
});

describe('skipReason', () => {
  it('names a native CAD format and says to export it as STEP', () => {
    expect(skipReason('Plastic Components/Front Top Cover.x_t')).toBe('a native CAD file (.x_t), not read: export it as STEP (AP242) and upload that');
    expect(skipReason('Pack/Housing.SLDPRT')).toBe('a native CAD file (.sldprt), not read: export it as STEP (AP242) and upload that');
  });

  it('keeps the plain reason for a drawing or a note', () => {
    expect(skipReason('Drawings/P01.pdf')).toBe('not a STEP file');
    expect(skipReason('readme.txt')).toBe('not a STEP file');
  });
});
