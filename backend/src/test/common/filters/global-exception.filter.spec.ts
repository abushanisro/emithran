// Regression (2026-10-27, found by the smoke test): a request rejected with a
// session token in its query string (?token=, accepted for SSE) had the full URL
// -- token included -- written to the log by this filter. Only the path is kept.
import { ArgumentsHost, Logger, UnauthorizedException } from '@nestjs/common';

import { GlobalExceptionFilter } from '../../../common/filters/global-exception.filter';

describe('GlobalExceptionFilter', () => {
  it('never logs or echoes the query string', () => {
    const lines: string[] = [];
    for (const level of ['log', 'warn', 'error', 'debug'] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => { lines.push(JSON.stringify(args)); });
    }
    const json = jest.fn();
    const response = { status: jest.fn().mockReturnValue({ json }), headersSent: false };
    const request = {
      url: '/v1/api/projects?token=SECRET-TOKEN-123',
      method: 'GET',
      headers: {},
      ip: '127.0.0.1',
      get: () => 'jest',
      connection: {},
    };
    const host = {
      switchToHttp: () => ({ getResponse: () => response, getRequest: () => request }),
    } as unknown as ArgumentsHost;

    new GlobalExceptionFilter().catch(new UnauthorizedException(), host);

    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join('\n')).not.toContain('SECRET-TOKEN-123');
    expect(JSON.stringify(json.mock.calls)).not.toContain('SECRET-TOKEN-123');
    expect(json.mock.calls[0][0].metadata.path).toBe('/v1/api/projects');
  });
});
