import { describe, expect, it } from 'vitest';

import { fromProblemDetails, isProblemContentType } from '@/lib/api/problem-details';

describe('problem details', () => {
  it('recognises the content type, with or without a charset', () => {
    expect(isProblemContentType('application/problem+json')).toBe(true);
    expect(isProblemContentType('application/problem+json; charset=utf-8')).toBe(true);
    expect(isProblemContentType('application/json')).toBe(false);
    expect(isProblemContentType(null)).toBe(false);
  });

  it('turns a problem into the error shape the client already reads', () => {
    const body = fromProblemDetails({
      status: 409, title: 'Conflict', detail: 'A project with this name already exists.', code: 'CONFLICT',
      instance: '/api/v1/projects', requestId: 'r1', errors: [{ field: 'name' }],
    });
    expect(body.success).toBe(false);
    expect(body.error).toEqual({ code: 'CONFLICT', message: 'A project with this name already exists.', details: [{ field: 'name' }] });
    expect(body.metadata).toMatchObject({ path: '/api/v1/projects', requestId: 'r1' });
  });

  it('falls back to the title, then to the status, when there is no detail', () => {
    expect(fromProblemDetails({ status: 404, title: 'Not Found' }).error).toEqual({ code: 'HTTP_ERROR', message: 'Not Found' });
    expect(fromProblemDetails({ status: 500 }).error.message).toBe('Request failed with status 500');
  });
});
