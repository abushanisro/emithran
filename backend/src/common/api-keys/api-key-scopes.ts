import { createHash } from 'node:crypto';

// What an API key may be allowed to do. A closed list: migration 935 refuses any other value (constraint api_keys_usable_shape),
// so a change here needs a migration that changes that constraint too.
export const API_KEY_SCOPES = ['projects:read', 'projects:write', 'boms:read', 'costing:read'] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

/** Every raw key starts with this, which is how the auth guard tells a key from an Auth0 token. */
export const API_KEY_PREFIX = 'mk_live_';

/** Keys live for at most a year; a key created without an expiry gets the default. */
export const API_KEY_MAX_DAYS = 365;
export const API_KEY_DEFAULT_DAYS = 90;

/** The stored form of a key: its SHA-256. The raw key is shown once and never stored. */
export function hashApiKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex');
}
