// The bar of a Multi-Spindle Machining part (multi-spindle-stock.ts) on memory/Multi-Spindle Maching's own rules and tables. The expected
// sizes are the next size of tblPreferredSizes.csv at or above what the part needs, read from the file by hand.
import { stockReferenceFromMemory } from './multi-spindle-fixtures';
import { resolveSandReference } from '../../../../../modules/bom-items/costing/casting/sand/sand-reference';
import {
  barSectionAreaMm2, circumscribedDiameterMm, multiSpindleStockReference, selectBar, unitSystemFor, type MultiSpindleStockReference, type SelectedBar,
} from '../../../../../modules/bom-items/costing/multi-spindle/multi-spindle-stock';

const ref = (): MultiSpindleStockReference => {
  const { reference, missing } = multiSpindleStockReference(stockReferenceFromMemory());
  if (!reference) throw new Error(missing.join('; '));
  return reference;
};
const bar = (r: ReturnType<typeof selectBar>): SelectedBar => {
  if ('missing' in r) throw new Error(r.missing);
  return r;
};

describe('the Multi-Spindle stock rules of memory/Multi-Spindle Maching', () => {
  it('are the data\'s own: round bar 5 % of the OD within 0.79375-3.175 mm and snapped; hex and square flats as supplied; hex not snapped', () => {
    const r = ref();
    expect(r.sizing).toEqual({
      round: { percent: 5, minMm: 0.79375, maxMm: 3.175, snap: true },
      hex: { percent: 0, minMm: 0, maxMm: 0, snap: false },
      square: { percent: 0, minMm: 0, maxMm: 0, snap: true },
    });
    expect([r.barLengthMm, r.facingStockMm]).toEqual([4500, 0.79375]);
    expect(r.partingRings).toEqual([{ diameterMm: 25, ringWidthMm: 2.5 }, { diameterMm: 50, ringWidthMm: 5 }, { diameterMm: 110, ringWidthMm: 8 }]);
    // The "both" rows are the two systems together: each system keeps its own sizes.
    expect(r.preferredSizes.US.find((s) => s.sizeMm === 15.875)).toEqual({ sizeMm: 15.875, label: '5/8"' });
    expect(r.preferredSizes.US.some((s) => s.sizeMm === 16)).toBe(false);
    expect(r.preferredSizes.metric.find((s) => s.sizeMm === 16)).toEqual({ sizeMm: 16, label: '16 mm' });
  });

  it('names what the data lacks instead of assuming it', () => {
    const { reference, missing } = multiSpindleStockReference(resolveSandReference({ variables: [{ key: 'percentStockAllowance', value: '5' }], lookups: [] }));
    expect(reference).toBeNull();
    expect(missing).toEqual(expect.arrayContaining([
      'Multi-Spindle variable minStockAllowance', 'Multi-Spindle variable snapStockSize (true or false)', 'Multi-Spindle lookup tblPreferredSizes (migration 787)',
    ]));
  });
});

describe('selectBar', () => {
  it('Ø14 x 32 mm in USA: 14 + 2 x 0.79375 (the 5 % is below the minimum) = 15.5875 mm, so 5/8" bar, 2.5 mm parting, 35.29375 mm a part', () => {
    const b = bar(selectBar({ outsideMm: 14, form: 'round', lengthMm: 32 }, ref(), unitSystemFor('USA')));
    expect(b).toMatchObject({
      unitSystem: 'US', sizeMm: 15.875, sizeLabel: '5/8" round bar', snapped: true, allowancePerSideMm: 0.79375, partingWidthMm: 2.5,
      facingStockMm: 0.79375, barLengthMm: 4500,
    });
    expect(b.requiredMm).toBeCloseTo(15.5875, 9);
    expect(b.lengthPerPartMm).toBeCloseTo(35.29375, 9);
    expect(b.sectionAreaMm2).toBeCloseTo((Math.PI / 4) * 15.875 ** 2, 9);
  });

  it('the same part in India: metric bar, 16 mm', () => {
    expect(bar(selectBar({ outsideMm: 14, form: 'round', lengthMm: 32 }, ref(), unitSystemFor('India')))).toMatchObject({ unitSystem: 'metric', sizeMm: 16, sizeLabel: '16 mm round bar' });
  });

  it('a large OD takes the maximum allowance: Ø100 + 2 x 3.175 = 106.35 mm, so 4.25" or 110 mm, parted with the 8 mm tool', () => {
    expect(bar(selectBar({ outsideMm: 100, form: 'round', lengthMm: 50 }, ref(), 'US'))).toMatchObject({ sizeMm: 107.95, sizeLabel: '4.25" round bar', allowancePerSideMm: 3.175, partingWidthMm: 8 });
    expect(bar(selectBar({ outsideMm: 100, form: 'round', lengthMm: 50 }, ref(), 'metric'))).toMatchObject({ sizeMm: 110, partingWidthMm: 8 });
  });

  it('hex bar is the part\'s own across flats (flats as supplied, not snapped), parted across its corners', () => {
    const b = bar(selectBar({ outsideMm: 21, form: 'hex', lengthMm: 10 }, ref(), 'US'));
    expect(b).toMatchObject({ sizeMm: 21, sizeLabel: '21 mm hex bar', snapped: false, allowancePerSideMm: 0 });
    expect(b.circumscribedMm).toBeCloseTo(42 / Math.sqrt(3), 9);
    expect(b.partingWidthMm).toBe(2.5); // corners 24.2 mm: the Ø25 tool
    expect(b.sectionAreaMm2).toBeCloseTo((Math.sqrt(3) / 2) * 21 ** 2, 9);
  });

  it('square bar is snapped to the location\'s next size: a 20 mm side is 7/8" in USA and 20 mm in India', () => {
    expect(bar(selectBar({ outsideMm: 20, form: 'square', lengthMm: 10 }, ref(), 'US'))).toMatchObject({ sizeMm: 22.225, sizeLabel: '7/8" square bar' });
    const b = bar(selectBar({ outsideMm: 20, form: 'square', lengthMm: 10 }, ref(), 'metric'));
    expect(b).toMatchObject({ sizeMm: 20, partingWidthMm: 5 }); // corners 28.3 mm: the Ø50 tool
    expect(b.circumscribedMm).toBeCloseTo(20 * Math.SQRT2, 9);
  });

  it('says what is missing: an unmeasured part, or one larger than any preferred size', () => {
    expect(selectBar({ outsideMm: 0, form: 'round', lengthMm: 10 }, ref(), 'US')).toEqual({ missing: 'the part\'s turned diameter (press Refresh analysis so the part is measured)' });
    expect(selectBar({ outsideMm: 10, form: 'round', lengthMm: 0 }, ref(), 'US')).toEqual({ missing: 'the part\'s turned length (press Refresh analysis so the part is measured)' });
    expect(selectBar({ outsideMm: 8000, form: 'round', lengthMm: 10 }, ref(), 'US')).toEqual({ missing: expect.stringContaining('no inch preferred bar size of at least 8006.35 mm') });
  });
});

describe('bar geometry', () => {
  it('section and corner circle per form', () => {
    expect(barSectionAreaMm2('square', 10)).toBe(100);
    expect(circumscribedDiameterMm('round', 10)).toBe(10);
    expect(unitSystemFor('USA')).toBe('US');
    expect(unitSystemFor('India')).toBe('metric');
  });
});
