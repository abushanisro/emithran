// Load the root .env. On a local development machine its values win over stale shell exports; anywhere else the environment the
// deployment set wins over a stray file (runtime-flags.ts).
import * as dotenv from 'dotenv';
import * as path from 'node:path';
import { apiDocsEnabled, dotenvOverride } from './common/runtime-flags';
// The one local env file lives at the repo root (backend/dist/main.js -> ../../.env). Deployed containers have no file: compose sets the
// variables, and a missing file is not an error.
dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env'), override: dotenvOverride(process.env) });

// Telemetry starts here, after .env is loaded and before http/express are required by the imports below,
// so the instrumentations can patch them. A no-op (and loads no SDK) unless OTEL_EXPORTER_OTLP_ENDPOINT is set.
import { startTelemetry, flushOnTermination } from './telemetry/start';
const telemetry = startTelemetry();
if (telemetry) flushOnTermination(telemetry);

import { NestFactory } from '@nestjs/core';
import { VersioningType, type LogLevel } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { CustomValidationPipe } from './common/pipes/validation.pipe';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { RequestCacheInterceptor } from './common/interceptors/request-cache.interceptor';
import { RequestAuthInterceptor } from './common/interceptors/request-auth.interceptor';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { Logger } from './common/logger/logger.service';
import { DatabaseService } from './common/database/database.service';
import { isAllowedCorsOrigin } from './common/cors-origins';
import { CorrelatedConsoleLogger } from './telemetry/correlated-console-logger';
import { FileErrorConsoleLogger } from './common/logger/file-error-console-logger';
import { startErrorLogCleanup } from './common/logger/error-log-file';
import { httpMetricsMiddleware } from './telemetry/http-metrics.middleware';
import { configureBodyParsers } from './common/http/body-limits';

async function bootstrap() {
  startErrorLogCleanup();
  // Debug lines (one per privileged-client call, hundreds per page load) only with LOG_LEVEL=debug.
  const logLevels: LogLevel[] = process.env.LOG_LEVEL === 'debug' ? ['log', 'warn', 'error', 'debug'] : ['log', 'warn', 'error'];
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    // Nest's own parsers are off: configureBodyParsers installs the only ones, with a small limit (common/http/body-limits.ts).
    bodyParser: false,
    // Same levels either way; with telemetry on, each line also carries the active trace and span id.
    // Errors from every logger are also kept in the rotating error file (common/logger/error-log-file.ts).
    logger: telemetry ? new CorrelatedConsoleLogger({ logLevels }) : new FileErrorConsoleLogger({ logLevels }),
  });

  const configService = app.get(ConfigService);
  const logger = app.get(Logger);

  // First middleware, so it times (and counts) every request, including ones rejected by guards.
  if (telemetry) app.use(httpMetricsMiddleware);

  // No global prefix - all controllers use explicit prefixes
  // AppController uses no prefix for root routes
  
  // Bodies are parsed before any guard runs, so the limit is small for every route; a larger body gets 413 unread.
  configureBodyParsers(app);

  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  // Enhanced security headers
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'https:'],
        },
      },
      hsts: {
        maxAge: 31536000, // 1 year
        includeSubDomains: true,
        preload: true,
      },
      frameguard: {
        action: 'deny', // Prevent clickjacking
      },
      noSniff: true, // Prevent MIME type sniffing
      xssFilter: true, // Enable XSS filter
      referrerPolicy: {
        policy: 'strict-origin-when-cross-origin',
      },
    }),
  );

  app.enableCors({
    origin: (requestOrigin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      callback(
        null,
        isAllowedCorsOrigin(requestOrigin, {
          nodeEnv: process.env.NODE_ENV,
          corsOrigin: configService.get<string>('CORS_ORIGIN'),
          railwayPublicDomain: process.env.RAILWAY_PUBLIC_DOMAIN,
        }),
      );
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Request-ID',
      'X-Correlation-ID',
      'x-correlation-id',
      'X-Client-Version',
      'x-client-version',
      'X-Client-Platform',
      'x-client-platform',
      // W3C Trace Context headers for distributed tracing
      'traceparent',
      'tracestate',
      // Session and user tracking headers
      'x-session-id',
      'x-user-id',
      // Idempotency headers
      'Idempotency-Key',
      'idempotency-key',
      // Development auth bypass headers — never advertised as an accepted transport-layer
      // header unless ALLOW_DEV_AUTH_BYPASS=true outside production, so no other deployment offers this surface.
      ...(app.get(DatabaseService).isDevAuthBypassEnabled()
        ? ['x-auth-bypass', 'x-mock-user', 'x-dev-mode', 'x-mock-user-id', 'x-mock-user-email']
        : []),
    ],
    exposedHeaders: ['X-Request-ID', 'X-Correlation-ID'],
    maxAge: 3600, // Cache preflight for 1 hour
  });

  app.useGlobalPipes(
    new CustomValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: false,
      transformOptions: {
        enableImplicitConversion: false,
      },
    }),
  );

  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(
    new LoggingInterceptor(logger),
    new TransformInterceptor(),
    new RequestCacheInterceptor(),
    new RequestAuthInterceptor(),
  );

  // Test route registration immediately
  setTimeout(async () => {
    logger.log('🧪 Testing route registration...', 'Bootstrap');
    logger.log('✅ Application started successfully', 'Bootstrap');
  }, 1000);
  

  // The API map at /docs is unauthenticated, so production does not mount it unless ENABLE_API_DOCS=true (runtime-flags.ts).
  const docs = apiDocsEnabled(process.env);
  if (docs) {
    const config = new DocumentBuilder()
      .setTitle('mithran API Gateway')
      .setDescription('Manufacturing One-Stop Solution - API Gateway')
      .setVersion('1.0')
      .addBearerAuth()
      .addTag('Authentication')
      .addTag('Projects')
      .addTag('Vendors')
      .addTag('MHR', 'Machine Hour Rate calculations')
      .addTag('LHR', 'Labour Hour Rate database')
      .addTag('Health')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, document);
  }

  // Railway provides PORT environment variable automatically
  const configuredPort = process.env.BACKEND_PORT ?? process.env.PORT; // BACKEND_PORT in the shared local .env; PORT in containers
  const port = configuredPort ? parseInt(configuredPort, 10) : configService.get<number>('PORT', 4000);
  await app.listen(port, '0.0.0.0');

  const publicDomain = process.env.RAILWAY_PUBLIC_DOMAIN;
  const baseUrl = publicDomain ? `https://${publicDomain}` : `http://0.0.0.0:${port}`;
  
  logger.log(`Environment: ${configService.get<string>('APP_ENV', 'local')} | ${backends((name) => configService.get<string>(name))}`, 'Bootstrap');
  logger.log(`API Gateway running on: ${baseUrl}`, 'Bootstrap');
  if (docs) logger.log(`API Documentation: ${baseUrl}/docs`, 'Bootstrap');
}

/** Where data, files and logins actually go, for the startup log. Hosts only: never a key. */
function backends(setting: (name: string) => string | undefined): string {
  const host = (url: string | undefined) => {
    try {
      return url ? new URL(url).host : '(not set)';
    } catch {
      return '(invalid URL)';
    }
  };
  const s3Endpoint = setting('S3_ENDPOINT');
  return `Data: PostgREST ${host(setting('POSTGREST_URL'))} | Files: S3 ${s3Endpoint ? host(s3Endpoint) : 'AWS'} | Login: Auth0 ${setting('AUTH0_DOMAIN') ?? '(not set)'}`;
}

bootstrap();
