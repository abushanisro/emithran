import { catalogRowForLine, identityRows } from '../../../../modules/bom-items/process-catalog/catalog-row-for-line';

// Live catalog shapes (process_calculator_mappings, 2026-10-08).
const row = (process_route: string, operation: string, process_group = 'Sheet Metal') => ({ process_group, process_route, operation });

describe('catalogRowForLine', () => {
  it("the line's own operation wins", () => {
    const rows = [row('Bend Brake', 'Bend Brake'), row('Progressive Die', 'Progressive Die Press')];
    expect(catalogRowForLine(rows, 'Progressive Die Press')?.process_route).toBe('Progressive Die');
  });

  it('a class whose rows all share one route gives that route (2_axis_lathe: 8 rows, one route)', () => {
    const rows = ['Facing', 'Rough Turning', 'Finish Turning', 'Boring'].map((op) => row('2 Axis Lathe', op, 'Machining'));
    expect(catalogRowForLine(rows, 'Grooving')?.process_route).toBe('2 Axis Lathe');
  });

  it('ambiguous routes and no operation match -> no route (never the first row)', () => {
    const rows = [row('Bend Brake', 'Bend Brake'), row('Progressive Die', 'Progressive Die Press')];
    expect(catalogRowForLine(rows, 'Something Else')).toBeUndefined();
  });

  it('a single row is used', () => {
    expect(catalogRowForLine([row('Black Oxide', 'Black Oxide', 'Surface Treatment')], 'Black Oxide Rack')?.process_route).toBe('Black Oxide');
  });

  it('no rows -> no route', () => {
    expect(catalogRowForLine([], 'Anything')).toBeUndefined();
  });
});

describe('identityRows', () => {
  const r = (operation: string, is_active: boolean) => ({ operation, is_active });

  it('the reported case: Black Oxide has one real row, inactive (no calculator yet) -> it is the identity', () => {
    expect(identityRows([r('Black Oxide', false)])).toEqual([r('Black Oxide', false)]);
  });

  it('a class with an active row ignores its deactivated duplicates', () => {
    expect(identityRows([r('Laser Cut', true), r('Co2 Laser Cutting', false)])).toEqual([r('Laser Cut', true)]);
  });

  it('no rows -> none', () => {
    expect(identityRows([])).toEqual([]);
  });
});
