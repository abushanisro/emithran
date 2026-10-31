import { DEFAULT_CAD_ENGINE_URL } from '../common/engine-urls';
import { plainToClass } from 'class-transformer';
import { IsString, IsNumber, IsOptional, validateSync, IsEnum, MinLength, IsIn, Min, Max } from 'class-validator';

enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

class EnvironmentVariables {
  @IsEnum(Environment)
  @IsOptional()
  NODE_ENV: Environment = Environment.Development;

  // Which deployment this is. It names the environment in logs and on /api/health/live, and gates what may run
  // against it: the data-creating e2e suites refuse to start unless this is 'local' or 'stage'. A production process
  // must say 'stage' or 'prd' (never the default 'local'), so a misconfigured deploy fails at boot, not after a release.
  @IsString()
  @IsOptional()
  @IsIn(['local', 'stage', 'prd'])
  APP_ENV: string = 'local';

  // True only when the API is reachable solely through a Cloudflare Tunnel: it then takes the client address from
  // CF-Connecting-IP (see common/client-ip.ts). Never enable it on a server that is directly reachable.
  @IsString()
  @IsOptional()
  @IsIn(['true', 'false'])
  TRUST_CLOUDFLARE_HEADERS: string = 'false';

  @IsNumber()
  @IsOptional()
  PORT: number = 4000;

  // Data: a PostgREST in front of plain Postgres, with tokens this backend signs itself.
  @IsString()
  POSTGREST_URL!: string;

  // The ONE secret PostgREST trusts (its jwt-secret); at least 32 characters. Never shared with the browser.
  @IsString()
  @MinLength(32)
  DB_JWT_SECRET!: string;

  // Files: an S3-compatible bucket (AWS S3, Cloudflare R2, MinIO, SeaweedFS).
  @IsString()
  S3_BUCKET!: string;

  @IsString()
  S3_REGION!: string;

  @IsString()
  S3_ACCESS_KEY_ID!: string;

  @IsString()
  S3_SECRET_ACCESS_KEY!: string;

  // Only for S3-compatible services (R2, MinIO, SeaweedFS); empty for AWS.
  @IsString()
  @IsOptional()
  S3_ENDPOINT?: string;

  @IsString()
  @IsOptional()
  S3_FORCE_PATH_STYLE?: string;

  // Sign-in: Auth0. The backend verifies Auth0 access tokens itself (RS256, issuer, audience).
  @IsString()
  AUTH0_DOMAIN!: string;

  @IsString()
  AUTH0_AUDIENCE!: string;

  // Namespace of the custom claims the post-login Action adds (email, email_verified, sid), e.g. https://emithran.com/
  @IsString()
  AUTH0_CLAIM_NAMESPACE!: string;

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
  CAD_ENGINE_URL: string = DEFAULT_CAD_ENGINE_URL;

  @IsString()
  @IsOptional()
  CAD_ENGINE_API_KEY: string = '';

  // The CAD upload runner (ZIP / STEP assembly upload) polls for queued uploads in this process. Set to 'off' on
  // replicas that should only serve the API.
  @IsString()
  @IsOptional()
  @IsIn(['on', 'off'])
  CAD_UPLOAD_RUNNER: string = 'on';

  // True-shape nesting: 'python' (cad-engine /nest) or 'rust' (the `nester` binary, docs/ASSEMBLY_CORE.md). With 'rust' an unavailable
  // binary falls back to the Python engine until the Rust nester has run in production.
  @IsString()
  @IsOptional()
  @IsIn(['python', 'rust'])
  NESTING_ENGINE: string = 'python';

  // Who analyses an uploaded CAD file: 'python' (this backend calls the Python cad-engine and creates the BOM items) or 'rust'
  // (the Rust cad-runner analyses with the C++ geometry worker; this backend only creates the BOM items). See docs/ASSEMBLY_CORE.md.
  @IsString()
  @IsOptional()
  @IsIn(['python', 'rust'])
  CAD_CORE: string = 'python';

  // Electronics costing job queue. 'table' is the job_queue table (migration 920); 'memory' is for local development only.
  @IsString()
  @IsOptional()
  @IsIn(['table', 'memory'])
  ELECTRONICS_QUEUE_DRIVER: string = 'table';

  // The one upload limit in megabytes (see common/upload-limits.ts). 50 is the Supabase free tier's cap on one stored object.
  @IsNumber()
  @IsOptional()
  @Min(1)
  @Max(500)
  MAX_UPLOAD_MB: number = 50;

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
    if (validatedConfig.APP_ENV === 'local') {
      throw new Error(
        'CONFIGURATION ERROR: APP_ENV must be set to "stage" or "prd" when NODE_ENV=production, so the deployment ' +
        'knows which environment it is (and the e2e suites can refuse to run against prd).'
      );
    }

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
    // sees them. Production uses the job_queue table, so it survives restarts and scales out.
    if (validatedConfig.ELECTRONICS_QUEUE_DRIVER === 'memory') {
      throw new Error(
        'CONFIGURATION ERROR: ELECTRONICS_QUEUE_DRIVER=memory is for local development only. In production set ' +
        'ELECTRONICS_QUEUE_DRIVER=table (the default).'
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
