import { ELECTRONICS_PROCESS_IDS } from './engine.types';
import { ELECTRONICS_ENGINE_REGISTRY } from './registry';
import { EMPTY_RATE_BOOK } from '../rates/rate-book';

import type { BoardFeatureGraph } from '../feature-graph/contract';

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

describe('electronics engine registry', () => {
  it('lists every canonical process id exactly once, except the two engines kept but not registered', () => {
    const ids = ELECTRONICS_ENGINE_REGISTRY.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    const unregistered = ELECTRONICS_PROCESS_IDS.filter((id) => !ids.includes(id));
    // foundation_probe always reported a gap; pcb_fab_drilling is parked (bare PCB is priced from the fab quote).
    expect([...unregistered].sort()).toEqual(['foundation_probe', 'pcb_fab_drilling']);
  });

  describe.each(ELECTRONICS_ENGINE_REGISTRY.map((e) => [e.id, e] as const))('%s', (_id, engine) => {
    it('never reports a silent zero when it has no rates: a gap, or a line with a real cost', () => {
      const input = engine.inputs(board);
      const result = engine.computeCost({ graph: board, input, batchSize: 500, rates: EMPTY_RATE_BOOK });
      if (result.status === 'costed') {
        expect(result.line.totalCost).toBeGreaterThan(0);
      } else if (result.status === 'gap') {
        expect(result.gap.gapType).toBeDefined();
        expect(result.gap.process).not.toBe('');
      }
    });
  });
});
