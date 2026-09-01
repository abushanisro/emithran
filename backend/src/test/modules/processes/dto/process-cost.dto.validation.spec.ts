import { ArgumentMetadata } from '@nestjs/common';
import { CustomValidationPipe } from '../../../../common/pipes/validation.pipe';
import { CreateProcessCostDto, UpdateProcessCostDto } from '../../../../modules/processes/dto/process-cost.dto';

/**
 * Proves — by actually running the real ValidationPipe used in main.ts, not by
 * reading decorators and assuming — that `benchmarkMhrId` survives NestJS's
 * `whitelist: true` request-body sanitization. `whitelist: true` silently
 * strips any property that has zero class-validator decorators on it; a field
 * added to a DTO without at least one decorator (e.g. @IsOptional()) would be
 * dropped on every real HTTP request even though the DTO "has" the property in
 * TypeScript and every unit test that constructs the DTO by hand would still
 * pass. This is exactly the kind of gap that only shows up at the wire level,
 * which is why the earlier deriveMachineFields() unit tests (which construct
 * CreateProcessCostDto/UpdateProcessCostDto directly, bypassing the pipe
 * entirely) could not have caught it.
 */
describe('ProcessCost DTOs — benchmarkMhrId survives the real request validation pipe', () => {
  // Mirrors main.ts's actual pipe construction exactly (transform: true,
  // whitelist: true, forbidNonWhitelisted: false).
  const pipe = new CustomValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: false,
    transformOptions: { enableImplicitConversion: false },
  });

  it('keeps benchmarkMhrId on CreateProcessCostDto after whitelist stripping', async () => {
    const metadata: ArgumentMetadata = { type: 'body', metatype: CreateProcessCostDto, data: '' };
    const raw = {
      processGroup: 'Sheet Metal',
      processRoute: 'Laser Cutting',
      operation: 'Fiber Laser Cut',
      directRate: 50,
      setupManning: 1,
      setupTime: 10,
      batchSize: 100,
      heads: 1,
      cycleTime: 30,
      partsPerCycle: 1,
      scrap: 5,
      benchmarkMhrId: 42,
    };

    const result = await pipe.transform(raw, metadata);

    expect(result.benchmarkMhrId).toBe(42);
  });

  it('keeps benchmarkMhrId on UpdateProcessCostDto after whitelist stripping', async () => {
    const metadata: ArgumentMetadata = { type: 'body', metatype: UpdateProcessCostDto, data: '' };
    const raw = { benchmarkMhrId: 42 };

    const result = await pipe.transform(raw, metadata);

    expect(result.benchmarkMhrId).toBe(42);
  });

  it('control: confirms whitelist stripping is actually active (an undecorated field IS dropped)', async () => {
    const metadata: ArgumentMetadata = { type: 'body', metatype: UpdateProcessCostDto, data: '' };
    const raw = { benchmarkMhrId: 42, thisFieldDoesNotExistOnTheDto: 'should be stripped' };

    const result = await pipe.transform(raw, metadata);

    expect(result.benchmarkMhrId).toBe(42);
    expect((result as any).thisFieldDoesNotExistOnTheDto).toBeUndefined();
  });

  it('accepts a string benchmarkMhrId (bigint ids are sometimes serialized as strings over JSON)', async () => {
    const metadata: ArgumentMetadata = { type: 'body', metatype: UpdateProcessCostDto, data: '' };
    const raw = { benchmarkMhrId: '42' };

    const result = await pipe.transform(raw, metadata);

    expect(result.benchmarkMhrId).toBe('42');
  });
});
