import { CastingReferenceService } from '../../../../../modules/bom-items/costing/casting/casting-reference.service';
import {
  CASTING_REFERENCE_SOURCE_VERSION,
  SAND_CASTING_REFERENCE_SOURCE_VERSION,
} from '../../../../../modules/bom-items/costing/casting/casting-reference';

/** A fake PostgREST client that records every filter and answers from `tables[table]`. */
function fakeClient(answer: (table: string, filters: Record<string, unknown>) => { data: unknown; error: null | { message: string } }) {
  const calls: Array<{ table: string; filters: Record<string, unknown> }> = [];
  const client = {
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      const chain: any = {
        select: () => chain,
        eq: (c: string, v: unknown) => ((filters[c] = v), chain),
        in: (c: string, v: unknown) => ((filters[c] = v), chain),
        or: (_: string) => chain,
        limit: () => chain,
        then: (resolve: (r: unknown) => unknown) => {
          calls.push({ table, filters });
          return Promise.resolve(answer(table, filters)).then(resolve);
        },
      };
      return chain;
    },
  };
  return { client, calls };
}

const sandRows = [
  { key: 'lookupTables_Component_tblMinHoleDiameter', raw: { rows: [{ 'Material Type': 'Aluminum', 'Min Hole Diameter (mm)': 4.8, 'Process Name': 'Sand Casting' }] } },
  { key: 'lookupTables_Component_tblWallThickness', raw: { rows: [{ 'Material Type': 'Aluminum', 'Maximum Wall Thickness (mm)': 1016, 'Minimum Wall Thickness (mm)': 3, 'Process Name': 'Sand Casting' }] } },
];

describe('CastingReferenceService castability by process', () => {
  it('reads sand-casting limits from the sand-casting source version, once', async () => {
    const { client, calls } = fakeClient(() => ({ data: sandRows, error: null }));
    const service = new CastingReferenceService({ getPrivilegedClient: () => client } as never);
    const first = await service.getCastabilityReference('sand_casting');
    await service.getCastabilityReference('sand_casting');
    expect(first.reference?.minHoleDiameter).toEqual([{ materialType: 'Aluminum', process: 'Sand Casting', diameterMm: 4.8 }]);
    expect(calls).toHaveLength(1); // cached after the first successful read
    expect(calls[0]!.filters['source_version']).toBe(SAND_CASTING_REFERENCE_SOURCE_VERSION);
    expect(SAND_CASTING_REFERENCE_SOURCE_VERSION).not.toBe(CASTING_REFERENCE_SOURCE_VERSION);
  });

  it('does not cache a failed read, and names what is missing', async () => {
    let fail = true;
    const { client } = fakeClient(() => (fail ? { data: null, error: { message: 'down' } } : { data: [], error: null }));
    const service = new CastingReferenceService({ getPrivilegedClient: () => client } as never);
    expect((await service.getCastabilityReference('sand_casting')).missing[0]).toMatch(/down/);
    fail = false;
    const empty = await service.getCastabilityReference('sand_casting');
    expect(empty.reference).toBeNull();
    expect(empty.missing.join(' ')).toMatch(/not staged/);
  });

  it('looks a material up in the group of its own process', async () => {
    for (const [process, group] of [['sand_casting', 'Sand Casting'], ['die_casting', 'Die Casting']] as const) {
      const { client, calls } = fakeClient(() => ({ data: [], error: null }));
      await new CastingReferenceService({} as never).getMaterial(client as never, 'AA 356', process);
      expect(calls[0]!.filters['material_group']).toBe(group);
    }
  });

  it('judges a material by die casting unless told otherwise', async () => {
    const { client, calls } = fakeClient(() => ({ data: [], error: null }));
    await new CastingReferenceService({} as never).getMaterial(client as never, 'ZA-8');
    expect(calls[0]!.filters['material_group']).toBe('Die Casting');
  });
});
