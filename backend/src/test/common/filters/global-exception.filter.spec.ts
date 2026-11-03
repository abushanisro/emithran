// Regression (2026-10-27, found by the smoke test): a request rejected with a
// session token in its query string (?token=, accepted for SSE) had the full URL
// -- token included -- written to the log by this filter. Only the path is kept.
import { ArgumentsHost, ConflictException, Logger, UnauthorizedException } from '@nestjs/common';

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
      url: '/api/health/probe?token=SECRET-TOKEN-123',
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
    expect(json.mock.calls[0][0].metadata.path).toBe('/api/health/probe');
  });

  it("passes a refusal's machine-readable code and details to the client", () => {
    const json = jest.fn();
    const response = { status: jest.fn().mockReturnValue({ json }), headersSent: false };
    const request = { url: '/internal/bom-items/1', method: 'DELETE', headers: {}, ip: '127.0.0.1', get: () => 'jest', connection: {} };
    const host = { switchToHttp: () => ({ getResponse: () => response, getRequest: () => request }) } as unknown as ArgumentsHost;

    new GlobalExceptionFilter().catch(
      new ConflictException({ code: 'BOM_ITEM_IN_PRODUCTION_LOTS', message: 'in use', details: { visibleLotIds: ['l1'], hiddenLotCount: 2 } }),
      host,
    );

    expect(response.status).toHaveBeenCalledWith(409);
    expect(json.mock.calls[0][0].error).toEqual({
      code: 'BOM_ITEM_IN_PRODUCTION_LOTS',
      message: 'in use',
      details: { visibleLotIds: ['l1'], hiddenLotCount: 2 },
    });
  });

  it('on /api/v1 sends the same refusal as problem details, with its code and details', () => {
    const json = jest.fn();
    const type = jest.fn().mockReturnValue({ json });
    const response = { status: jest.fn().mockReturnValue({ type }), headersSent: false };
    const request = { url: '/api/v1/bom-items/1', originalUrl: '/api/v1/bom-items/1?x=1', method: 'DELETE', headers: { 'x-request-id': 'r1' }, ip: '127.0.0.1', get: () => 'jest', connection: {} };
    const host = { switchToHttp: () => ({ getResponse: () => response, getRequest: () => request }) } as unknown as ArgumentsHost;

    new GlobalExceptionFilter().catch(
      new ConflictException({ code: 'BOM_ITEM_IN_PRODUCTION_LOTS', message: 'in use', details: { visibleLotIds: ['l1'], hiddenLotCount: 2 } }),
      host,
    );

    expect(response.status).toHaveBeenCalledWith(409);
    expect(type).toHaveBeenCalledWith('application/problem+json');
    expect(json.mock.calls[0][0]).toMatchObject({
      type: 'about:blank', title: 'Conflict', status: 409, detail: 'in use', instance: '/api/v1/bom-items/1',
      code: 'BOM_ITEM_IN_PRODUCTION_LOTS', details: { visibleLotIds: ['l1'], hiddenLotCount: 2 }, requestId: 'r1',
    });
  });
});
