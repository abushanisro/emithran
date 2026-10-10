import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, IsDateString, IsUUID, IsOptional, MaxLength, Matches } from 'class-validator';

// Validate and sanitize date strings
export const SanitizedDate = (options?: { required?: boolean }) => {
  const decorators = [
    Transform(({ value }) => {
      if (!value) return value;
      
      // Ensure it's a valid date format
      const date = new Date(value);
      if (isNaN(date.getTime())) {
        return value; // Let validation catch this
      }
      
      // Return ISO string format
      return date.toISOString().split('T')[0];
    }),
  ];

  if (options?.required !== false) {
    decorators.push(IsNotEmpty({ message: 'Date is required' }));
  } else {
    decorators.push(IsOptional());
  }

  decorators.push(IsDateString({}, { message: 'Must be a valid date (YYYY-MM-DD)' }));

  return applyDecorators(...decorators);
};

// Validate production lot numbers with specific format
export const SanitizedLotNumber = () => {
  return applyDecorators(
    Transform(({ value }) => {
      if (typeof value !== 'string') return value;
      return value.trim().toUpperCase();
    }),
    IsString({ message: 'Lot number must be a string' }),
    MaxLength(50, { message: 'Lot number must be no longer than 50 characters' }),
    Matches(/^[A-Z0-9\-_]+$/, { 
      message: 'Lot number can only contain letters, numbers, hyphens, and underscores' 
    }),
  );
};

// Validate quantity fields with bounds
export const SanitizedQuantity = (options?: { min?: number; max?: number }) => {
  const decorators = [
    Transform(({ value }) => {
      const num = Number(value);
      return isNaN(num) ? value : Math.abs(num); // Ensure positive
    }),
  ];

  return applyDecorators(...decorators);
};