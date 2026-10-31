import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { ProcessRoutesService } from '../../../modules/process-routes/process-routes.service';
import { MAX_ROUTE_STEPS_PER_REORDER, ReorderProcessRouteStepsDto } from '../../../modules/process-routes/dto/process-route.dto';

const logger = { log: () => undefined, warn: () => undefined, error: () => undefined };
const uuid = (i: number) => `123e4567-e89b-42d3-a456-${String(i).padStart(12, '0')}`;

function serviceWithUpdate(result: { error: { message: string } | null }) {
  const updated: string[] = [];
  const q: any = { from: () => q, update: () => q, eq: async (_c: string, id: string) => { updated.push(id); return result; } };
  const service = new (ProcessRoutesService as any)({ getClient: () => q }, logger);
  service.getSteps = async () => [];
  return { service, updated };
}

describe('ReorderProcessRouteStepsDto (loop-bound injection)', () => {
  it('rejects more step ids than the bound', async () => {
    const dto = plainToInstance(ReorderProcessRouteStepsDto, { stepIds: Array.from({ length: MAX_ROUTE_STEPS_PER_REORDER + 1 }, (_, i) => uuid(i)) });
    expect((await validate(dto)).map((e) => e.property)).toContain('stepIds');
  });

  it('accepts a normal list', async () => {
    const dto = plainToInstance(ReorderProcessRouteStepsDto, { stepIds: [uuid(1), uuid(2)] });
    expect(await validate(dto)).toEqual([]);
  });
});

describe('ProcessRoutesService.reorderSteps', () => {
  it('refuses a non-array or oversized stepIds before looping', async () => {
    const { service, updated } = serviceWithUpdate({ error: null });
    for (const stepIds of [{ length: 1e9 }, 'abc', Array.from({ length: MAX_ROUTE_STEPS_PER_REORDER + 1 }, (_, i) => uuid(i))]) {
      await expect(service.reorderSteps('r1', { stepIds }, 'u', 't')).rejects.toThrow('stepIds must be an array');
    }
    expect(updated).toEqual([]);
  });

  it('numbers the steps in order', async () => {
    const { service, updated } = serviceWithUpdate({ error: null });
    await service.reorderSteps('r1', { stepIds: [uuid(2), uuid(1)] }, 'u', 't');
    expect(updated).toEqual([uuid(2), uuid(1)]);
  });

  it('surfaces a failed update instead of reporting success', async () => {
    const { service } = serviceWithUpdate({ error: { message: 'denied' } });
    await expect(service.reorderSteps('r1', { stepIds: [uuid(1)] }, 'u', 't')).rejects.toThrow('denied');
  });
});
