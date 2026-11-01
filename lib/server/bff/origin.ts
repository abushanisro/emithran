const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF check for the BFF. Session cookies are SameSite=Lax, so other sites can only send them on top-level GET navigations; a request
 * that changes state must also name the app as its Origin. Browsers always send Origin on cross-origin and same-origin POST, PUT, PATCH
 * and DELETE, so a missing one is refused rather than trusted.
 */
export function isAllowedOrigin(req: Request, appOrigin: string): boolean {
  if (SAFE_METHODS.has(req.method)) return true;
  const origin = req.headers.get('origin');
  return origin !== null && origin === new URL(appOrigin).origin;
}

/**
 * The same check for the app's own route handlers outside the BFF (AI, CAD and PDF routes): null when the request may proceed,
 * otherwise the refusal to return. APP_BASE_URL is the app's public origin, as for the BFF.
 */
export function refuseCrossOrigin(req: Request): Response | null {
  const appUrl = process.env.APP_BASE_URL;
  if (!appUrl) return Response.json({ error: 'APP_BASE_URL must be set' }, { status: 500 });
  return isAllowedOrigin(req, appUrl) ? null : Response.json({ error: 'Request origin not allowed' }, { status: 403 });
}
