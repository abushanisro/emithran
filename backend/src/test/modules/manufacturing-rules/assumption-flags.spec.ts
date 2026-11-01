import { MaterialGroupResolver } from '../../../modules/manufacturing-rules/resolvers/material-group.resolver';
import { LaserCuttingCalculator, hardcodedLaserParams } from '../../../modules/manufacturing-rules/calculators/laser-cutting.calculator';
import type { DatabaseService } from '../../../common/database/database.service';
import type { MachiningParams } from '../../../modules/manufacturing-rules/interfaces/operation-calculator.interface';

type Result = { data: unknown; error: { message: string } | null };

/** Every query chain resolves to the next queued result. */
function dbReturning(results: Result[]): DatabaseService {
  const queue = [...results];
  const q: any = {};
  for (const m of ['from', 'select', 'ilike', 'contains', 'eq', 'order', 'limit']) q[m] = () => q;
  q.maybeSingle = async () => queue.shift();
  q.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve(queue.shift()).then(res, rej);
  return { getPrivilegedClient: () => q } as unknown as DatabaseService;
}

const none: Result = { data: null, error: null };

describe('MaterialGroupResolver flags every non-DB group', () => {
  it('marks a DB match as db_exact with no warning', async () => {
    const r = await new MaterialGroupResolver(dbReturning([{ data: { iso_group: 'M', kc1_1_n_mm2: 2000, mc_exponent: 0.2, material_family: 'ss' }, error: null }])).resolve('SS304');
    expect(r).toMatchObject({ isoGroup: 'M', materialGroupSource: 'db_exact' });
    expect(r.warning).toBeUndefined();
  });

  it('flags a name-keyword guess', async () => {
    const r = await new MaterialGroupResolver(dbReturning([none, none, { data: [], error: null }])).resolve('Some Aluminium Alloy');
    expect(r).toMatchObject({ isoGroup: 'N', materialGroupSource: 'fallback_alias_table', kc1_1_n_mm2: null });
    expect(r.warning).toContain('inferred from the name');
  });

  it('flags the carbon-steel assumption for an unknown grade instead of returning it as fact', async () => {
    const r = await new MaterialGroupResolver(dbReturning([none, none, { data: [], error: null }])).resolve('XYZ-999');
    expect(r).toMatchObject({ isoGroup: 'P', kc1_1_n_mm2: 1350, materialGroupSource: 'assumed_default' });
    expect(r.warning).toContain('ASSUMED');
  });

  it('throws on a failed query instead of assuming carbon steel', async () => {
    await expect(new MaterialGroupResolver(dbReturning([{ data: null, error: { message: 'down' } }])).resolve('XYZ')).rejects.toThrow('down');
  });
});

describe('laser calculator hard-coded table', () => {
  it('discloses the table, a substituted ISO group and the nearest thickness', () => {
    const r = hardcodedLaserParams('K', 5, 5);
    expect(r.source).toBe('fallback_hardcoded');
    expect(r.actualPowerKw).toBeNull();
    expect(r.warning).toContain('hard-coded fallback table');
    expect(r.warning).toContain('ISO P (carbon steel) rows were substituted');
    expect(r.warning).toContain('nearest tabulated thickness');
  });

  it('puts the warning on the calculation result when no DB row exists', async () => {
    const calc = new LaserCuttingCalculator(dbReturning([{ data: [], error: null }]));
    const result = await calc.calculate({ isoGroup: 'P' } as MachiningParams, { thicknessMm: 2, cutLengthMm: 1000, pierceCount: 1 });
    expect(result.warnings?.[0]).toContain('hard-coded fallback table');
    expect(result.steps[0]!.expression).toContain('HARD-CODED FALLBACK');
  });

  it('has no warning when the DB has the row', async () => {
    const calc = new LaserCuttingCalculator(dbReturning([{ data: [{ cutting_speed_mm_min: 5000, pierce_time_sec: 0.3, laser_power_kw: 6 }], error: null }]));
    const result = await calc.calculate({ isoGroup: 'P' } as MachiningParams, { thicknessMm: 2, cutLengthMm: 1000, pierceCount: 1 });
    expect(result.warnings).toBeUndefined();
  });

  it('throws on a failed query instead of using the hard-coded table', async () => {
    const calc = new LaserCuttingCalculator(dbReturning([{ data: null, error: { message: 'down' } }]));
    await expect(calc.calculate({ isoGroup: 'P' } as MachiningParams, { thicknessMm: 2, cutLengthMm: 1000, pierceCount: 1 })).rejects.toThrow('down');
  });
});
