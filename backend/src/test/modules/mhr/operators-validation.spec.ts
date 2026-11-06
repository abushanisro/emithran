import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';

import { CreateMHRDto, UpdateMHRDto } from '../../../modules/mhr/dto/mhr.dto';

const errorsFor = async (cls: new () => object, operators: number) =>
  (await validate(plainToInstance(cls, { operators }) as object, { skipMissingProperties: true })).filter((e) => e.property === 'operators');

describe('machine operators in the MHR API', () => {
  it.each([[CreateMHRDto], [UpdateMHRDto]])('%p accepts a fraction of an operator (0.5: one operator for two machines)', async (cls) => {
    expect(await errorsFor(cls as never, 0.5)).toEqual([]);
    expect(await errorsFor(cls as never, 1)).toEqual([]);
    expect(await errorsFor(cls as never, 2.5)).toEqual([]);
  });

  it.each([[CreateMHRDto], [UpdateMHRDto]])('%p still refuses zero and negative crews', async (cls) => {
    expect((await errorsFor(cls as never, 0)).length).toBe(1);
    expect((await errorsFor(cls as never, -1)).length).toBe(1);
  });
});
