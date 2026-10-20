import { validateFeatureGraph } from './validate';

import type { BoardFeatureGraph, FieldProvenance, HarnessFeatureGraph } from './contract';

const supplied = (note = 'entered by the customer'): FieldProvenance => ({ basis: 'supplied', confidence: 'high', source: { note } });

const board = (over: Partial<BoardFeatureGraph> = {}): BoardFeatureGraph => ({
  contractVersion: '1.1',
  kind: 'board',
  inputTier: 'C',
  reviewStatus: 'needs_review',
  outline: { lengthMm: 84, widthMm: 50, thicknessMm: 1.6 },
  layers: 2,
  sidesPopulated: ['top'],
  placements: [{ side: 'top', packageClass: 'chip_0603', count: 4 }],
  thtParts: [],
  uniquePartNumbers: 1,
  provenance: {
    outline: supplied(),
    layers: supplied(),
    sidesPopulated: supplied(),
    placements: supplied(),
    thtParts: supplied(),
    uniquePartNumbers: supplied(),
  },
  unresolved: [],
  ...over,
});

const harness = (over: Partial<HarnessFeatureGraph> = {}): HarnessFeatureGraph => ({
  contractVersion: '1.1',
  kind: 'harness',
  inputTier: 'B',
  reviewStatus: 'needs_review',
  circuits: [{ id: 'C1', awg: 20, lengthMm: 200, terminalCount: 1, sealCount: 1 }],
  connectors: [],
  provenance: { circuits: supplied('wire list'), connectors: supplied('wire list') },
  unresolved: [],
  ...over,
});

const issues = (input: unknown) => {
  const r = validateFeatureGraph(input);
  return r.valid ? [] : r.issues.map((i) => i.message);
};

describe('validateFeatureGraph', () => {
  it('accepts a well-formed board and harness', () => {
    expect(validateFeatureGraph(board()).valid).toBe(true);
    expect(validateFeatureGraph(harness()).valid).toBe(true);
  });

  it.each([[null], ['text'], [{}], [{ kind: 'panel' }]])('rejects a document without a known kind: %j', (doc) => {
    expect(issues(doc)).toEqual(['kind must be "board" or "harness"']);
  });

  it('rejects a placement on a side that is not populated', () => {
    expect(issues(board({ placements: [{ side: 'bottom', packageClass: 'sot', count: 1 }] }))).toEqual([
      'placement on bottom but that side is not populated',
    ]);
  });

  it('lets a needs_review graph carry an unknown package class but not a confirmed one', () => {
    const placements: BoardFeatureGraph['placements'] = [{ side: 'top', packageClass: 'unknown', count: 2 }];
    expect(validateFeatureGraph(board({ placements })).valid).toBe(true);
    expect(issues(board({ placements, reviewStatus: 'confirmed' }))).toEqual([
      'a confirmed graph cannot contain an unknown package class',
    ]);
  });

  it('rejects a field that is listed as unresolved yet present', () => {
    const base = board();
    expect(
      issues(board({ testPoints: 12, unresolved: [{ field: 'testPoints', reason: 'no netlist' }], provenance: { ...base.provenance, testPoints: supplied() } })),
    ).toEqual(['a field listed as unresolved must be absent, not filled with a guess']);
  });

  it('rejects duplicate harness circuit ids', () => {
    const c = { id: 'C1', awg: 20, lengthMm: 100, terminalCount: 1, sealCount: 1 };
    expect(issues(harness({ circuits: [c, c] }))).toEqual(['duplicate circuit id C1']);
  });

  it('rejects an unsupported contract version', () => {
    expect(validateFeatureGraph({ ...board(), contractVersion: '9.9' }).valid).toBe(false);
  });
});

describe('unresolved fields and optional data', () => {
  it('a nested field listed as unresolved must be absent (outline.thicknessMm)', () => {
    const base = board();
    expect(
      issues(board({ outline: { lengthMm: 84, widthMm: 50 }, unresolved: [{ field: 'outline.thicknessMm', reason: 'not in the Gerber set' }] })),
    ).toEqual([]);
    expect(
      issues(board({ outline: { ...base.outline, thicknessMm: 1.6 }, unresolved: [{ field: 'outline.thicknessMm', reason: 'x' }] })),
    ).toEqual(['a field listed as unresolved must be absent, not filled with a guess']);
  });

  it('placements and thtParts may be present and listed as unresolved: the entry says what is missing', () => {
    expect(issues(board({ unresolved: [{ field: 'thtParts', reason: 'mount type of 2 footprints unknown' }] }))).toEqual([]);
  });

  it('uniquePartNumbers, thickness and depanel are optional, but holes need provenance when present', () => {
    const base = board();
    const { uniquePartNumbers: _u, ...noPart } = base;
    const { uniquePartNumbers: _p, ...provenance } = base.provenance;
    expect(validateFeatureGraph({ ...noPart, provenance }).valid).toBe(true);
    expect(issues({ ...noPart, provenance, holes: [{ diameterMm: 0.6, plated: true, count: 224 }] })).toEqual(['provenance missing for holes']);
  });

  it('findings are accepted with a severity and a message', () => {
    expect(validateFeatureGraph(board({ findings: [{ field: 'holes', severity: 'info', message: 'matches the drill report' }] })).valid).toBe(true);
    expect(validateFeatureGraph({ ...board(), findings: [{ severity: 'loud', message: 'x' }] }).valid).toBe(false);
  });
});

describe('feature provenance', () => {
  const withProvenance = (patch: Record<string, FieldProvenance | undefined>, over: Partial<BoardFeatureGraph> = {}) => {
    const base = board(over);
    const provenance: Record<string, FieldProvenance> = { ...base.provenance };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete provenance[k];
      else provenance[k] = v;
    }
    return { ...base, provenance };
  };
  const measured = (file: string): FieldProvenance => ({ basis: 'measured', confidence: 'high', source: { file } });

  it('rejects a graph with a data field that has no provenance entry', () => {
    expect(issues(withProvenance({ layers: undefined }))).toEqual(['provenance missing for layers']);
  });

  it('rejects provenance for a field the graph does not have', () => {
    expect(issues(withProvenance({ testPoints: supplied() }))).toEqual([
      'provenance for testPoints, which is not a data field present in the graph',
    ]);
  });

  it('a measured field must name a source file that is listed, and the parser that read it', () => {
    expect(issues(withProvenance({ outline: { basis: 'measured', confidence: 'high' } }))).toEqual([
      'a measured field must name the source file it was read from',
      'a measured field needs the extraction parser (extraction.parserId and parserVersion)',
    ]);
    expect(issues(withProvenance({ outline: measured('edge.gbr') }, { extraction: { parserId: 'p', parserVersion: '1' } }))).toEqual([
      'source file edge.gbr is not listed in sourceFiles',
    ]);
    expect(
      validateFeatureGraph(withProvenance({ outline: measured('edge.gbr') }, { sourceFiles: ['edge.gbr'], extraction: { parserId: 'p', parserVersion: '1' } })).valid,
    ).toBe(true);
  });

  it('a supplied field needs a file or a note saying who stated it', () => {
    expect(issues(withProvenance({ layers: { basis: 'supplied', confidence: 'high' } }))).toEqual([
      'a supplied field must name a source file or give a note saying who stated it',
    ]);
  });

  it('a derived field must say what it came from, which must be present data, never itself', () => {
    const derived = (derivedFrom?: string[]): FieldProvenance => ({ basis: 'derived', confidence: 'high', ...(derivedFrom ? { derivedFrom } : {}) });
    expect(issues(withProvenance({ sidesPopulated: derived() }))).toEqual(['a derived field must say what it was derived from']);
    expect(issues(withProvenance({ sidesPopulated: derived(['sidesPopulated']) }))).toEqual(['a field cannot be derived from itself']);
    expect(issues(withProvenance({ sidesPopulated: derived(['testPoints']) }))).toEqual([
      'derived from testPoints, which is not a data field present in the graph',
    ]);
    expect(validateFeatureGraph(withProvenance({ sidesPopulated: derived(['placements']) })).valid).toBe(true);
  });

  it('derivedFrom is only for derived fields', () => {
    expect(issues(withProvenance({ layers: { ...supplied(), derivedFrom: ['outline'] } }))).toEqual(['derivedFrom is only for derived fields, not supplied']);
  });

  it('a graph with no provenance object at all is rejected by the schema', () => {
    const { provenance: _omit, ...rest } = board();
    expect(validateFeatureGraph(rest).valid).toBe(false);
  });

  it('rejects an unknown basis or confidence', () => {
    expect(validateFeatureGraph(withProvenance({ layers: { basis: 'guessed', confidence: 'high' } as unknown as FieldProvenance })).valid).toBe(false);
    expect(validateFeatureGraph(withProvenance({ layers: { ...supplied(), confidence: 'certain' } as unknown as FieldProvenance })).valid).toBe(false);
  });

  it('applies to harnesses too', () => {
    const h = harness();
    const { connectors: _drop, ...provenance } = h.provenance;
    expect(issues({ ...h, provenance })).toEqual(['provenance missing for connectors']);
  });
});
