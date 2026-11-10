import { describe, expect, it } from 'vitest';

import type { AssemblyNode, CadUpload } from '@/lib/api/cad-uploads';
import { describeFailure, isInFlight, rejectedFileMessage, summarize, visibleRows } from '@/lib/cad-uploads/upload-view';

const node = (name: string, kind: AssemblyNode['kind'], quantity = 1, children: AssemblyNode[] = []): AssemblyNode => ({
  definition: name, name, kind, quantity, file: 'a.step', children,
});

function withResult(u: CadUpload): NonNullable<CadUpload['result']> {
  if (!u.result) throw new Error('fixture has a result');
  return u.result;
}

const upload = (over: Partial<CadUpload> = {}): CadUpload => ({
  id: 'u1', bomId: 'b1', fileName: 'pack.zip', status: 'done', attempts: 1, errorCode: null, errorDetail: null, createdItemIds: ['i1', 'i2'],
  result: { skipped: [], report: { status: 'complete', inputs: [{ file: 'a.step', status: 'ok', inside: null }], assembly: [], parts: [{ id: 'p', name: 'P', quantityTotal: 2 }], problems: [] } },
  ...over,
});

describe('isInFlight', () => {
  it('is true only while the job can still change', () => {
    expect([isInFlight('queued'), isInFlight('running'), isInFlight('done'), isInFlight('failed'), isInFlight(undefined)]).toEqual([true, true, false, false, false]);
  });
});

describe('describeFailure', () => {
  it('gives a plain sentence per code and appends the recorded detail', () => {
    expect(describeFailure({ errorCode: 'no_step_files', errorDetail: null })).toContain('Export your parts as STEP');
    expect(describeFailure({ errorCode: 'engine_rejected', errorDetail: 'x.step: only STEP files are supported' })).toBe('The CAD engine refused these files. x.step: only STEP files are supported');
  });
  it('shows what the zip held as the server recorded it, without repeating itself', () => {
    const detail = 'The archive holds no STEP files. It holds 9 .pdf. Export your parts as STEP (AP242) and zip those.';
    expect(describeFailure({ errorCode: 'no_step_files', errorDetail: detail })).toBe(detail);
  });
  it('shows an archive of archives as the server named it, not as "holds no files"', () => {
    const detail = 'The archive holds only Pack.rar, and an archive inside an archive is not unpacked. Unpack it and zip the files it holds.';
    expect(describeFailure({ errorCode: 'archive_empty', errorDetail: detail })).toBe(detail);
  });
  it('never shows an empty message for an unknown code', () => {
    expect(describeFailure({ errorCode: 'something_new', errorDetail: null })).toBe('Processing failed.');
  });
});

describe('rejectedFileMessage', () => {
  it('names an archive it cannot read and says what to upload instead', () => {
    expect(rejectedFileMessage({ name: 'EMUSKI_sheet metal.rar', size: 10 }, 50)).toBe(
      'EMUSKI_sheet metal.rar is a .rar archive, which is not read. Unpack it and upload a .zip of the STEP files.',
    );
    expect(rejectedFileMessage({ name: 'parts.tar.gz', size: 10 }, 50)).toContain('a .gz archive');
  });
  it('sends native CAD to a STEP export, and names the size limit for a file over it', () => {
    expect(rejectedFileMessage({ name: 'Top.SLDASM', size: 10 }, 50)).toBe('Top.SLDASM is a native CAD file. Export it as STEP (AP242) and upload that.');
    expect(rejectedFileMessage({ name: 'big.zip', size: 51 * 1024 * 1024 }, 50)).toBe('big.zip is larger than 50 MB.');
  });
  it('says what it accepts for anything else', () => {
    expect(rejectedFileMessage({ name: 'notes.txt', size: 10 }, 50)).toBe('notes.txt: upload a .zip of STEP files, or a .step / .stp file.');
  });
});

describe('summarize', () => {
  it('counts items and distinct parts', () => {
    expect(summarize(upload())).toEqual({ items: 2, distinctParts: 1, warnings: [] });
  });
  it('warns about unreadable files, files already inside an assembly, skipped files and invalid geometry', () => {
    const u = upload();
    const result = withResult(u);
    result.report.inputs = [
      { file: 'bad.step', status: 'unreadable', inside: null },
      { file: 'box.step', status: 'ok', inside: 'asm.step' },
    ];
    result.skipped = [{ path: 'notes.txt', reason: 'not a STEP file' }];
    result.report.problems = [{ part: 'p', code: 'invalid_geometry' }, { part: 'q', code: 'invalid_geometry' }];
    expect(summarize(u).warnings).toEqual([
      'bad.step could not be read and was left out.',
      'box.step is already part of asm.step, so it was not added twice.',
      'notes.txt was skipped (not a STEP file).',
      '2 parts have geometry the CAD engine flags as invalid.',
    ]);
  });
  it('is empty for an upload with no result yet', () => {
    expect(summarize(upload({ status: 'queued', result: null, createdItemIds: [] }))).toEqual({ items: 0, distinctParts: 0, warnings: [] });
  });
});

describe('visibleRows', () => {
  const tree = [node('Top', 'assembly', 1, [node('Sub', 'assembly', 2, [node('Box', 'part', 2)]), node('Cyl', 'part')])];
  it('lists the whole tree with depth and quantity', () => {
    expect(visibleRows(tree, new Set()).map((r) => [r.key, r.depth, r.name, r.quantity])).toEqual([
      ['0', 0, 'Top', 1], ['0.0', 1, 'Sub', 2], ['0.0.0', 2, 'Box', 2], ['0.1', 1, 'Cyl', 1],
    ]);
  });
  it('hides the children of a collapsed node but keeps the node', () => {
    expect(visibleRows(tree, new Set(['0.0'])).map((r) => r.name)).toEqual(['Top', 'Sub', 'Cyl']);
    expect(visibleRows(tree, new Set(['0'])).map((r) => r.name)).toEqual(['Top']);
  });
});
