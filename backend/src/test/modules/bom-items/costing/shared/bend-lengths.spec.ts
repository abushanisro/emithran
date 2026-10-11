import { realBendLengthsMm } from '../../../../../modules/bom-items/costing/shared/bend-lengths';

const bend = (len: unknown) => ({ bend_length_mm: len });

describe('realBendLengthsMm', () => {
  it('uses the engine list when it has one', () => {
    expect(realBendLengthsMm({ summary: { bendLengths: [40, 90] }, feature_graph_v2: { features: [] } })).toEqual([40, 90]);
  });

  it('falls back to the bend features lengths for an analysis whose list is empty', () => {
    const fg = {
      summary: { bendLengths: [] },
      feature_graph_v2: {
        features: [
          { feature_type: 'StraightBend', occurrences: [bend(30), bend(90.5)] },
          { feature_type: 'StraightBend', occurrences: [bend(30)] },
          { feature_type: 'SimpleHole', occurrences: [bend(5)] },
        ],
      },
    };
    expect(realBendLengthsMm(fg)).toEqual([30, 90.5, 30]);
  });

  it('ignores missing, zero and non-numeric lengths, and answers empty rather than guessing', () => {
    const fg = { feature_graph_v2: { features: [{ feature_type: 'StraightBend', occurrences: [bend(null), bend(0), bend('x'), {}] }] } };
    expect(realBendLengthsMm(fg)).toEqual([]);
    expect(realBendLengthsMm(null)).toEqual([]);
    expect(realBendLengthsMm({})).toEqual([]);
  });
});
