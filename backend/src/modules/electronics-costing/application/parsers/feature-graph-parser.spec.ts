import { PrecomputedGraphParser } from './feature-graph-parser';

import type { UploadRow } from '../../infrastructure/repositories/electronics.repository';

const upload = { kind: 'board', input_tier: 'B' } as UploadRow;
const file = (name: string, content: string) => ({ name, bytes: Buffer.from(content), role: null });
const parser = new PrecomputedGraphParser();

describe('PrecomputedGraphParser', () => {
  it('accepts exactly one json file that carries a contractVersion', () => {
    expect(parser.accepts(upload, [file('graph.json', '{"contractVersion":"1.1","kind":"board"}')])).toBe(true);
  });

  it.each([
    ['not json', [file('graph.json', 'not json')]],
    ['json without a contractVersion', [file('graph.json', '{"kind":"board"}')]],
    ['a json array', [file('graph.json', '[1,2]')]],
    ['a non-json extension', [file('graph.txt', '{"contractVersion":"1.1"}')]],
    ['two files', [file('a.json', '{"contractVersion":"1.1"}'), file('b.json', '{"contractVersion":"1.1"}')]],
    ['a gerber archive', [file('gerbers.zip', 'PK')]],
  ])('declines %s, so the pipeline can say no parser exists', (_name, files) => {
    expect(parser.accepts(upload, files)).toBe(false);
  });

  it('parses the document without interpreting it (the pipeline validates)', async () => {
    const doc = await parser.parse(upload, [file('graph.json', '{"contractVersion":"1.1","kind":"board","extra":1}')]);
    expect(doc).toEqual({ graph: { contractVersion: '1.1', kind: 'board', extra: 1 } });
  });
});
