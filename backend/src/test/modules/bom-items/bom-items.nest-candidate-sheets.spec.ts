// Nest view candidate sheets: standard sheet + library laser sheets that fit
// the selected laser's bed; the costed sheet always included.
import { BOMItemsService } from '../../../modules/bom-items/bom-items.service';

// Real reference values: standardSheetWidth/Length (migration 479) and the
// distinct fiber-laser nominal sheets in machine_library.csv.
const STANDARD = { widthMm: 1219.2, lengthMm: 2438.4 };
const LIBRARY = [
  { widthMm: 1524, lengthMm: 3048 }, { widthMm: 1500, lengthMm: 3000 },
  { widthMm: 2000, lengthMm: 4000 }, { widthMm: 2024, lengthMm: 4048 }, { widthMm: 2000, lengthMm: 6500 },
];

function service() {
  const svc = Object.create(BOMItemsService.prototype) as BOMItemsService;
  (svc as any).smLookup = { getStandardSheet: async () => STANDARD, getLaserNominalSheetSizes: async () => LIBRARY };
  return svc;
}
const laserWithBed = (x: number, y: number) => ({ selection: { balanced: { candidate: { capability: { maxXMm: x, maxYMm: y } } } } }) as any;
const key = (s: { widthMm: number; lengthMm: number }) => `${s.widthMm}x${s.lengthMm}`;

describe('resolveNestCandidateSheets', () => {
  it('keeps only sheets that fit the selected laser bed (Salvagnini L3-30, 3050 x 1525)', async () => {
    const sheets = await service().resolveNestCandidateSheets(laserWithBed(3050, 1525), null);
    expect(sheets.map(key).sort()).toEqual(['1219.2x2438.4', '1500x3000', '1524x3048']);
  });

  it('a larger bed (Bystronic BySprint 6520, 6614 x 2024) admits the bigger sheets', async () => {
    const sheets = await service().resolveNestCandidateSheets(laserWithBed(6614, 2024), null);
    // 2024 x 4048 fits exactly on the 2024-wide bed (boundary is inclusive).
    expect(sheets.map(key)).toEqual(expect.arrayContaining(['2000x4000', '2000x6500', '2024x4048']));
  });

  it('with no laser bed known, offers every candidate', async () => {
    expect(await service().resolveNestCandidateSheets(undefined, null)).toHaveLength(1 + LIBRARY.length);
  });

  it('always includes the costed sheet, with its own source', async () => {
    const costed = { widthMm: 1250, lengthMm: 2500, source: 'Nominal sheet of "X" (machine library)' };
    const sheets = await service().resolveNestCandidateSheets(laserWithBed(3050, 1525), costed);
    expect(sheets.find((s) => key(s) === '1250x2500')?.source).toBe(costed.source);
  });
});
