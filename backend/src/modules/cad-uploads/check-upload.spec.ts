import { MAX_CAD_FILE_BYTES } from '../../common/upload-limits';

import { checkUpload } from './check-upload';

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
});
