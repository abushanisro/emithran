import { pickRegionalMaterialPrice } from '../../../modules/raw-materials/services/raw-material-cost.service';

describe('pickRegionalMaterialPrice', () => {
  it("uses the country's own column when it has a price", () => {
    expect(pickRegionalMaterialPrice([{ cost_usa: '2.5', cost_india: '80' }], 'USA')).toEqual({
      price: 2.5, found: true, currency: 'USD', priceSource: 'local',
    });
  });

  it('flags the India price when the local column is empty, instead of passing it off as local', () => {
    const r = pickRegionalMaterialPrice([{ cost_usa: null, cost_india: '80' }], 'USA');
    expect(r).toMatchObject({ price: 80, found: true, currency: 'INR', priceSource: 'fallback_india' });
    expect(r.warning).toContain('has no USA price');
  });

  it('flags the India price for a location with no price column at all', () => {
    const r = pickRegionalMaterialPrice([{ cost_india: '80' }], 'Brazil');
    expect(r).toMatchObject({ price: 80, currency: 'INR', priceSource: 'fallback_india' });
    expect(r.warning).toContain('no price column for location "Brazil"');
  });

  it('reports India prices as local, never as a fallback', () => {
    expect(pickRegionalMaterialPrice([{ cost_india: '80' }], 'India')).toEqual({
      price: 80, found: true, currency: 'INR', priceSource: 'local',
    });
  });

  it('returns found:false with no invented price when nothing is on file', () => {
    expect(pickRegionalMaterialPrice([{ cost_usa: 0, cost_india: null }], 'USA')).toEqual({
      price: 0, found: false, currency: 'USD', priceSource: 'none',
    });
    expect(pickRegionalMaterialPrice([], 'India')).toMatchObject({ found: false, priceSource: 'none' });
  });
});

// The lookup of a grade's price: the material itself, never another material that shares a word with it.
import { RawMaterialCostService, orderExactNameFirst } from '../../../modules/raw-materials/services/raw-material-cost.service';

describe('orderExactNameFirst', () => {
  it('puts the rows named exactly like the material first (any case), the others after, in the order given', () => {
    const rows = [{ name: 'Generic Aluminum, AA 3105' }, { name: 'generic nylon, type 11 40% glass ' }, { name: 'Nylon, Type 11 40% Glass' }];
    expect(orderExactNameFirst(rows, 'Generic Nylon, Type 11 40% Glass').map((r) => r['name'])).toEqual(['generic nylon, type 11 40% glass ', 'Generic Aluminum, AA 3105', 'Nylon, Type 11 40% Glass']);
    expect(orderExactNameFirst([], 'x')).toEqual([]);
  });
});

describe('the price lookup of a grade (found on a real part: nylon priced as aluminum)', () => {
  const GRADE = 'Generic Nylon, Type 11 40% Glass';
  // what the database holds: the material, other nylons that share its grade, and aluminums that share only the word "Generic"
  const nylon = { name: GRADE, grade: GRADE, cost_usa: '11.486', cost_india: null, density: 1.45 };
  const otherGroup = { name: 'Nylon, Type 11 40% Glass', grade: GRADE, cost_usa: '13.335', cost_india: null, density: 1.45 };
  const aluminum = { name: 'Aluminum, AA 3105', grade: 'Generic Aluminum, AA 3105', cost_usa: '5.864', cost_india: null, density: 2.7 };

  /** A query builder that answers like the database: the exact (no wildcard) filter finds the rows named like the grade, a word filter finds every row containing that word. */
  function service(dbRows: Array<Record<string, unknown>>) {
    const calls: Array<{ or: string[] }> = [];
    const client = {
      from: () => {
        const q: { or: string[] } = { or: [] };
        calls.push(q);
        const builder: Record<string, unknown> = {
          select: () => builder, not: () => builder,
          or: (clause: string) => { q.or.push(clause); return builder; },
          limit: async () => {
            const exactClause = q.or.length === 1 && !q.or[0]!.includes('ilike."%');
            const rows = exactClause
              ? dbRows.filter((r) => r['name'] === GRADE || r['grade'] === GRADE)
              // every .or() is ANDed by the database; a word matches a row when its name or grade contains it
              : dbRows.filter((r) => q.or.every((c) => { const w = /ilike\."%(.+?)%"/.exec(c)![1]!.replace(/\\/g, '').toLowerCase(); return `${r['name']} ${r['grade']}`.toLowerCase().includes(w); }));
            return { data: rows, error: null };
          },
        };
        return builder;
      },
    };
    const svc = Object.create(RawMaterialCostService.prototype) as unknown as { lookupMaterialPrice: (token: string, name: string, country: string) => Promise<ReturnType<typeof pickRegionalMaterialPrice>>; databaseService: unknown; logger: unknown };
    svc.databaseService = { getClient: () => client };
    svc.logger = { error: () => undefined };
    return { svc, calls };
  }

  it('prices the grade from the row of that name, not from a row that shares a word with it', async () => {
    const { svc, calls } = service([aluminum, otherGroup, nylon]);   // the aluminum is first: it was the one priced
    const r = await svc.lookupMaterialPrice('t', GRADE, 'USA');
    expect(r).toMatchObject({ price: 11.486, found: true, currency: 'USD', priceSource: 'local' });
    expect(calls).toHaveLength(1);                                     // the exact match answered; no word search ran
  });

  it('finds the exact row when the name has a percent sign in it (the 40 % is literal, not a wildcard)', async () => {
    const { svc } = service([nylon]);
    expect((await svc.lookupMaterialPrice('t', GRADE, 'USA')).price).toBe(11.486);
  });

  it('with no row of that name, matches only rows that contain every word of the grade: aluminum is never a candidate for a nylon', async () => {
    const { svc, calls } = service([aluminum, { name: 'Nylon, Type 11 40% Glass Fiber', grade: 'Nylon 11 GF', cost_usa: '9.1', cost_india: null, density: 1.4 }]);
    const r = await svc.lookupMaterialPrice('t', 'Nylon Type 11 40% Glass Fiber', 'USA');
    expect(r.price).toBe(9.1);
    expect(calls).toHaveLength(2);                                     // exact found nothing, then the all-words search
    expect(calls[1]!.or.length).toBe(5);                               // one filter per word of three letters or more (Nylon, Type, 40%, Glass, Fiber), ANDed
    const none = await service([aluminum]).svc.lookupMaterialPrice('t', GRADE, 'USA');
    expect(none).toMatchObject({ found: false, price: 0, priceSource: 'none' });   // no price rather than aluminum's
  });
});
