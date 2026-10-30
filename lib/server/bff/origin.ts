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
