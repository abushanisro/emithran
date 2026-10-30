import { NextResponse, type NextRequest } from 'next/server';

import { sessionAccessToken } from '@/lib/server/auth';
import { forwardRequest, upstreamUrl } from '@/lib/server/bff/forward';
import { isAllowedOrigin } from '@/lib/server/bff/origin';

const refuse = (status: number, code: string, message: string) =>
  NextResponse.json({ success: false, error: { code, message } }, { status });

/**
 * Backend-for-frontend: the browser calls /api/v1/* on its own origin with its session cookie, and this route forwards the call to the
 * API with the session's access token, so the token never reaches browser JavaScript (Design 6, ADR-003). The API still verifies the
 * token, the organization and the idle deadline on every call; this route only decides whether to forward.
 */
async function handle(req: NextRequest, ctx: RouteContext<'/api/v1/[...path]'>): Promise<Response> {
  // Read per request rather than imported from lib/api/bff, so the server and its tests see the deployed value.
  if (process.env.NEXT_PUBLIC_BFF !== 'on') return refuse(404, 'NOT_FOUND', 'Not found');

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  const apiBase = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL;
  if (!appUrl || !apiBase) return refuse(500, 'BFF_NOT_CONFIGURED', 'NEXT_PUBLIC_APP_URL and API_URL must be set');

  if (!isAllowedOrigin(req, appUrl)) return refuse(403, 'ORIGIN_NOT_ALLOWED', 'Request origin not allowed');

  const url = upstreamUrl((await ctx.params).path, req.nextUrl.search, apiBase);
  if (!url) return refuse(400, 'INVALID_PATH', 'Invalid API path');

  const token = await sessionAccessToken();
  if (!token) return refuse(401, 'UNAUTHORIZED', 'Authentication required');

  try {
    return await forwardRequest(req, url, token);
  } catch {
    return refuse(502, 'API_UNREACHABLE', 'The API could not be reached');
  }
}

export const GET = handle;
export const HEAD = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
