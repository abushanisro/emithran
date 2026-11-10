// Waterjet cutting speed against the real database: the machine library carries a mixing tube
// diameter for every waterjet, and the reference machine is on file, so every machine scales.
import type { TestingModule } from '@nestjs/testing';
import { createE2eModule } from './support/create-e2e-app';
import { SheetMetalLookupService } from '../src/modules/bom-items/costing/sheet-metal/lookup/sheet-metal-lookup.service';
import { WATERJET_REFERENCE_MACHINE, waterjetSpeedFactor } from '../src/modules/bom-items/costing/sheet-metal/process/waterjet-engine';

jest.setTimeout(120_000);

process.env.ELECTRONICS_QUEUE_DRIVER = 'memory'; // no queue polling in a read-only spec

describe('[e2e] waterjet speed factor', () => {
  let moduleRef: TestingModule;
  let lookup: SheetMetalLookupService;
  beforeAll(async () => {
    moduleRef = await createE2eModule();
    lookup = moduleRef.get(SheetMetalLookupService, { strict: false });
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('the reference machine is its own factor of 1', async () => {
    const tube = await lookup.getWaterjetMixingTubeMm(WATERJET_REFERENCE_MACHINE);
    expect(tube).toBeGreaterThan(0);
    expect(waterjetSpeedFactor(tube, tube)).toBe(1);
  });

  it('OMAX 55100 (0.762 mm tube) is slower than the reference, Flow Mach 300 (1.016 mm) in between', async () => {
    const ref = await lookup.getWaterjetMixingTubeMm(WATERJET_REFERENCE_MACHINE);
    const omax = waterjetSpeedFactor(await lookup.getWaterjetMixingTubeMm('OMAX 55100'), ref)!;
    const flow300 = waterjetSpeedFactor(await lookup.getWaterjetMixingTubeMm('Flow Mach 300 3020'), ref)!;
    expect(omax).toBeLessThan(flow300);
    expect(flow300).toBeLessThan(1);
  });
});
