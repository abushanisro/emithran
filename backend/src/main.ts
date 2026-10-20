// Load .env with override:true so .env values always win over system env vars
import * as dotenv from 'dotenv';
dotenv.config({ override: true });

// Telemetry starts here, after .env is loaded and before http/express are required by the imports below,
// so the instrumentations can patch them. A no-op (and loads no SDK) unless OTEL_EXPORTER_OTLP_ENDPOINT is set.
import { startTelemetry, flushOnTermination } from './telemetry/start';
const telemetry = startTelemetry();
if (telemetry) flushOnTermination(telemetry);

import { NestFactory } from '@nestjs/core';
import { VersioningType, type LogLevel } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { CustomValidationPipe } from './common/pipes/validation.pipe';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { RequestCacheInterceptor } from './common/interceptors/request-cache.interceptor';
import { RequestAuthInterceptor } from './common/interceptors/request-auth.interceptor';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { Logger } from './common/logger/logger.service';
import { SupabaseService } from './common/supabase/supabase.service';
import { CorrelatedConsoleLogger } from './telemetry/correlated-console-logger';
import { httpMetricsMiddleware } from './telemetry/http-metrics.middleware';

async function bootstrap() {
  // Debug lines (one per privileged-client call, hundreds per page load) only with LOG_LEVEL=debug.
  const logLevels: LogLevel[] = process.env.LOG_LEVEL === 'debug' ? ['log', 'warn', 'error', 'debug'] : ['log', 'warn', 'error'];
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    // Same levels either way; with telemetry on, each line also carries the active trace and span id.
    logger: telemetry ? new CorrelatedConsoleLogger({ logLevels }) : logLevels,
  });

  const configService = app.get(ConfigService);
  const logger = app.get(Logger);

  // First middleware, so it times (and counts) every request, including ones rejected by guards.
  if (telemetry) app.use(httpMetricsMiddleware);

  // No global prefix - all controllers use explicit prefixes
  // AppController uses no prefix for root routes
  
  // Set body parser limits
  const express = require('express');
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));
  
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
      const allowedOrigins = [
        configService.get('CORS_ORIGIN', 'http://localhost:3000'),
        'http://localhost:3000',
        'http://127.0.0.1:3000',
        // Railway public domain (automatically available in production)
        process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : null,
      ].filter(Boolean);
      const isVercelApp = requestOrigin?.match(/^https:\/\/mithran(-[a-z0-9]+)?\.vercel\.app$/);
      const isEmithranApp = requestOrigin?.match(/^https:\/\/([a-z0-9-]+\.)?emithran\.com$/);
      // Exact match only — a prefix match (e.g. via startsWith) would also let through
      // an origin like "http://localhost:3000.attacker.example".
      if (!requestOrigin || isVercelApp || isEmithranApp || allowedOrigins.includes(requestOrigin)) {
        callback(null, true);
      } else {
        callback(null, false);
      }
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
      ...(app.get(SupabaseService).isDevAuthBypassEnabled()
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

  // Railway provides PORT environment variable automatically
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : configService.get<number>('PORT', 4000);
  await app.listen(port, '0.0.0.0');

  const publicDomain = process.env.RAILWAY_PUBLIC_DOMAIN;
  const baseUrl = publicDomain ? `https://${publicDomain}` : `http://0.0.0.0:${port}`;
  
  logger.log(`API Gateway running on: ${baseUrl}`, 'Bootstrap');
  logger.log(`API Documentation: ${baseUrl}/docs`, 'Bootstrap');
}

bootstrap();
