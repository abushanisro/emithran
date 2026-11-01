/**
 * The claims of a JWT, decoded WITHOUT verifying it, or null if it is not one.
 *
 * Only for tokens the auth guard has already verified (the guard's
 * verifyToken), or to read a claim like exp where a forged value can only
 * shorten a cache entry, never grant access.
 */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const payload: unknown = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'));
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
