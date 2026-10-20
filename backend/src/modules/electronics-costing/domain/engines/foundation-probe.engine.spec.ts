import { FoundationProbeEngine } from './foundation-probe.engine';

import type { BoardFeatureGraph, HarnessFeatureGraph } from '../feature-graph/contract';

const board: BoardFeatureGraph = {
  contractVersion: '1.1',
  kind: 'board',
  inputTier: 'C',
  reviewStatus: 'needs_review',
  outline: { lengthMm: 84, widthMm: 50, thicknessMm: 1.6 },
  layers: 2,
  sidesPopulated: ['top'],
  placements: [],
  thtParts: [],
  uniquePartNumbers: 0,
  provenance: {},
  unresolved: [],
};

const harness: HarnessFeatureGraph = {
  contractVersion: '1.1',
  kind: 'harness',
  inputTier: 'B',
  reviewStatus: 'needs_review',
  circuits: [{ id: 'C1', awg: 20, lengthMm: 200, terminalCount: 1, sealCount: 1 }],
  connectors: [],
  provenance: {},
  unresolved: [],
};

describe('FoundationProbeEngine', () => {
  const engine = new FoundationProbeEngine();

  it('applies to boards and harnesses alike', () => {
    expect(engine.applies()).toBe(true);
  });

  it.each([
    ['board', board],
    ['harness', harness],
  ])('reports an unsupported-operation gap for a %s, never a cost', (_name, graph) => {
    const result = engine.computeCost();
    expect(result.status).toBe('gap');
    if (result.status === 'gap') {
      expect(result.gap).toMatchObject({ gapType: 'unsupported_operation', process: 'Foundation probe' });
    }
    expect(graph.kind).toBeDefined();
  });

  it('is capable of anything (it prices nothing)', () => {
    expect(engine.checkCapability()).toEqual({ capable: true });
  });
});
