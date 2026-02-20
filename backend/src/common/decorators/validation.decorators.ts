import {
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
  IsString,
  IsNotEmpty,
  IsEmail,
  IsUUID,
  IsNumber,
  IsOptional,
  Min,
  Max,
  MinLength,
  MaxLength,
  IsEnum,
  IsBoolean,
  IsDateString,
  IsUrl,
  ArrayMinSize,
  ArrayMaxSize,
  IsArray,
  IsPositive,
  IsInt,
  Matches,
} from 'class-validator';
import { applyDecorators } from '@nestjs/common';

/**
 * Enhanced validation decorators with user-friendly error messages
 */

// String validations
export function IsUserFriendlyString(message?: string, options?: ValidationOptions) {
  return applyDecorators(
    IsString({ message: message || 'This field must be text' }),
    IsNotEmpty({ message: message || 'This field is required' })
  );
}

export function IsOptionalString(message?: string, options?: ValidationOptions) {
  return applyDecorators(
    IsOptional(),
    IsString({ message: message || 'This field must be text' })
  );
}

export function IsUserFriendlyEmail(message?: string, options?: ValidationOptions) {
  return applyDecorators(
    IsEmail({}, { message: message || 'Please enter a valid email address' }),
    IsNotEmpty({ message: 'Email address is required' })
  );
}

export function IsOptionalEmail(message?: string, options?: ValidationOptions) {
  return applyDecorators(
    IsOptional(),
    IsEmail({}, { message: message || 'Please enter a valid email address' })
  );
}

// ID validations
export function IsValidId(message?: string, options?: ValidationOptions) {
  return applyDecorators(
    IsUUID(4, { message: message || 'Please provide a valid ID' }),
    IsNotEmpty({ message: 'ID is required' })
  );
}

export function IsOptionalId(message?: string, options?: ValidationOptions) {
  return applyDecorators(
    IsOptional(),
    IsUUID(4, { message: message || 'Please provide a valid ID' })
  );
}

// Number validations
export function IsUserFriendlyNumber(
  min?: number,
  max?: number,
  message?: string,
  options?: ValidationOptions
) {
  const decorators = [
    IsNumber({}, { message: message || 'This field must be a valid number' }),
    IsNotEmpty({ message: 'This field is required' })
  ];

  if (min !== undefined) {
    decorators.push(
      Min(min, { message: `This field must be ${min} or greater` })
    );
  }

  if (max !== undefined) {
    decorators.push(
      Max(max, { message: `This field must be ${max} or less` })
    );
  }

  return applyDecorators(...decorators);
}

export function IsOptionalNumber(
  min?: number,
  max?: number,
  message?: string,
  options?: ValidationOptions
) {
  const decorators = [
    IsOptional(),
    IsNumber({}, { message: message || 'This field must be a valid number' })
  ];

  if (min !== undefined) {
    decorators.push(
      Min(min, { message: `This field must be ${min} or greater` })
    );
  }

  if (max !== undefined) {
    decorators.push(
      Max(max, { message: `This field must be ${max} or less` })
    );
  }

  return applyDecorators(...decorators);
}

export function IsPositiveNumber(message?: string, options?: ValidationOptions) {
  return applyDecorators(
    IsNumber({}, { message: 'This field must be a valid number' }),
    IsPositive({ message: message || 'This field must be a positive number' }),
    IsNotEmpty({ message: 'This field is required' })
  );
}

export function IsOptionalPositiveNumber(message?: string, options?: ValidationOptions) {
  return applyDecorators(
    IsOptional(),
    IsNumber({}, { message: 'This field must be a valid number' }),
    IsPositive({ message: message || 'This field must be a positive number' })
  );
}

export function IsWholeNumber(message?: string, options?: ValidationOptions) {
  return applyDecorators(
    IsInt({ message: message || 'This field must be a whole number' }),
    IsNotEmpty({ message: 'This field is required' })
  );
}

export function IsOptionalWholeNumber(message?: string, options?: ValidationOptions) {
  return applyDecorators(
    IsOptional(),
    IsInt({ message: message || 'This field must be a whole number' })
  );
}

// String length validations
export function IsStringWithLength(
  minLength: number,
  maxLength: number,
  message?: string,
  options?: ValidationOptions
) {
  const decorators = [
    IsString({ message: 'This field must be text' }),
    IsNotEmpty({ message: 'This field is required' }),
    MinLength(minLength, { 
      message: `This field must be at least ${minLength} character${minLength === 1 ? '' : 's'} long` 
    }),
    MaxLength(maxLength, { 
      message: `This field must be no more than ${maxLength} character${maxLength === 1 ? '' : 's'} long` 
    })
  ];

  return applyDecorators(...decorators);
}

export function IsOptionalStringWithLength(
  minLength: number,
  maxLength: number,
  message?: string,
  options?: ValidationOptions
) {
  const decorators = [
    IsOptional(),
    IsString({ message: 'This field must be text' }),
    MinLength(minLength, { 
      message: `This field must be at least ${minLength} character${minLength === 1 ? '' : 's'} long` 
    }),
    MaxLength(maxLength, { 
      message: `This field must be no more than ${maxLength} character${maxLength === 1 ? '' : 's'} long` 
    })
  ];

  return applyDecorators(...decorators);
}

// Enum validations
export function IsUserFriendlyEnum(
  enumObject: any,
  message?: string,
  options?: ValidationOptions
) {
  const enumValues = Object.values(enumObject).join(', ');
  return applyDecorators(
    IsEnum(enumObject, { 
      message: message || `This field must be one of: ${enumValues}` 
    }),
    IsNotEmpty({ message: 'This field is required' })
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
export function IsUserFriendlyBoolean(message?: string, options?: ValidationOptions) {
  return applyDecorators(
    IsBoolean({ message: message || 'This field must be true or false' }),
    IsNotEmpty({ message: 'This field is required' })
  );
}

export function IsOptionalBoolean(message?: string, options?: ValidationOptions) {
  return applyDecorators(
    IsOptional(),
    IsBoolean({ message: message || 'This field must be true or false' })
  );
}

// Date validations
export function IsUserFriendlyDate(message?: string, options?: ValidationOptions) {
  return applyDecorators(
    IsDateString({}, { message: message || 'Please enter a valid date' }),
    IsNotEmpty({ message: 'Date is required' })
  );
}

export function IsOptionalDate(message?: string, options?: ValidationOptions) {
  return applyDecorators(
    IsOptional(),
    IsDateString({}, { message: message || 'Please enter a valid date' })
  );
}

// URL validations
export function IsUserFriendlyUrl(message?: string, options?: ValidationOptions) {
  return applyDecorators(
    IsUrl({}, { message: message || 'Please enter a valid URL' }),
    IsNotEmpty({ message: 'URL is required' })
  );
}

export function IsOptionalUrl(message?: string, options?: ValidationOptions) {
  return applyDecorators(
    IsOptional(),
    IsUrl({}, { message: message || 'Please enter a valid URL' })
  );
}

// Array validations
export function IsUserFriendlyArray(
  minSize?: number,
  maxSize?: number,
  message?: string,
  options?: ValidationOptions
) {
  const decorators = [
    IsArray({ message: 'This field must be a list' }),
    IsNotEmpty({ message: 'This field is required' })
  ];

  if (minSize !== undefined) {
    decorators.push(
      ArrayMinSize(minSize, { 
        message: `This list must contain at least ${minSize} item${minSize === 1 ? '' : 's'}` 
      })
    );
  }

  if (maxSize !== undefined) {
    decorators.push(
      ArrayMaxSize(maxSize, { 
        message: `This list must contain no more than ${maxSize} item${maxSize === 1 ? '' : 's'}` 
      })
    );
  }

  return applyDecorators(...decorators);
}

export function IsOptionalArray(
  minSize?: number,
  maxSize?: number,
  message?: string,
  options?: ValidationOptions
) {
  const decorators = [
    IsOptional(),
    IsArray({ message: 'This field must be a list' })
  ];

  if (minSize !== undefined) {
    decorators.push(
      ArrayMinSize(minSize, { 
        message: `This list must contain at least ${minSize} item${minSize === 1 ? '' : 's'}` 
      })
    );
  }

  if (maxSize !== undefined) {
    decorators.push(
      ArrayMaxSize(maxSize, { 
        message: `This list must contain no more than ${maxSize} item${maxSize === 1 ? '' : 's'}` 
      })
    );
  }

  return applyDecorators(...decorators);
}

// Phone number validation
export function IsPhoneNumber(message?: string, options?: ValidationOptions) {
  return applyDecorators(
    Matches(/^[\+]?[\d\s\-\(\)]+$/, { 
      message: message || 'Please enter a valid phone number' 
    }),
    IsNotEmpty({ message: 'Phone number is required' })
  );
}

export function IsOptionalPhoneNumber(message?: string, options?: ValidationOptions) {
  return applyDecorators(
    IsOptional(),
    Matches(/^[\+]?[\d\s\-\(\)]+$/, { 
      message: message || 'Please enter a valid phone number' 
    })
  );
}

// Price/Currency validation
export function IsPrice(
  maxDecimalPlaces: number = 2,
  min?: number,
  max?: number,
  message?: string,
  options?: ValidationOptions
) {
  const decorators = [
    IsNumber({ maxDecimalPlaces }, { 
      message: message || `Price must be a valid number with up to ${maxDecimalPlaces} decimal places` 
    }),
    IsNotEmpty({ message: 'Price is required' })
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

// Percentage validation
export function IsPercentage(message?: string, options?: ValidationOptions) {
  return applyDecorators(
    IsNumber({}, { message: 'Percentage must be a valid number' }),
    Min(0, { message: 'Percentage must be 0 or greater' }),
    Max(100, { message: 'Percentage must be 100 or less' }),
    IsNotEmpty({ message: 'Percentage is required' })
  );
}

export function IsOptionalPercentage(message?: string, options?: ValidationOptions) {
  return applyDecorators(
    IsOptional(),
    IsNumber({}, { message: 'Percentage must be a valid number' }),
    Min(0, { message: 'Percentage must be 0 or greater' }),
    Max(100, { message: 'Percentage must be 100 or less' })
  );
}

// Custom business validation
export function IsProjectName(message?: string, options?: ValidationOptions) {
  return applyDecorators(
    IsString({ message: 'Project name must be text' }),
    MinLength(2, { message: 'Project name must be at least 2 characters long' }),
    MaxLength(100, { message: 'Project name must be no more than 100 characters long' }),
    Matches(/^[a-zA-Z0-9\s\-_\.\u2013\u2014\u00A0\u2019\u201C\u201D\(\)\[\]\/\&\,\:\;]+$/, { 
      message: 'Project name can only contain letters, numbers, spaces, hyphens, dashes, underscores, periods, and common punctuation' 
    }),
    IsNotEmpty({ message: 'Project name is required' })
  );
}

export function IsVendorName(message?: string, options?: ValidationOptions) {
  return applyDecorators(
    IsString({ message: 'Vendor name must be text' }),
    MinLength(2, { message: 'Vendor name must be at least 2 characters long' }),
    MaxLength(200, { message: 'Vendor name must be no more than 200 characters long' }),
    IsNotEmpty({ message: 'Vendor name is required' })
  );
}

export function IsPartNumber(message?: string, options?: ValidationOptions) {
  return applyDecorators(
    IsString({ message: 'Part number must be text' }),
    MinLength(1, { message: 'Part number must be at least 1 character long' }),
    MaxLength(50, { message: 'Part number must be no more than 50 characters long' }),
    Matches(/^[a-zA-Z0-9\-_\.\/]+$/, { 
      message: 'Part number can only contain letters, numbers, hyphens, underscores, periods, and slashes' 
    }),
    IsNotEmpty({ message: 'Part number is required' })
  );
}