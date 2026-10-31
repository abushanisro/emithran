import { BadRequestException, type PipeTransform, type Type } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';

import { LHRController } from '../../modules/lhr/lhr.controller';
import { ProcessTrackingController } from '../../modules/production-planning/controllers/process-tracking.controller';

// A bulk endpoint's body is a JSON array. The global ValidationPipe cannot see inside an array type, so each such body must carry its own
// ParseArrayPipe: otherwise any JSON (an object with a huge "length", a string, items of the wrong shape) reaches the service unchecked.
// These run the pipes actually attached to the body parameter, so removing them fails here.
async function parseBody(controller: Type, method: string, body: unknown): Promise<unknown> {
  const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, method) as Record<string, { pipes: PipeTransform[] }>;
  const bodyArg = Object.entries(args).find(([key]) => key.startsWith('3:'))?.[1]; // RouteParamtypes.BODY = 3
  if (!bodyArg?.pipes.length) throw new Error(`${controller.name}.${method} has no pipe on its body`);
  let value = body;
  for (const pipe of bodyArg.pipes) value = await pipe.transform(value, { type: 'body' });
  return value;
}

const lhr = { labourCode: 'L1', labourType: 'Skilled', description: 'Welder', minimumWagePerDay: 100, minimumWagePerMonth: 2600,
  dearnessAllowance: 0, perksPercentage: 0, lhr: 12.5, location: 'IN' };
const progress = { entity_type: 'process', entity_id: '7c9e6679-7425-40de-944b-e07fc1f99ae7', completion_percentage: 40, status: 'IN_PROGRESS' };

describe.each([
  ['LHRController.bulkCreate', LHRController, 'bulkCreate', lhr],
  ['ProcessTrackingController.bulkUpdateProgress', ProcessTrackingController, 'bulkUpdateProgress', progress],
] as const)('%s body', (_name, controller, method, valid) => {
  it('accepts an array of valid items', async () => {
    await expect(parseBody(controller, method, [valid])).resolves.toHaveLength(1);
  });

  it.each([
    ['an object posing as an array', { length: 1e9 }],
    ['a string', 'x'.repeat(10)],
    ['an item of the wrong shape', [{ ...valid, [Object.keys(valid)[0] as string]: 42 }]],
  ])('refuses %s', async (_case, body) => {
    await expect(parseBody(controller, method, body)).rejects.toBeInstanceOf(BadRequestException);
  });
});
