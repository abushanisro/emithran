import { ConsoleLogger } from '@nestjs/common';

import { writeErrorToFile } from './error-log-file';

/**
 * Nest's ConsoleLogger (what every `new Logger(Name)` writes through), with
 * error lines also kept in the error log file. Console output is unchanged.
 *
 * A Nest Logger instance calls this as error(message, context),
 * error(message, stack, context) or error(message, errorObject, context):
 * the context is always the last argument when there are two or more.
 */
export class FileErrorConsoleLogger extends ConsoleLogger {
  override error(message: unknown, ...optionalParams: unknown[]): void {
    super.error(message, ...optionalParams);
    const params = [...optionalParams];
    const context = params.length >= 1 && typeof params[params.length - 1] === 'string' ? (params.pop() as string) : this.context;
    const detail = params[0];
    const stack = typeof detail === 'string' ? detail : detail instanceof Error ? detail.stack : undefined;
    writeErrorToFile(message, context, stack);
  }
}
