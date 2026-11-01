import { CycleTimeLibraryService } from '../../../../modules/process-plan-generator/services/cycle-time-library.service';
import type { DatabaseService } from '../../../../common/database/database.service';

function library(rows: Record<string, number> | null): CycleTimeLibraryService {
  const lib = new CycleTimeLibraryService({} as DatabaseService);
  if (rows) {
    (lib as any).mrrValues = new Map(Object.entries(rows));
    (lib as any).loaded = true;
  }
  return lib;
}

describe('CycleTimeLibraryService.getCncMrr provenance', () => {
  it("returns the material's own library row with no warning", () => {
    expect(library({ 'mill:aluminum': 40000 }).getCncMrr('mill', 'aluminum')).toEqual({ mrrMm3PerMin: 40000, source: 'db' });
  });

  it('flags a carbon-steel row standing in for a missing material', () => {
    const r = library({ 'turn:carbon_steel': 15000 }).getCncMrr('turn', 'stainless');
    expect(r).toMatchObject({ mrrMm3PerMin: 15000, source: 'db_carbon_steel_substitute' });
    expect(r.warning).toContain('carbon-steel rate');
  });

  it('flags the hard-coded baseline instead of returning it as a measured rate', () => {
    const r = library(null).getCncMrr('mill', null);
    expect(r).toMatchObject({ mrrMm3PerMin: 8000, source: 'fallback_hardcoded' });
    expect(r.warning).toContain('ASSUMED');
  });
});
