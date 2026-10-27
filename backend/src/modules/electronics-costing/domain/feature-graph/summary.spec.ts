import { summarizeGraph } from './summary';

import type { BoardFeatureGraph } from './contract';

const board = (over: Partial<BoardFeatureGraph> = {}): BoardFeatureGraph => ({
  contractVersion: '1.3',
  kind: 'board',
  inputTier: 'B',
  reviewStatus: 'needs_review',
  outline: { lengthMm: 139.8, widthMm: 55.6 },
  layers: 2,
  placements: [{ side: 'bottom', packageClass: 'unknown', count: 24, footprint: 'OPT-1206' }],
  thtParts: [{ label: '2001-/-F03-1', count: 168, jointsPerPart: 2 }],
  holes: [{ diameterMm: 1, plated: true, count: 336 }],
  provenance: {},
  unresolved: [],
  ...over,
});

describe('summarizeGraph', () => {
  it('counts through-hole parts as placements, so a part whose mount type was read from the copper is not lost from the card', () => {
    expect(summarizeGraph(board())).toMatchObject({ placementCount: 192, holeCount: 336, assembled: true });
  });

  it('carries the series chains and spacing traced from the copper (contract 1.3)', () => {
    const traced = board({
      fabrication: { minSpacingMm: 0.67 },
      connectivity: {
        netsWithPins: 172,
        pins: 384,
        largestNetPins: 12,
        chainEndNets: 4,
        seriesChains: [{ count: 24, partsPerChain: 8, composition: [{ footprint: '2001-/-F03-1', count: 7 }, { footprint: 'OPT-1206', count: 1 }] }],
      },
    });
    expect(summarizeGraph(traced)).toMatchObject({ seriesChains: 24, minSpacingMm: 0.67 });
  });

  it('leaves them null for a graph without the 1.3 fields, never zero', () => {
    expect(summarizeGraph(board({ contractVersion: '1.2' }))).toMatchObject({ seriesChains: null, minSpacingMm: null });
  });
});
