/**
 * Build-time switch for the backend-for-frontend (Design 6, ADR-003). When on, the browser sends API calls to its own origin under
 * BFF_PATH with the session cookie, and the Next.js server attaches the access token, so browser JavaScript never needs one.
 */
export const bffEnabled = process.env.NEXT_PUBLIC_BFF === 'on';

export const BFF_PATH = '/api/v1';
