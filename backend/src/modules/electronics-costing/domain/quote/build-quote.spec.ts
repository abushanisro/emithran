import { buildQuote, QUOTE_RESULT_VERSION } from './build-quote';
import { FoundationProbeEngine } from '../engines/foundation-probe.engine';
import { EMPTY_RATE_BOOK, findRates, type RateBook, type RateEntry } from '../rates/rate-book';

import type { ProcessLineCost } from '../../../bom-items/dto/cost-breakdown.dto';
import type { ElectronicsEngine, ElectronicsResult } from '../engines/engine.types';
import type { BoardFeatureGraph } from '../feature-graph/contract';


const board = (over: Partial<BoardFeatureGraph> = {}): BoardFeatureGraph => ({
  contractVersion: '1.1',
  kind: 'board',
  inputTier: 'C',
  reviewStatus: 'needs_review',
  outline: { lengthMm: 84, widthMm: 50, thicknessMm: 1.6 },
  layers: 2,
  sidesPopulated: ['top', 'bottom'],
  placements: [{ side: 'bottom', packageClass: 'chip_0402', count: 4 }],
  thtParts: [],
  uniquePartNumbers: 1,
  provenance: {},
  unresolved: [],
  ...over,
});

const lineOf = (totalCost: number) =>
  ({
    process: 'Test line',
    setupCost: 0,
    runCost: totalCost,
    totalCost,
    cycleTimeMin: 1,
    hourlyRate: 60,
    rateSource: 'mhr_database',
    machineClass: 'test',
    machineName: null,
    commodityCode: null,
  }) as ProcessLineCost;

// A real engine that prices a fixed line, used to exercise the costed path of the kernel
// before any production engine exists. It is not registered anywhere.
function pricingEngine(totalCost: number, applies: (g: BoardFeatureGraph) => boolean = () => true): ElectronicsEngine<null> {
  return {
    id: 'foundation_probe',
    processFamily: 'electronics',
    applies: (g) => g.kind === 'board' && applies(g),
    inputs: () => null,
    checkCapability: () => ({ capable: true }),
    computeCost: (): ElectronicsResult => ({ status: 'costed', line: lineOf(totalCost), ratesUsed: [] }),
  };
}

// An engine that reads its cost from the rate book (cost = the 'test.cycle' value for 'machine-1'),
// and reports a gap when the book has none: the shape every real engine follows.
const rateEngine: ElectronicsEngine<null> = {
  id: 'foundation_probe',
  processFamily: 'electronics',
  applies: () => true,
  inputs: () => null,
  checkCapability: () => ({ capable: true }),
  computeCost: ({ rates }): ElectronicsResult => {
    const [rate] = findRates(rates, 'test.cycle', 'machine-1');
    if (!rate) {
      return {
        status: 'gap',
        gap: { gapType: 'unsupported_operation', process: 'Rate engine', machineClass: 'test', reason: 'no test.cycle rate for machine-1' },
      };
    }
    return { status: 'costed', line: lineOf(rate.value), ratesUsed: [rate] };
  },
};

const rate = (over: Partial<RateEntry> = {}): RateEntry => ({
  kind: 'reference',
  key: 'test.cycle',
  scope: 'machine-1',
  value: 12,
  unit: 's',
  sourceRef: 'memory/Electronics/test.csv',
  ...over,
});
const book = (...entries: RateEntry[]): RateBook => ({ entries });

describe('buildQuote', () => {
  it('stamps the result and contract versions and the graph review status', () => {
    const q = buildQuote(board(), [pricingEngine(10)], 500, EMPTY_RATE_BOOK);
    expect(q).toMatchObject({
      resultVersion: QUOTE_RESULT_VERSION,
      featureGraphContractVersion: '1.1',
      graphKind: 'board',
      inputTier: 'C',
      graphReviewStatus: 'needs_review',
      batchSize: 500,
    });
  });

  it('with only the probe: a gap, no assembly cost, never complete', () => {
    const q = buildQuote(board(), [new FoundationProbeEngine()], 500, EMPTY_RATE_BOOK);
    expect(q.lines).toEqual([]);
    expect(q.gaps).toHaveLength(1);
    expect(q.assemblyCostPerUnit).toBeNull();
    expect(q.complete).toBe(false);
  });

  it('sums the lines when every applicable engine priced', () => {
    const q = buildQuote(board(), [pricingEngine(10), pricingEngine(2.5)], 500, EMPTY_RATE_BOOK);
    expect(q.assemblyCostPerUnit).toBe(12.5);
    expect(q.complete).toBe(true);
  });

  it('never shows a partial sum when one applicable engine reported a gap', () => {
    const q = buildQuote(board(), [pricingEngine(10), new FoundationProbeEngine()], 500, EMPTY_RATE_BOOK);
    expect(q.lines).toHaveLength(1);
    expect(q.gaps).toHaveLength(1);
    expect(q.assemblyCostPerUnit).toBeNull();
    expect(q.complete).toBe(false);
  });

  it('routes first: an engine that does not apply is neither costed nor a gap', () => {
    const bottomOnly = pricingEngine(7, (g) => g.sidesPopulated?.includes('bottom') === true);
    expect(buildQuote(board(), [bottomOnly], 500, EMPTY_RATE_BOOK).assemblyCostPerUnit).toBe(7);
    const topOnly = board({ sidesPopulated: ['top'], placements: [] });
    const q = buildQuote(topOnly, [bottomOnly], 500, EMPTY_RATE_BOOK);
    expect(q.lines).toEqual([]);
    expect(q.gaps).toEqual([]);
    expect(q.complete).toBe(false);
  });

  it.each([[0], [-5], [2.5], [Number.NaN]])('rejects batch size %s', (batch) => {
    expect(() => buildQuote(board(), [pricingEngine(1)], batch, EMPTY_RATE_BOOK)).toThrow(RangeError);
  });
});

describe('rate-versioned results', () => {
  it('cites the exact rates an engine read, and nothing else in the book', () => {
    const used = rate();
    const unused = rate({ key: 'other.speed', scope: 'machine-2', value: 99 });
    const q = buildQuote(board(), [rateEngine], 100, book(used, unused));
    expect(q.ratesUsed).toEqual([used]);
    expect(q.assemblyCostPerUnit).toBe(12);
  });

  it('with no rate in the book the engine reports a gap and the quote cites no rate', () => {
    const q = buildQuote(board(), [rateEngine], 100, EMPTY_RATE_BOOK);
    expect(q.gaps).toHaveLength(1);
    expect(q.ratesUsed).toEqual([]);
    expect(q.assemblyCostPerUnit).toBeNull();
  });

  it('the same rates give the same rateVersion, whatever the order they were listed in', () => {
    const a = rate();
    const b = rate({ key: 'other', scope: 'm2', value: 3 });
    const multi: ElectronicsEngine<null> = {
      ...rateEngine,
      computeCost: (ctx): ElectronicsResult => ({ status: 'costed', line: lineOf(1), ratesUsed: ctx.rates.entries.slice() }),
    };
    const one = buildQuote(board(), [multi], 100, book(a, b)).rateVersion;
    const two = buildQuote(board(), [multi], 100, book(b, a)).rateVersion;
    expect(one).toBe(two);
    expect(one).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([
    ['value', { value: 13 }],
    ['unit', { unit: 'min' }],
    ['currency', { currency: 'USD' }],
    ['source', { sourceRef: 'memory/Electronics/other.csv' }],
    ['record id', { recordId: 'rec-2' }],
    ['record version', { recordVersion: '7' }],
  ])('a change to a used rate %s changes the rateVersion', (_name, change) => {
    const before = buildQuote(board(), [rateEngine], 100, book(rate({ recordId: 'rec-1', recordVersion: '1' })));
    const after = buildQuote(board(), [rateEngine], 100, book(rate({ recordId: 'rec-1', recordVersion: '1', ...change })));
    expect(after.rateVersion).not.toBe(before.rateVersion);
  });

  it('a change to a rate nothing used does not change the rateVersion', () => {
    const base = buildQuote(board(), [rateEngine], 100, book(rate(), rate({ key: 'other', value: 1 })));
    const changed = buildQuote(board(), [rateEngine], 100, book(rate(), rate({ key: 'other', value: 2 })));
    expect(changed.rateVersion).toBe(base.rateVersion);
  });

  it('changing a rate re-prices the same graph; changing the graph does not change the rateVersion', () => {
    const g = board();
    const cheap = buildQuote(g, [rateEngine], 100, book(rate({ value: 12 })));
    const dear = buildQuote(g, [rateEngine], 100, book(rate({ value: 20 })));
    expect(cheap.assemblyCostPerUnit).toBe(12);
    expect(dear.assemblyCostPerUnit).toBe(20);
    const otherGraph = buildQuote(board({ layers: 4 }), [rateEngine], 100, book(rate({ value: 12 })));
    expect(otherGraph.rateVersion).toBe(cheap.rateVersion);
  });

  it('the cost total reconciles with the line breakdown', () => {
    const q = buildQuote(board(), [pricingEngine(4.25), pricingEngine(1.75), pricingEngine(0.5)], 100, EMPTY_RATE_BOOK);
    expect(q.assemblyCostPerUnit).toBe(q.lines.reduce((sum, l) => sum + l.totalCost, 0));
  });
});
