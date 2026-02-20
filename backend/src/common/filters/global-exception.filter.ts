import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Request, Response } from 'express';

// Extend Request interface to include user property
interface AuthenticatedRequest extends Request {
  user?: {
    id?: string;
    [key: string]: any;
  };
}

// Database error patterns for better user messaging
interface DatabaseErrorPattern {
  pattern: RegExp;
  status: HttpStatus;
  getMessage: (match: RegExpMatchArray) => string;
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  // Database error patterns with user-friendly messages
  private readonly databaseErrorPatterns: DatabaseErrorPattern[] = [
    {
      pattern: /duplicate key value violates unique constraint "([^"]+)"/i,
      status: HttpStatus.CONFLICT,
      getMessage: (match) => {
        const constraint = match[1];
        if (constraint.includes('projects_name')) {
          return 'A project with this name already exists. Please choose a different name.';
        }
        if (constraint.includes('vendors_supplier_code')) {
          return 'This supplier code is already in use. Please use a different code.';
        }
        if (constraint.includes('vendor_contacts_email')) {
          return 'This email address is already associated with another contact.';
        }
        if (constraint.includes('bom_items_part_number')) {
          return 'A BOM item with this part number already exists in this BOM.';
        }
        if (constraint.includes('project_team_members')) {
          return 'This user is already a team member on this project.';
        }
        return 'This record already exists. Please check your input and try again.';
      }
    },
    {
      pattern: /violates foreign key constraint "([^"]+)"/i,
      status: HttpStatus.BAD_REQUEST,
      getMessage: (match) => {
        const constraint = match[1];
        if (constraint.includes('project_id')) {
          return 'The specified project does not exist or you do not have access to it.';
        }
        if (constraint.includes('vendor_id')) {
          return 'The specified vendor does not exist or is no longer available.';
        }
        if (constraint.includes('bom_id')) {
          return 'The specified BOM does not exist or has been deleted.';
        }
        if (constraint.includes('user_id')) {
          return 'The specified user does not exist or is not available.';
        }
        return 'One or more referenced items do not exist. Please verify your input.';
      }
    },
    {
      pattern: /violates check constraint "([^"]+)"/i,
      status: HttpStatus.BAD_REQUEST,
      getMessage: (match) => {
        const constraint = match[1];
        if (constraint.includes('positive')) {
          return 'Please enter a positive number greater than zero.';
        }
        if (constraint.includes('quantity')) {
          return 'Quantity must be greater than zero.';
        }
        if (constraint.includes('price') || constraint.includes('cost')) {
          return 'Price must be a positive number.';
        }
        if (constraint.includes('email')) {
          return 'Please enter a valid email address.';
        }
        return 'The provided value does not meet the required criteria.';
      }
    },
    {
      pattern: /violates row-level security policy/i,
      status: HttpStatus.FORBIDDEN,
      getMessage: () => 'You do not have permission to access or modify this resource.'
    },
    {
      pattern: /relation "([^"]+)" does not exist/i,
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      getMessage: () => 'A system error occurred. Please try again later.'
    },
    {
      pattern: /column "([^"]+)" does not exist/i,
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      getMessage: () => 'A system error occurred. Please try again later.'
    },
    {
      pattern: /invalid input syntax for type uuid/i,
      status: HttpStatus.BAD_REQUEST,
      getMessage: () => 'Invalid ID format provided. Please check your input.'
    },
    {
      pattern: /value too long for type character varying\((\d+)\)/i,
      status: HttpStatus.BAD_REQUEST,
      getMessage: (match) => `Input is too long. Maximum length is ${match[1]} characters.`
    },
    {
      pattern: /null value in column "([^"]+)" violates not-null constraint/i,
      status: HttpStatus.BAD_REQUEST,
      getMessage: (match) => {
        const column = match[1].replace(/_/g, ' ');
        return `${column.charAt(0).toUpperCase() + column.slice(1)} is required and cannot be empty.`;
      }
    }
  ];

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<AuthenticatedRequest>();

    const httpStatus = this.getHttpStatus(exception);
    const userFriendlyMessage = this.getUserFriendlyMessage(exception);
    const timestamp = new Date().toISOString();
    const path = request.url;
    const method = request.method;
    const userAgent = request.get('User-Agent') || 'Unknown';
    const ip = request.ip || request.connection.remoteAddress || 'Unknown';

    // Extract validation errors if present
    const validationErrors = this.extractValidationErrors(exception);

    // Structured error object
    const errorResponse = {
      success: false,
      error: {
        code: this.getErrorCode(exception, httpStatus),
        message: userFriendlyMessage,
        ...(validationErrors && { validationErrors }),
      },
      metadata: {
        timestamp,
        path,
        method,
        requestId: request.headers['x-request-id'] as string || undefined,
      },
      ...(process.env.NODE_ENV === 'development' && {
        debug: {
          originalMessage: this.getOriginalErrorMessage(exception),
          stack: exception instanceof Error ? exception.stack : undefined,
          details: this.getErrorDetails(exception),
        },
      }),
    };

    // Log error with context
    this.logError(exception, {
      httpStatus,
      path,
      method,
      userAgent,
      ip,
      userId: request.user?.id,
    });

    // Send response
    response.status(httpStatus).json(errorResponse);
  }

  private getHttpStatus(exception: unknown): number {
    if (exception instanceof HttpException) {
      return exception.getStatus();
    }

    // Check database error patterns for specific status codes
    if (exception instanceof Error) {
      for (const pattern of this.databaseErrorPatterns) {
        if (pattern.pattern.test(exception.message)) {
          return pattern.status;
        }
      }
    }

    // Rate limiting errors
    if (this.isRateLimitError(exception)) {
      return HttpStatus.TOO_MANY_REQUESTS;
    }

    // Validation errors
    if (this.isValidationError(exception)) {
      return HttpStatus.BAD_REQUEST;
    }

    return HttpStatus.INTERNAL_SERVER_ERROR;
  }

  private getUserFriendlyMessage(exception: unknown): string {
    // Handle HTTP exceptions first
    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      if (typeof response === 'object' && response !== null && 'message' in response) {
        const message = (response as any).message;
        if (Array.isArray(message)) {
          // Class-validator errors - join them into a readable format
          return this.formatValidationMessages(message);
        }
        return typeof message === 'string' ? message : 'An error occurred';
      }
      return typeof response === 'string' ? response : 'An error occurred';
    }

    // Handle database errors with user-friendly messages
    if (exception instanceof Error) {
      for (const pattern of this.databaseErrorPatterns) {
        const match = exception.message.match(pattern.pattern);
        if (match) {
          return pattern.getMessage(match);
        }
      }
    }

    // Handle other common errors
    if (exception instanceof Error) {
      const message = exception.message.toLowerCase();
      
      // Network/connection errors
      if (message.includes('connect') || message.includes('timeout')) {
        return 'Unable to connect to the database. Please try again later.';
      }
      
      // Authentication errors
      if (message.includes('unauthorized') || message.includes('authentication')) {
        return 'Authentication failed. Please log in again.';
      }
      
      // File upload errors
      if (message.includes('file') && message.includes('size')) {
        return 'The uploaded file is too large. Please choose a smaller file.';
      }
      
      // JSON parsing errors
      if (message.includes('json') || message.includes('parse')) {
        return 'Invalid data format received. Please check your input.';
      }
    }

    return 'An unexpected error occurred. Please try again later.';
  }

  private getOriginalErrorMessage(exception: unknown): string {
    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      return typeof response === 'string' ? response : (response as any).message || 'Unknown error';
    }

    if (exception instanceof Error) {
      return exception.message;
    }

    return 'An unexpected error occurred';
  }

  private getErrorDetails(exception: unknown): any {
    if (exception instanceof HttpException) {
      return exception.getResponse();
    }

    if (exception instanceof Error) {
      return {
        name: exception.name,
        message: exception.message,
      };
    }

    return { raw: exception };
  }

  private getErrorCode(exception: unknown, status: number): string {
    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      if (typeof response === 'object' && response !== null && 'code' in response) {
        return (response as any).code;
      }
    }

    // Database-specific error codes
    if (exception instanceof Error) {
      const message = exception.message;
      if (message.includes('duplicate key')) {
        if (message.includes('rfq_number')) return 'RFQ_NUMBER_EXISTS';
        if (message.includes('machine_name')) return 'MACHINE_NAME_EXISTS';
        if (message.includes('lot_number')) return 'LOT_NUMBER_EXISTS';
        return 'DUPLICATE_ENTRY';
      }
      if (message.includes('foreign key')) {
        if (message.includes('process_id')) return 'INVALID_PROCESS';
        if (message.includes('vendor_id')) return 'INVALID_VENDOR';
        if (message.includes('mhr_id')) return 'INVALID_MHR';
        return 'INVALID_REFERENCE';
      }
      if (message.includes('check constraint')) {
        if (message.includes('evaluation_scores')) return 'INVALID_SCORE_RANGE';
        if (message.includes('positive_values')) return 'NEGATIVE_VALUES_NOT_ALLOWED';
        return 'CONSTRAINT_VIOLATION';
      }
      if (message.includes('row-level security')) return 'ACCESS_DENIED';
      if (message.includes('not-null constraint')) return 'REQUIRED_FIELD';
      if (message.includes('invalid input syntax')) return 'INVALID_FORMAT';
    }

    // Map HTTP status codes to error codes
    const statusCodeMap: Record<number, string> = {
      400: 'BAD_REQUEST',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      405: 'METHOD_NOT_ALLOWED',
      408: 'REQUEST_TIMEOUT',
      409: 'CONFLICT',
      422: 'UNPROCESSABLE_ENTITY',
      429: 'TOO_MANY_REQUESTS',
      500: 'INTERNAL_SERVER_ERROR',
      502: 'BAD_GATEWAY',
      503: 'SERVICE_UNAVAILABLE',
      504: 'GATEWAY_TIMEOUT',
    };

    return statusCodeMap[status] || 'UNKNOWN_ERROR';
  }

  private extractValidationErrors(exception: unknown): Record<string, string[]> | null {
    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      if (typeof response === 'object' && response !== null && 'message' in response) {
        const message = (response as any).message;
        if (Array.isArray(message)) {
          // Group validation messages by field
          const fieldErrors: Record<string, string[]> = {};
          message.forEach((msg: string) => {
            // Try to extract field name from validation message
            const fieldMatch = msg.match(/^(\w+)\s/);
            const field = fieldMatch ? fieldMatch[1] : 'general';
            if (!fieldErrors[field]) {
              fieldErrors[field] = [];
            }
            fieldErrors[field].push(this.humanizeValidationMessage(msg));
          });
          return fieldErrors;
        }
      }
    }
    return null;
  }

  private formatValidationMessages(messages: string[]): string {
    if (messages.length === 1) {
      return this.humanizeValidationMessage(messages[0]);
    }
    return `Please check the following: ${messages.map(this.humanizeValidationMessage).join(', ')}`;
  }

  private humanizeValidationMessage(message: string): string {
    // Convert class-validator messages to more user-friendly text
    return message
      .replace(/^[a-zA-Z]+\s+/, '') // Remove field name prefix
      .replace(/must be a string/i, 'must be text')
      .replace(/must be a number/i, 'must be a valid number')
      .replace(/must be a boolean/i, 'must be true or false')
      .replace(/must be an email/i, 'must be a valid email address')
      .replace(/must be a UUID/i, 'must be a valid ID')
      .replace(/should not be empty/i, 'is required')
      .replace(/must not be empty/i, 'is required')
      .replace(/must be longer than or equal to (\d+) characters/i, (match, p1) => `must be at least ${p1} characters long`)
      .replace(/must be shorter than or equal to (\d+) characters/i, (match, p1) => `must be no more than ${p1} characters long`)
      .replace(/must be greater than or equal to (\d+)/i, (match, p1) => `must be ${p1} or greater`)
      .replace(/must be less than or equal to (\d+)/i, (match, p1) => `must be ${p1} or less`);
  }

  private sanitizeErrorMessage(message: string): string {
    // Remove sensitive information from error messages
    return message
      .replace(/password/gi, '[REDACTED]')
      .replace(/token/gi, '[REDACTED]')
      .replace(/secret/gi, '[REDACTED]')
      .replace(/key/gi, '[REDACTED]')
      .replace(/api[_-]?key/gi, '[REDACTED]')
      .replace(/auth[_-]?token/gi, '[REDACTED]');
  }

  private logError(exception: unknown, context: any): void {
    const logLevel = context.httpStatus >= 500 ? 'error' : 'warn';
    const logMessage = `${context.method} ${context.path} - ${context.httpStatus}`;
    
    const logContext = {
      ...context,
      error: exception instanceof Error ? {
        name: exception.name,
        message: this.sanitizeErrorMessage(exception.message),
        stack: process.env.NODE_ENV === 'development' ? exception.stack : undefined,
      } : exception,
    };

    if (logLevel === 'error') {
      this.logger.error(logMessage, logContext);
    } else {
      this.logger.warn(logMessage, logContext);
    }
  }

  private isValidationError(exception: unknown): boolean {
    if (exception instanceof Error) {
      return (
        exception.name === 'ValidationError' ||
        exception.message.includes('validation failed') ||
        exception.message.includes('invalid input')
      );
    }
    return false;
  }

  private isRateLimitError(exception: unknown): boolean {
    if (exception instanceof HttpException) {
      return exception.getStatus() === HttpStatus.TOO_MANY_REQUESTS;
    }
    return false;
  }
}