import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType, BadRequestException, RequestMethod } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { CustomValidationPipe } from './common/pipes/validation.pipe';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { Logger } from './common/logger/logger.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  const configService = app.get(ConfigService);
  const logger = app.get(Logger);

  // No global prefix - all controllers use explicit prefixes
  // AppController uses no prefix for root routes
  
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
        'https://mithran-six.vercel.app',
        // Railway public domain (automatically available in production)
        process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : null,
      ].filter(Boolean);
      if (!requestOrigin || allowedOrigins.includes(requestOrigin) || allowedOrigins.some(o => requestOrigin.startsWith(o))) {
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
      // Development auth bypass headers
      'x-auth-bypass',
      'x-mock-user',
      'x-dev-mode',
      'x-mock-user-id',
      'x-mock-user-email',
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
        enableImplicitConversion: true,
      },
    }),
  );

  app.useGlobalFilters(new GlobalExceptionFilter());
  app.useGlobalInterceptors(
    new LoggingInterceptor(logger),
    new TransformInterceptor(),
  );

  // Debug: Check if routes are working after app startup
  const httpAdapter = app.getHttpAdapter();
  const server = httpAdapter.getInstance();
  
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
    .addTag('LSR', 'Labour Standard Rate database')
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
