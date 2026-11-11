// One way to build the app for an e2e spec: the real AppModule with the same global setup main.ts applies (prefix and version, validation,
// error filter, response shape). Specs that wired this by hand fell behind when main.ts changed (the /api/v1 prefix), answered 404 where they
// expected 401, and proved nothing. Service-level specs resolve the real service from the real module instead of assembling modules piece by
// piece (each missing provider was another failure). Set any process.env a spec needs BEFORE calling these: ConfigModule reads it once.
import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';

export async function createE2eModule(): Promise<TestingModule> {
  const { AppModule } = await import('../../src/app.module');
  return Test.createTestingModule({ imports: [AppModule] }).compile();
}

export async function createE2eApp(): Promise<INestApplication> {
  const { configureApiPrefix } = await import('../../src/common/http/api-prefix');
  const { GlobalExceptionFilter } = await import('../../src/common/filters/global-exception.filter');
  const { CustomValidationPipe } = await import('../../src/common/pipes/validation.pipe');
  const { TransformInterceptor } = await import('../../src/common/interceptors/transform.interceptor');
  const { RequestAuthInterceptor } = await import('../../src/common/interceptors/request-auth.interceptor');
  const app = (await createE2eModule()).createNestApplication();
  configureApiPrefix(app); // /api/v1/<resource>, the same as main.ts
  app.useGlobalPipes(new CustomValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: false }));
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(new TransformInterceptor(), new RequestAuthInterceptor());
  await app.init();
  return app;
}
