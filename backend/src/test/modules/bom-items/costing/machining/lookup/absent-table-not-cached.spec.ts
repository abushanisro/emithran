import { MachiningLookupService } from '../../../../../../modules/bom-items/costing/machining/lookup/machining-lookup.service';
import { type DatabaseService } from '../../../../../../common/database/database.service';

/** A lookup service whose table reads return `reads` in order (the last one repeats). */
function lookup(reads: { data: { raw: unknown } | null; error: unknown }[]) {
  let calls = 0;
  const read = jest.fn(() => reads[Math.min(calls++, reads.length - 1)]);
  const chain: any = { select: () => chain, eq: () => chain, maybeSingle: () => Promise.resolve(read()) };
  const database = { getPrivilegedClient: () => ({ from: () => chain }) } as unknown as DatabaseService;
  return { service: new MachiningLookupService(database), read };
}

const WALL = [{ MaterialClass: 'aluminum', RecommendedMinWallMm: 0.8, FeasibleMinWallMm: 0.5 }];
const DRILLS = { sizes: [{ drill_size_mm: 3 }] };

describe('MachiningLookupService: a table that is not staged', () => {
  it('is read again on the next request, so a table staged while the process runs is seen without a restart', async () => {
    const { service, read } = lookup([{ data: null, error: null }, { data: { raw: WALL }, error: null }]);
    await expect(service.getMachiningMinWall('aluminum')).resolves.toBeNull();
    await expect(service.getMachiningMinWall('aluminum')).resolves.toEqual({ recommendedMm: 0.8, feasibleMm: 0.5 });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('the same holds for a table staged as an object', async () => {
    const { service } = lookup([{ data: null, error: null }, { data: { raw: DRILLS }, error: null }]);
    await expect(service.getDrillSizesMm()).resolves.toBeNull();
    await expect(service.getDrillSizesMm()).resolves.toEqual([3]);
  });

  it('a staged table is read once', async () => {
    const { service, read } = lookup([{ data: { raw: WALL }, error: null }]);
    await service.getMachiningMinWall('aluminum');
    await service.getMachiningMinWall('plastic');
    expect(read).toHaveBeenCalledTimes(1);
  });
});
