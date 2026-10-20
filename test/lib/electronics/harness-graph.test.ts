import { describe, expect, it } from 'vitest';

import { buildHarnessGraph, type HarnessInput } from '@/lib/electronics/harness-graph';

// A two-circuit cable harness entered by a person (24 AWG, 900 mm, one two-cavity connector).
// Terminal and seal counts are inputs a person enters: the builder never defaults them.
const bomHarness: HarnessInput = {
  circuits: [
    { id: 'C1', awg: '24', lengthMm: '900', colour: '', terminalCount: '1', sealCount: '0' },
    { id: 'C2', awg: '24', lengthMm: '900', colour: '', terminalCount: '1', sealCount: '0' },
  ],
  connectors: [{ id: 'J1', cavities: '2' }],
  sleeveLengthMm: '',
  grommetCount: '',
  spliceCount: '',
  branchCount: '',
  labelCount: '',
  source: 'customer BOM, harness line',
};

describe('buildHarnessGraph', () => {
  it('builds a contract 1.1 harness graph with every present field supplied by the named source', () => {
    const built = buildHarnessGraph(bomHarness);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.graph).toMatchObject({
      contractVersion: '1.1',
      kind: 'harness',
      inputTier: 'C',
      reviewStatus: 'needs_review',
      circuits: [
        { id: 'C1', awg: 24, lengthMm: 900, terminalCount: 1, sealCount: 0 },
        { id: 'C2', awg: 24, lengthMm: 900, terminalCount: 1, sealCount: 0 },
      ],
      connectors: [{ id: 'J1', cavities: 2 }],
    });
    expect(Object.keys(built.graph.provenance).sort()).toEqual(['circuits', 'connectors']);
    expect(built.graph.provenance.circuits).toEqual({ basis: 'supplied', confidence: 'high', source: { note: bomHarness.source } });
  });

  it('leaves out optional fields that were not entered, and gives them no provenance', () => {
    const built = buildHarnessGraph(bomHarness);
    if (!built.ok) throw new Error('expected ok');
    expect(built.graph).not.toHaveProperty('sleeveLengthMm');
    expect(built.graph).not.toHaveProperty('grommetCount');
  });

  it('includes entered optional fields with their own provenance', () => {
    const built = buildHarnessGraph({ ...bomHarness, sleeveLengthMm: '130', grommetCount: '1' });
    if (!built.ok) throw new Error('expected ok');
    expect(built.graph.sleeveLengthMm).toBe(130);
    expect(built.graph.grommetCount).toBe(1);
    expect(Object.keys(built.graph.provenance).sort()).toEqual(['circuits', 'connectors', 'grommetCount', 'sleeveLengthMm']);
  });

  it('never defaults a terminal or seal count: a blank is an error', () => {
    const result = buildHarnessGraph({ ...bomHarness, circuits: [{ ...bomHarness.circuits[0], terminalCount: '', sealCount: '' }] });
    expect(result).toEqual({ ok: false, errors: ['Circuit 1: terminals is required', 'Circuit 1: seals is required'] });
  });

  it('requires a source and at least one circuit', () => {
    expect(buildHarnessGraph({ ...bomHarness, source: '  ' })).toMatchObject({ ok: false, errors: [expect.stringContaining('Say where these values come from')] });
    expect(buildHarnessGraph({ ...bomHarness, circuits: [] })).toMatchObject({ ok: false, errors: ['Enter at least one circuit'] });
  });

  it.each([
    ['a zero AWG', { awg: '0' }, 'Circuit 1: AWG must be a number greater than 0'],
    ['a negative length', { lengthMm: '-5' }, 'Circuit 1: length (mm) must be a number greater than 0'],
    ['three terminals', { terminalCount: '3' }, 'Circuit 1: terminals must be a whole number from 0 to 2'],
    ['a fractional seal count', { sealCount: '0.5' }, 'Circuit 1: seals must be a whole number from 0 to 2'],
    ['text for a length', { lengthMm: 'long' }, 'Circuit 1: length (mm) must be a number greater than 0'],
  ])('rejects %s', (_name, change, message) => {
    const result = buildHarnessGraph({ ...bomHarness, circuits: [{ ...bomHarness.circuits[0], ...change }] });
    expect(result).toEqual({ ok: false, errors: [message] });
  });

  it('rejects a duplicate circuit id and a connector without cavities', () => {
    const dup = buildHarnessGraph({ ...bomHarness, circuits: [bomHarness.circuits[0], bomHarness.circuits[0]] });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.errors).toContain('Circuit 2: id "C1" is used twice');
    const noCavity = buildHarnessGraph({ ...bomHarness, connectors: [{ id: 'J1', cavities: '' }] });
    expect(noCavity).toMatchObject({ ok: false, errors: ['Connector 1: cavities is required'] });
  });
});
