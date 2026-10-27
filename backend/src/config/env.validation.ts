import { plainToClass } from 'class-transformer';
import { IsString, IsNumber, IsOptional, validateSync, IsUrl, IsEnum, MinLength, IsIn } from 'class-validator';

enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

class EnvironmentVariables {
  @IsEnum(Environment)
  @IsOptional()
  NODE_ENV: Environment = Environment.Development;

  @IsNumber()
  @IsOptional()
  PORT: number = 4000;

  // Backend uses server-side environment variables (not NEXT_PUBLIC_ prefix)
  @IsUrl()
  SUPABASE_URL: string;

  @IsString()
  @MinLength(20)
  SUPABASE_ANON_KEY: string;

  @IsString()
  @MinLength(20)
  SUPABASE_SERVICE_KEY: string;

  @IsString()
  @IsOptional()
  CORS_ORIGIN: string = 'http://localhost:3000';

  @IsNumber()
  @IsOptional()
  THROTTLE_TTL: number = 60000;

  @IsNumber()
  @IsOptional()
  THROTTLE_LIMIT: number = 100;

  @IsString()
  @IsOptional()
  @IsIn(['error', 'warn', 'info', 'debug', 'verbose'])
  LOG_LEVEL: string = 'info';

  @IsString()
  @IsOptional()
  CAD_ENGINE_URL: string = 'http://localhost:5000';

  @IsString()
  @IsOptional()
  CAD_ENGINE_API_KEY: string = '';

  // Electronics costing job queue. 'pg-boss' needs ELECTRONICS_QUEUE_DATABASE_URL (a direct
  // Postgres connection string); 'memory' is for local development only.
  @IsString()
  @IsOptional()
  @IsIn(['pg-boss', 'memory'])
  ELECTRONICS_QUEUE_DRIVER: string = 'pg-boss';

  @IsString()
  @IsOptional()
  ELECTRONICS_QUEUE_DATABASE_URL: string = '';

  @IsString()
  @IsOptional()
  @IsIn(['true', 'false'])
  ELECTRONICS_QUEUE_MIGRATE: string = 'true';

  // Live-progress event bus (SSE) across backend instances: Postgres LISTEN/NOTIFY. A session or direct connection
  // (Supabase port 5432); LISTEN does not work through the transaction pooler (6543). Unset: events stay in-process.
  @IsString()
  @IsOptional()
  EVENT_BUS_DATABASE_URL?: string;

  // Development auth bypass opt-in. Off unless explicitly 'true': with it off, a missing or
  // invalid bearer token is a 401 in every environment. ADMIN_FALLBACK_EMAIL alone enables nothing.
  @IsString()
  @IsOptional()
  @IsIn(['true', 'false'])
  ALLOW_DEV_AUTH_BYPASS: string = 'false';

  // Electronics extraction engine (ecad-engine): base URL and API key. Unset: board-set uploads fail with a clear
  // extraction_unavailable error; nothing is guessed.
  @IsString()
  @IsOptional()
  ECAD_ENGINE_URL: string = '';

  @IsString()
  @IsOptional()
  ECAD_ENGINE_API_KEY: string = '';

  @IsString()
  @IsOptional()
  ADMIN_FALLBACK_EMAIL: string = '';

  // Telemetry (OpenTelemetry). Off unless OTEL_EXPORTER_OTLP_ENDPOINT is set. src/telemetry/start.ts reads
  // these directly from process.env, before this validation runs, and disables telemetry (with a warning)
  // on a bad value instead of stopping the API: monitoring must never decide whether the product boots.
  // So they are declared here only to document the supported set, as unvalidated strings.
  // OTEL_EXPORTER_OTLP_HEADERS (the ingest credential) is read by the exporters themselves and is
  // deliberately not declared or logged here.
  @IsString()
  @IsOptional()
  OTEL_EXPORTER_OTLP_ENDPOINT?: string;

  @IsString()
  @IsOptional()
  OTEL_SERVICE_NAME?: string;

  @IsString()
  @IsOptional()
  OTEL_TRACES_SAMPLER_ARG?: string;
}

export function validate(config: Record<string, unknown>) {
  const validatedConfig = plainToClass(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    throw new Error(`Configuration validation error: ${errors.toString()}`);
  }

  if (validatedConfig.NODE_ENV === Environment.Production) {
    if (config.CORS_ORIGIN === 'http://localhost:3000' || config.CORS_ORIGIN === '*') {
      throw new Error(
        'SECURITY ERROR: CORS_ORIGIN must be set to your production domain, not localhost or *'
      );
    }

    if (validatedConfig.ALLOW_DEV_AUTH_BYPASS === 'true') {
      throw new Error(
        'SECURITY ERROR: ALLOW_DEV_AUTH_BYPASS must not be true in production — it turns a missing or ' +
        'invalid token into a signed-in admin. Remove it from the production environment configuration.'
      );
    }

    // The in-memory queue runs jobs inside one process: they are lost on restart and a second backend instance never
    // sees them. Production uses pg-boss (a direct Postgres connection), so it survives restarts and scales out.
    if (validatedConfig.ELECTRONICS_QUEUE_DRIVER === 'memory') {
      throw new Error(
        'CONFIGURATION ERROR: ELECTRONICS_QUEUE_DRIVER=memory is for local development only. In production set ' +
        'ELECTRONICS_QUEUE_DRIVER=pg-boss with ELECTRONICS_QUEUE_DATABASE_URL (a direct Postgres connection string).'
      );
    }

    if (validatedConfig.ADMIN_FALLBACK_EMAIL) {
      throw new Error(
        'SECURITY ERROR: ADMIN_FALLBACK_EMAIL must not be set in production — it is a ' +
        'development-only auth bypass. Remove it from the production environment configuration.'
      );
    }
  }

  return validatedConfig;
}
