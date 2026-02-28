import {
  PipeTransform,
  Injectable,
  ArgumentMetadata,
  BadRequestException,
  ValidationPipe as NestValidationPipe,
  ValidationPipeOptions,
} from '@nestjs/common';
import { validate, ValidationError } from 'class-validator';
import { plainToClass } from 'class-transformer';

@Injectable()
export class CustomValidationPipe extends NestValidationPipe implements PipeTransform<any> {
  constructor(options?: ValidationPipeOptions) {
    super({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      stopAtFirstError: false,
      exceptionFactory: (errors: ValidationError[]) => {
        const formattedErrors = this.formatValidationErrors(errors);
        console.log('🚨 Validation errors:', formattedErrors);
        console.log('🚨 Raw validation errors:', JSON.stringify(errors, null, 2));
        return new BadRequestException({
          message: formattedErrors,
          error: 'Validation Failed',
          statusCode: 400,
        });
      },
      ...options,
    });
  }

  private formatValidationErrors(errors: ValidationError[]): string[] {
    const messages: string[] = [];
    
    for (const error of errors) {
      messages.push(...this.extractErrorMessages(error));
    }
    
    return messages;
  }

  private extractErrorMessages(error: ValidationError, parentPath = ''): string[] {
    const messages: string[] = [];
    const propertyPath = parentPath ? `${parentPath}.${error.property}` : error.property;
    
    // Handle nested validation errors
    if (error.children && error.children.length > 0) {
      for (const child of error.children) {
        messages.push(...this.extractErrorMessages(child, propertyPath));
      }
    }
    
    // Handle constraint errors
    if (error.constraints) {
      for (const constraintKey of Object.keys(error.constraints)) {
        const constraintMessage = error.constraints[constraintKey];
        messages.push(this.humanizeValidationMessage(propertyPath, constraintMessage, constraintKey));
      }
    }
    
    return messages;
  }

  private humanizeValidationMessage(property: string, message: string, constraintType: string): string {
    const fieldName = this.humanizePropertyName(property);
    
    // Remove the property name from the beginning of the message if it exists
    const cleanMessage = message.replace(new RegExp(`^${property}\\s+`, 'i'), '');
    
    // Apply field-specific improvements
    switch (constraintType) {
      case 'isNotEmpty':
      case 'isString':
        return `${fieldName} is required`;
      
      case 'isEmail':
        return `${fieldName} must be a valid email address`;
      
      case 'isUUID':
        return `${fieldName} must be a valid ID`;
      
      case 'isNumber':
        return `${fieldName} must be a valid number`;
      
      case 'isBoolean':
        return `${fieldName} must be true or false`;
      
      case 'minLength':
        const minMatch = cleanMessage.match(/(\d+)/);
        return minMatch 
          ? `${fieldName} must be at least ${minMatch[1]} characters long`
          : `${fieldName} is too short`;
      
      case 'maxLength':
        const maxMatch = cleanMessage.match(/(\d+)/);
        return maxMatch 
          ? `${fieldName} must be no more than ${maxMatch[1]} characters long`
          : `${fieldName} is too long`;
      
      case 'min':
        const minValueMatch = cleanMessage.match(/(\d+)/);
        return minValueMatch 
          ? `${fieldName} must be ${minValueMatch[1]} or greater`
          : `${fieldName} is too small`;
      
      case 'max':
        const maxValueMatch = cleanMessage.match(/(\d+)/);
        return maxValueMatch 
          ? `${fieldName} must be ${maxValueMatch[1]} or less`
          : `${fieldName} is too large`;
      
      case 'isEnum':
        return `${fieldName} must be one of the allowed values`;
      
      case 'isOptional':
        return `${fieldName} is invalid`;
      
      case 'matches':
        if (property.toLowerCase().includes('password')) {
          return `${fieldName} must meet the password requirements`;
        }
        if (property.toLowerCase().includes('phone')) {
          return `${fieldName} must be a valid phone number`;
        }
        return `${fieldName} format is invalid`;
      
      case 'isPositive':
        return `${fieldName} must be a positive number`;
      
      case 'isInt':
        return `${fieldName} must be a whole number`;
      
      case 'isDecimal':
        return `${fieldName} must be a decimal number`;
      
      case 'isDateString':
        return `${fieldName} must be a valid date`;
      
      case 'isUrl':
        return `${fieldName} must be a valid URL`;
      
      case 'arrayMinSize':
        const arrayMinMatch = cleanMessage.match(/(\d+)/);
        return arrayMinMatch 
          ? `${fieldName} must contain at least ${arrayMinMatch[1]} item${arrayMinMatch[1] === '1' ? '' : 's'}`
          : `${fieldName} must contain at least one item`;
      
      case 'arrayMaxSize':
        const arrayMaxMatch = cleanMessage.match(/(\d+)/);
        return arrayMaxMatch 
          ? `${fieldName} must contain no more than ${arrayMaxMatch[1]} item${arrayMaxMatch[1] === '1' ? '' : 's'}`
          : `${fieldName} contains too many items`;
      
      default:
        // For custom validators or unknown constraints, clean up the message
        return `${fieldName} ${cleanMessage.toLowerCase()}`;
    }
  }

  private humanizePropertyName(property: string): string {
    // Handle nested properties (e.g., "address.street" becomes "Address Street")
    const parts = property.split('.');
    const humanizedParts = parts.map(part => {
      // Convert camelCase to separate words
      const words = part
        .replace(/([A-Z])/g, ' $1') // Add space before capital letters
        .replace(/^./, str => str.toUpperCase()) // Capitalize first letter
        .trim()
        .split(' ')
        .map(word => {
          // Handle common abbreviations
          const commonAbbreviations: Record<string, string> = {
            'id': 'ID',
            'url': 'URL',
            'api': 'API',
            'uuid': 'ID',
            'bom': 'BOM',
            'rfq': 'RFQ',
            'qms': 'QMS',
            'csv': 'CSV',
            'pdf': 'PDF',
          };
          
          const lowerWord = word.toLowerCase();
          return commonAbbreviations[lowerWord] || word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
        });
      
      return words.join(' ');
    });
    
    return humanizedParts.join(' ');
  }
}

/**
 * Factory function to create a validation pipe with custom options
 */
export function createValidationPipe(options?: ValidationPipeOptions): CustomValidationPipe {
  return new CustomValidationPipe(options);
}

/**
 * Pre-configured validation pipes for different use cases
 */
export const ValidationPipes = {
  // For request bodies - strict validation
  body: new CustomValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
  
  // For query parameters - lenient validation
  query: new CustomValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: false,
    skipMissingProperties: true,
  }),
  
  // For path parameters - minimal validation
  param: new CustomValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: false,
    skipMissingProperties: false,
  }),
};