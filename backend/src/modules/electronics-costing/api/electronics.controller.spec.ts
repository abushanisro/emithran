import { BadRequestException } from '@nestjs/common';

import { MAX_FILES_PER_UPLOAD, checkedUploadFiles, checkedUploadPaths } from './electronics.controller';

const file = (name: string) => ({ originalname: name, buffer: Buffer.from('x') });

describe('upload request checks (type confusion through parameter tampering)', () => {
  it('accepts 1..MAX_FILES_PER_UPLOAD real files', () => {
    expect(checkedUploadFiles([file('a.kicad_pcb')])).toHaveLength(1);
  });

  it('rejects anything that is not a non-empty array of uploaded files', () => {
    for (const bad of [undefined, null, 'a', { length: 1, 0: file('a') }, [], [{ originalname: 'a' }], [{ originalname: ['a'], buffer: Buffer.from('x') }]]) {
      expect(() => checkedUploadFiles(bad)).toThrow(BadRequestException);
    }
  });

  it('bounds the file count', () => {
    const many = Array.from({ length: MAX_FILES_PER_UPLOAD + 1 }, (_, i) => file(`f${i}`));
    expect(() => checkedUploadFiles(many)).toThrow(`at most ${MAX_FILES_PER_UPLOAD} files`);
  });

  it('accepts paths only as a bounded string', () => {
    expect(checkedUploadPaths(undefined)).toBeUndefined();
    expect(checkedUploadPaths('["a/b.txt"]')).toBe('["a/b.txt"]');
    expect(() => checkedUploadPaths(['a/b.txt'])).toThrow('paths must be a JSON string');
    expect(() => checkedUploadPaths({ length: 1 })).toThrow('paths must be a JSON string');
    expect(() => checkedUploadPaths('x'.repeat(60001))).toThrow('at most 60000');
  });
});
