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
  }

  return validatedConfig;
}
