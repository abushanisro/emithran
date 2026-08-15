import {
  ValidationOptions,
  IsString,
  IsEnum,
  IsOptional,
  Min,
  Max,
  MinLength,
  MaxLength,
  IsBoolean,
  IsNumber,
  IsNotEmpty,
  Matches,
} from 'class-validator';
import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';

/**
 * Enhanced validation decorators with user-friendly error messages
 */

export function IsOptionalString(message?: string, options?: ValidationOptions) {
  return applyDecorators(
    IsOptional(),
    IsString({ message: message || 'This field must be text' })
  );
}

export function IsOptionalEnum(
  enumObject: any,
  message?: string,
  options?: ValidationOptions
) {
  const enumValues = Object.values(enumObject).join(', ');
  return applyDecorators(
    IsOptional(),
    IsEnum(enumObject, {
      message: message || `This field must be one of: ${enumValues}`
    })
  );
}

// Boolean validations
export function IsOptionalBoolean(message?: string, options?: ValidationOptions) {
  return applyDecorators(
    IsOptional(),
    // HTTP query parameters always arrive as strings ("true"/"false"), never real
    // booleans — @IsBoolean() alone rejects them with a 400, and @Type(() =>
    // Boolean) coerces via JS's Boolean(), which incorrectly turns the string
    // "false" into `true`. Coerce explicitly before validating.
    Transform(({ value }) => {
      if (typeof value !== 'string') return value;
      if (value.toLowerCase() === 'true') return true;
      if (value.toLowerCase() === 'false') return false;
      return value;
    }),
    IsBoolean({ message: message || 'This field must be true or false' })
  );
}

export function IsOptionalPrice(
  maxDecimalPlaces: number = 2,
  min?: number,
  max?: number,
  message?: string,
  options?: ValidationOptions
) {
  const decorators = [
    IsOptional(),
    IsNumber({ maxDecimalPlaces }, {
      message: message || `Price must be a valid number with up to ${maxDecimalPlaces} decimal places`
    })
  ];

  if (min !== undefined) {
    decorators.push(
      Min(min, { message: `Price must be ${min} or greater` })
    );
  }

  if (max !== undefined) {
    decorators.push(
      Max(max, { message: `Price must be ${max} or less` })
    );
  }

  return applyDecorators(...decorators);
}

// Custom business validation
export function IsProjectName(message?: string, options?: ValidationOptions) {
  return applyDecorators(
    IsString({ message: 'Project name must be text' }),
    MinLength(2, { message: 'Project name must be at least 2 characters long' }),
    MaxLength(100, { message: 'Project name must be no more than 100 characters long' }),
    Matches(/^[a-zA-Z0-9\s\-_\.–— ’“”\(\)\[\]\/\&\,\:\;]+$/, {
      message: 'Project name can only contain letters, numbers, spaces, hyphens, dashes, underscores, periods, and common punctuation'
    }),
    IsNotEmpty({ message: 'Project name is required' })
  );
}
