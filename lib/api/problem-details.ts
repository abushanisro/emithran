/**
 * The public API (/api/v1) answers errors as RFC 9457 problem details (Content-Type application/problem+json): status, title, detail,
 * instance and a stable `code`. The client works with one error shape, so a problem body is turned into it here: detail becomes the
 * message, code stays the code, and a validation list (`errors`) becomes the details.
 */
export interface ProblemDetails {
  type?: string;
  title?: string;
  status: number;
  detail?: string;
  instance?: string;
  code?: string;
  errors?: unknown;
  requestId?: string;
}

export const PROBLEM_JSON = 'application/problem+json';

export function isProblemContentType(contentType: string | null | undefined): boolean {
  return !!contentType && contentType.toLowerCase().includes(PROBLEM_JSON);
}

export function fromProblemDetails(problem: ProblemDetails): {
  success: false;
  error: { code: string; message: string; details?: unknown };
  metadata: { timestamp: string; path?: string; requestId?: string };
} {
  return {
    success: false,
    error: {
      code: problem.code ?? 'HTTP_ERROR',
      message: problem.detail ?? problem.title ?? `Request failed with status ${problem.status}`,
      ...(problem.errors !== undefined && { details: problem.errors }),
    },
    metadata: {
      timestamp: new Date().toISOString(),
      ...(problem.instance && { path: problem.instance }),
      ...(problem.requestId && { requestId: problem.requestId }),
    },
  };
}
