/**
 * Where browser code sends API calls: the backend-for-frontend route on its own origin (Design 6, ADR-003). The session cookie travels
 * with each call and the Next.js server attaches the access token, so browser JavaScript never holds one.
 */
export const BFF_PATH = '/api/v1';
