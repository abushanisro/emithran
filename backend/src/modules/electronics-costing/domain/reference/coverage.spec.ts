import { computeCoverage, orphanKeys, type ReferenceRowLike } from './coverage';
import { PLANNED_ENGINES, type PlannedEngine } from './engine-inputs';

const engine = (inputs: string[]): PlannedEngine => ({
  id: 'e',
  label: 'E',
  family: 'pcba',
  inputs: inputs.map((key) => ({ key, unit: 'u', requiredSource: 'datasheet' })),
});
const row = (key: string, status: ReferenceRowLike['status'], scope = 'm1'): ReferenceRowLike => ({ key, scope, status });

describe('computeCoverage', () => {
  it('is a gap while any input has no row, however many others are sourced', () => {
    const [c] = computeCoverage([engine(['a', 'b'])], [row('a', 'sourced')]);
    expect(c.readiness).toBe('gap');
    expect(c.inputs.map((i) => i.status)).toEqual(['sourced', 'gap']);
  });

  it('is pending_confirmation when every input has rows but one only has unconfirmed rows', () => {
    const [c] = computeCoverage([engine(['a', 'b'])], [row('a', 'sourced'), row('b', 'sourced_pending_confirmation')]);
    expect(c.readiness).toBe('pending_confirmation');
  });

  it('is ready only when every input has a confirmed row', () => {
    const [c] = computeCoverage([engine(['a'])], [row('a', 'sourced_pending_confirmation'), row('a', 'sourced', 'm2')]);
    expect(c.readiness).toBe('ready');
    expect(c.inputs[0].scopes).toEqual(['m1', 'm2']);
  });

  it('with no rows at all every engine is a gap', () => {
    expect(computeCoverage(PLANNED_ENGINES, []).every((c) => c.readiness === 'gap')).toBe(true);
  });
});

describe('orphanKeys', () => {
  it('reports staged keys that no planned engine asks for', () => {
    expect(orphanKeys([engine(['a'])], [row('a', 'sourced'), row('zzz', 'sourced')])).toEqual(['zzz']);
  });
});

describe('PLANNED_ENGINES manifest', () => {
  it('has unique engine ids and unique input keys', () => {
    const ids = PLANNED_ENGINES.map((e) => e.id);
    const keys = PLANNED_ENGINES.flatMap((e) => e.inputs.map((i) => i.key));
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('gives every engine at least one input and every input a written way to close it', () => {
    for (const e of PLANNED_ENGINES) {
      expect(e.inputs.length).toBeGreaterThan(0);
      for (const i of e.inputs) {
        expect(i.unit).not.toBe('');
        expect(i.requiredSource).not.toBe('');
      }
    }
  });

  it('covers both verticals', () => {
    expect(new Set(PLANNED_ENGINES.map((e) => e.family))).toEqual(new Set(['pcba', 'harness']));
  });
});
