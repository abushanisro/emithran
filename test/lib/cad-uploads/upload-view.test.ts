import { describe, expect, it } from 'vitest';

import type { AssemblyNode, CadUpload } from '@/lib/api/cad-uploads';
import { describeFailure, isInFlight, summarize, visibleRows } from '@/lib/cad-uploads/upload-view';

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
    expect(describeFailure({ errorCode: 'no_step_files', errorDetail: 'The archive holds no STEP files.' })).toContain('Export your parts as STEP');
    expect(describeFailure({ errorCode: 'engine_rejected', errorDetail: 'x.step: only STEP files are supported' })).toBe('The CAD engine refused these files. x.step: only STEP files are supported');
  });
  it('never shows an empty message for an unknown code', () => {
    expect(describeFailure({ errorCode: 'something_new', errorDetail: null })).toBe('Processing failed.');
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
