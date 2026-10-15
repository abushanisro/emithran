/**
 * The claims of a JWT, decoded WITHOUT verifying it, or null if it is not one.
 * Works in the browser and in Node (atob is global in both).
 *
 * Only for reading claims of a token Supabase has already issued or verified,
 * or a claim like exp where a forged value can only shorten a cache entry.
 */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const part = token.split('.')[1] ?? '';
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
    const payload: unknown = JSON.parse(atob(base64));
    return payload !== null && typeof payload === 'object' ? (payload as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The token's exp claim in ms since epoch, or null. */
export function jwtExpiryMs(token: string): number | null {
  const exp = decodeJwtPayload(token)?.exp;
  return typeof exp === 'number' ? exp * 1000 : null;
}
